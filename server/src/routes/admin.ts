import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Queryable } from '../db/index.js';
import { DEMO_SLUG } from '../demo/seed.js';
import { normalizeCountry } from '../lib/countries.js';
import { csvToObjects, toCsv } from '../lib/csv.js';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { generateDeviceSecret, hashSecret, secretHint } from '../lib/keys.js';
import { hashPassword } from '../services/auth.js';
import {
  audit,
  getRace,
  listCategories,
  listCheckpoints,
  listParticipants,
  mapParticipant,
  mapRace,
  slugify,
  type Race,
} from '../services/races.js';
import { isValidCoordinate } from '../timing/geo.js';
import { RouteModel } from '../timing/route.js';
import { requireRole } from './auth.js';

const uuid = z.string().uuid();
const isoDate = z.string().datetime({ offset: true });

const raceBody = z.object({
  name: z.string().trim().min(3).max(120),
  slug: z
    .string()
    .trim()
    .regex(/^[a-z0-9-]{3,60}$/, 'Solo minúsculas, números y guiones')
    .optional(),
  description: z.string().max(2000).optional(),
  location: z.string().max(200).optional(),
  discipline: z.enum(['cycling_road', 'cycling_circuit', 'cycling_tt', 'triathlon']).optional(),
  mode: z.enum(['official', 'demo']).optional(),
  status: z.enum(['draft', 'scheduled', 'cancelled']).optional(),
  scheduledStart: isoDate.nullable().optional(),
  timezone: z.string().max(64).optional(),
  laps: z.number().int().min(1).max(200).optional(),
  allowEstimatedGaps: z.boolean().optional(),
});

const participantBody = z.object({
  bib: z.number().int().min(1).max(99999),
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  team: z.string().trim().max(120).optional().default(''),
  countryCode: z.string().trim().transform((v, ctx) => {
    const c = normalizeCountry(v);
    if (!c) ctx.addIssue({ code: 'custom', message: 'Código de país ISO no válido' });
    return c ?? '';
  }),
  categoryCode: z.string().trim().max(20).nullable().optional(),
  startTime: isoDate.nullable().optional(),
  hasHrSensor: z.boolean().optional().default(false),
  publicHr: z.boolean().optional().default(false),
  email: z.string().trim().email().max(200).nullable().optional().or(z.literal('')),
  phone: z.string().trim().max(40).nullable().optional(),
  emergencyContact: z.string().trim().max(200).nullable().optional(),
  notes: z.string().max(1000).nullable().optional(),
});

const checkpointBody = z.object({
  name: z.string().trim().min(1).max(80),
  kind: z.enum(['start', 'split', 'finish']),
  distanceM: z.number().min(0),
});

const deviceBody = z.object({
  serial: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9_-]{3,64}$/, 'Usa letras, números, guiones o guiones bajos (3-64)'),
  label: z.string().trim().max(120).optional().default(''),
  hardware: z.string().trim().max(200).optional().default(''),
  firmware: z.string().trim().max(60).nullable().optional(),
});

/** Extrae los puntos de un GPX (trkpt o rtept). */
export function parseGpx(xml: string): [number, number][] {
  const pts: [number, number][] = [];
  const re = /<(?:trkpt|rtept)\b([^>]*)>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const lat = /\blat\s*=\s*["']([-0-9.]+)["']/.exec(m[1]);
    const lon = /\blon\s*=\s*["']([-0-9.]+)["']/.exec(m[1]);
    if (lat && lon) pts.push([Number(lat[1]), Number(lon[1])]);
  }
  return pts;
}

export async function registerAdminRoutes(app: FastifyInstance) {
  const { db, live, simulator } = app.services;
  const anyRole = requireRole('admin', 'organizer');
  const adminOnly = requireRole('admin');
  app.addHook('preHandler', anyRole);

  const uid = (req: FastifyRequest) => req.user?.id ?? null;

  async function reloadLive(raceId: string) {
    if (live.isLoaded(raceId)) {
      live.unload(raceId);
      await live.load(raceId);
    }
  }

  async function raceParam(req: FastifyRequest) {
    const { id } = req.params as { id: string };
    return getRace(db, uuid.parse(id));
  }

  function assertEditable(race: Race, req: FastifyRequest) {
    if (race.status === 'finished' && req.user?.role !== 'admin') {
      throw forbidden('La carrera está finalizada: solo un administrador puede modificarla');
    }
  }

  async function participantRace(pid: string) {
    const { rows } = await db.query<any>('SELECT * FROM participants WHERE id = $1', [uuid.parse(pid)]);
    if (!rows[0]) throw notFound('Participante');
    return { participant: mapParticipant(rows[0]), race: await getRace(db, rows[0].race_id) };
  }

  // ------------------------------------------------------------------ Carreras
  app.get('/races', async () => {
    const { rows } = await db.query<any>(
      `SELECT r.*, (SELECT count(*)::int FROM participants p WHERE p.race_id = r.id) AS participant_count
         FROM races r ORDER BY r.created_at DESC`,
    );
    return { races: rows.map((r) => ({ ...mapRace(r), route: undefined, participantCount: r.participant_count })) };
  });

  app.post('/races', async (req, reply) => {
    const b = raceBody.parse(req.body);
    const slug = b.slug ?? `${slugify(b.name)}-${Date.now().toString(36).slice(-4)}`;
    const { rows } = await db.query<any>(
      `INSERT INTO races (slug, name, description, location, discipline, mode, status, scheduled_start, timezone, laps, allow_estimated_gaps, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [
        slug, b.name, b.description ?? '', b.location ?? '', b.discipline ?? 'cycling_road', b.mode ?? 'official',
        b.status ?? 'draft', b.scheduledStart ?? null, b.timezone ?? 'America/Santo_Domingo', b.laps ?? 1,
        b.allowEstimatedGaps ?? true, uid(req),
      ],
    );
    const race = mapRace(rows[0]);
    const seg = race.discipline === 'triathlon' ? null : 'bike';
    if (seg) await db.query(`INSERT INTO race_segments (race_id, seq, discipline, name) VALUES ($1, 1, 'bike', 'Ciclismo')`, [race.id]);
    await audit(db, uid(req), 'race.create', 'race', race.id, { name: race.name, mode: race.mode });
    return reply.status(201).send({ race });
  });

  app.get('/races/:id', async (req) => {
    const race = await raceParam(req);
    const [checkpoints, categories] = await Promise.all([listCheckpoints(db, race.id), listCategories(db, race.id)]);
    const segs = await db.query('SELECT id, seq, discipline, name FROM race_segments WHERE race_id = $1 ORDER BY seq', [race.id]);
    return { race, checkpoints, categories, segments: segs.rows };
  });

  app.patch('/races/:id', async (req) => {
    const race = await raceParam(req);
    assertEditable(race, req);
    const b = raceBody.partial().parse(req.body);
    if (b.mode && b.mode !== race.mode && race.startedAt) throw conflict('No se puede cambiar el modo de una carrera ya iniciada');
    if (b.laps && b.laps !== race.laps && race.status === 'live') throw conflict('No se pueden cambiar las vueltas con la carrera en curso');
    const fields: Record<string, unknown> = {
      name: b.name, slug: b.slug, description: b.description, location: b.location, discipline: b.discipline,
      mode: b.mode, status: b.status, scheduled_start: b.scheduledStart, timezone: b.timezone, laps: b.laps,
      allow_estimated_gaps: b.allowEstimatedGaps,
    };
    const sets: string[] = [];
    const vals: unknown[] = [race.id];
    for (const [k, v] of Object.entries(fields)) {
      if (v === undefined) continue;
      vals.push(v);
      sets.push(`${k} = $${vals.length}`);
    }
    if (sets.length) await db.query(`UPDATE races SET ${sets.join(', ')}, updated_at = now() WHERE id = $1`, vals);
    await audit(db, uid(req), 'race.update', 'race', race.id, b);
    await reloadLive(race.id);
    return { race: await getRace(db, race.id) };
  });

  app.delete('/races/:id', async (req) => {
    const race = await raceParam(req);
    if (race.slug === DEMO_SLUG && simulator.state === 'running') throw conflict('Detén la simulación antes de borrar la carrera DEMO');
    if (req.user!.role !== 'admin' && !['draft', 'scheduled', 'cancelled'].includes(race.status)) {
      throw forbidden('Solo un administrador puede borrar carreras iniciadas o finalizadas');
    }
    live.unload(race.id);
    await db.query('DELETE FROM races WHERE id = $1', [race.id]);
    await audit(db, uid(req), 'race.delete', 'race', race.id, { name: race.name, status: race.status });
    return { ok: true };
  });

  app.put('/races/:id/route', async (req) => {
    const race = await raceParam(req);
    assertEditable(race, req);
    if (race.status === 'live') throw conflict('No se puede cambiar el recorrido con la carrera en curso');
    const b = z
      .object({ points: z.array(z.tuple([z.number(), z.number()])).optional(), gpx: z.string().max(10_000_000).optional() })
      .parse(req.body);
    const points = b.gpx ? parseGpx(b.gpx) : (b.points ?? []);
    if (points.length < 2) throw badRequest('El recorrido necesita al menos 2 puntos válidos');
    if (points.length > 20_000) throw badRequest('El recorrido tiene demasiados puntos (máx. 20 000)');
    if (!points.every(([lat, lon]) => isValidCoordinate(lat, lon))) throw badRequest('El recorrido contiene coordenadas no válidas');
    const rounded = points.map(([a, o]) => [+a.toFixed(6), +o.toFixed(6)] as [number, number]);
    const route = new RouteModel(rounded.map(([lat, lon]) => ({ lat, lon })));
    await db.transaction(async (tx) => {
      await tx.query(`UPDATE races SET route = $2, route_length_m = $3, updated_at = now() WHERE id = $1`, [
        race.id, JSON.stringify(rounded), route.length,
      ]);
      // Garantiza salida y meta en los extremos del recorrido.
      await upsertEndpoint(tx, race.id, 'start', 'Salida', 0, route);
      await upsertEndpoint(tx, race.id, 'finish', 'Meta', route.length, route);
      // Recoloca los puntos intermedios sobre el nuevo trazado.
      const { rows } = await tx.query<any>(`SELECT id, distance_m FROM checkpoints WHERE race_id = $1 AND kind = 'split'`, [race.id]);
      for (const c of rows) {
        const d = Math.min(c.distance_m, route.length);
        const p = route.pointAt(d);
        await tx.query('UPDATE checkpoints SET distance_m = $2, lat = $3, lon = $4 WHERE id = $1', [c.id, d, p.lat, p.lon]);
      }
    });
    await audit(db, uid(req), 'race.route', 'race', race.id, { points: rounded.length, lengthM: Math.round(route.length) });
    await reloadLive(race.id);
    return { lengthM: route.length, points: rounded.length, isLoop: route.isLoop };
  });

  async function upsertEndpoint(tx: Queryable, raceId: string, kind: 'start' | 'finish', name: string, d: number, route: RouteModel) {
    const p = route.pointAt(d);
    const { rows } = await tx.query<any>('SELECT id FROM checkpoints WHERE race_id = $1 AND kind = $2', [raceId, kind]);
    if (rows[0]) await tx.query('UPDATE checkpoints SET distance_m = $2, lat = $3, lon = $4 WHERE id = $1', [rows[0].id, d, p.lat, p.lon]);
    else await tx.query('INSERT INTO checkpoints (race_id, name, kind, distance_m, lat, lon) VALUES ($1,$2,$3,$4,$5,$6)', [raceId, name, kind, d, p.lat, p.lon]);
  }

  app.put('/races/:id/categories', async (req) => {
    const race = await raceParam(req);
    assertEditable(race, req);
    const cats = z
      .array(z.object({ code: z.string().trim().min(1).max(20), name: z.string().trim().min(1).max(80) }))
      .max(50)
      .parse(req.body);
    await db.transaction(async (tx) => {
      await tx.query('DELETE FROM race_categories WHERE race_id = $1', [race.id]);
      for (const c of cats) await tx.query('INSERT INTO race_categories (race_id, code, name) VALUES ($1,$2,$3)', [race.id, c.code.toUpperCase(), c.name]);
    });
    await audit(db, uid(req), 'race.categories', 'race', race.id, { count: cats.length });
    return { categories: await listCategories(db, race.id) };
  });

  // ------------------------------------------------------- Puntos de control
  app.post('/races/:id/checkpoints', async (req, reply) => {
    const race = await raceParam(req);
    assertEditable(race, req);
    const b = checkpointBody.parse(req.body);
    if (!race.route || !race.routeLengthM) throw badRequest('Primero define el recorrido de la carrera');
    if (b.distanceM > race.routeLengthM) throw badRequest(`La distancia supera la longitud de la vuelta (${Math.round(race.routeLengthM)} m)`);
    if (b.kind !== 'split') {
      const { rows } = await db.query('SELECT 1 FROM checkpoints WHERE race_id = $1 AND kind = $2', [race.id, b.kind]);
      if (rows.length) throw conflict(`Ya existe un punto de tipo ${b.kind === 'start' ? 'salida' : 'meta'}`);
    }
    const route = new RouteModel(race.route.map(([lat, lon]) => ({ lat, lon })));
    const p = route.pointAt(b.distanceM);
    const { rows } = await db.query<any>(
      'INSERT INTO checkpoints (race_id, name, kind, distance_m, lat, lon) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
      [race.id, b.name, b.kind, b.distanceM, p.lat, p.lon],
    );
    await audit(db, uid(req), 'checkpoint.create', 'race', race.id, b);
    await reloadLive(race.id);
    return reply.status(201).send({ checkpoint: rows[0] });
  });

  app.patch<{ Params: { id: string; cpId: string } }>('/races/:id/checkpoints/:cpId', async (req) => {
    const race = await raceParam(req);
    assertEditable(race, req);
    const b = checkpointBody.partial().parse(req.body);
    const { rows } = await db.query<any>('SELECT * FROM checkpoints WHERE id = $1 AND race_id = $2', [uuid.parse(req.params.cpId), race.id]);
    if (!rows[0]) throw notFound('Punto de control');
    const d = b.distanceM ?? rows[0].distance_m;
    if (!race.route || d > (race.routeLengthM ?? 0)) throw badRequest('Distancia fuera del recorrido');
    const p = new RouteModel(race.route.map(([lat, lon]) => ({ lat, lon }))).pointAt(d);
    await db.query('UPDATE checkpoints SET name = $2, kind = $3, distance_m = $4, lat = $5, lon = $6 WHERE id = $1', [
      rows[0].id, b.name ?? rows[0].name, b.kind ?? rows[0].kind, d, p.lat, p.lon,
    ]);
    await audit(db, uid(req), 'checkpoint.update', 'checkpoint', rows[0].id, b);
    await reloadLive(race.id);
    return { ok: true };
  });

  app.delete<{ Params: { id: string; cpId: string } }>('/races/:id/checkpoints/:cpId', async (req) => {
    const race = await raceParam(req);
    assertEditable(race, req);
    const { rows } = await db.query<any>('DELETE FROM checkpoints WHERE id = $1 AND race_id = $2 RETURNING name', [uuid.parse(req.params.cpId), race.id]);
    if (!rows[0]) throw notFound('Punto de control');
    await audit(db, uid(req), 'checkpoint.delete', 'race', race.id, { name: rows[0].name });
    await reloadLive(race.id);
    return { ok: true };
  });

  // ----------------------------------------------------- Ciclo de la carrera
  app.post('/races/:id/start', async (req) => {
    const race = await raceParam(req);
    if (race.mode === 'demo') throw badRequest('Las carreras DEMO se inician desde los controles del simulador');
    if (race.status === 'live' || race.status === 'finished') throw conflict('La carrera ya está iniciada o finalizada');
    if (!race.route) throw badRequest('Define el recorrido antes de iniciar la carrera');
    const b = z.object({ at: isoDate.optional() }).parse(req.body ?? {});
    const at = b.at ?? new Date().toISOString();
    await db.query(`UPDATE races SET status = 'live', started_at = $2, updated_at = now() WHERE id = $1`, [race.id, at]);
    await db.query(`UPDATE participants SET status = 'racing' WHERE race_id = $1 AND status = 'registered'`, [race.id]);
    await audit(db, uid(req), 'race.start', 'race', race.id, { at });
    live.unload(race.id);
    await live.load(race.id);
    return { race: await getRace(db, race.id) };
  });

  app.post('/races/:id/finish', async (req) => {
    const race = await raceParam(req);
    if (race.status !== 'live') throw conflict('Solo se puede finalizar una carrera en curso');
    if (race.mode === 'demo') simulator.stop();
    const lr = await live.get(race.id);
    const standings = live.standings(lr);
    await db.transaction(async (tx) => {
      await tx.query('DELETE FROM results WHERE race_id = $1', [race.id]);
      for (const s of standings) {
        // Quien sigue "en carrera" al cerrar no ha llegado a meta → DNF.
        const status = s.status === 'racing' ? 'dnf' : s.status;
        const finished = s.status === 'finished';
        await tx.query(
          `INSERT INTO results (race_id, participant_id, position, status, total_time_ms, gap_ms, published_by) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [race.id, s.participantId, finished ? s.position : null, status, finished ? s.elapsedMs : null,
            finished && s.gapLeader.method === 'finish' ? s.gapLeader.ms : finished && s.position === 1 ? 0 : null, uid(req)],
        );
        if (s.status === 'racing') await tx.query(`UPDATE participants SET status = 'dnf' WHERE id = $1`, [s.participantId]);
      }
      await tx.query(`UPDATE races SET status = 'finished', finished_at = $2, updated_at = now() WHERE id = $1`, [
        race.id, new Date(live.now(race.id)).toISOString(),
      ]);
    });
    await audit(db, uid(req), 'race.finish', 'race', race.id, { participants: standings.length });
    live.unload(race.id);
    await live.load(race.id);
    return { race: await getRace(db, race.id) };
  });

  app.post('/races/:id/reopen', { preHandler: adminOnly }, async (req) => {
    const race = await raceParam(req);
    if (race.status !== 'finished') throw conflict('La carrera no está finalizada');
    await db.query('DELETE FROM results WHERE race_id = $1', [race.id]);
    await db.query(`UPDATE races SET status = 'live', finished_at = NULL, updated_at = now() WHERE id = $1`, [race.id]);
    await audit(db, uid(req), 'race.reopen', 'race', race.id);
    await reloadLive(race.id);
    return { race: await getRace(db, race.id) };
  });

  // ----------------------------------------------------------- Participantes
  app.get('/races/:id/participants', async (req) => {
    const race = await raceParam(req);
    const participants = await listParticipants(db, race.id);
    const { rows } = await db.query<any>(
      `SELECT a.participant_id, d.id, d.serial, d.label, d.is_simulated FROM device_assignments a JOIN devices d ON d.id = a.device_id
        WHERE a.race_id = $1 AND a.unassigned_at IS NULL`,
      [race.id],
    );
    const byP = new Map(rows.map((r) => [r.participant_id, { id: r.id, serial: r.serial, label: r.label, isSimulated: r.is_simulated }]));
    return { participants: participants.map((p) => ({ ...p, device: byP.get(p.id) ?? null })) };
  });

  async function insertParticipant(tx: Queryable, raceId: string, b: z.infer<typeof participantBody>, upsert: boolean) {
    const sql = `INSERT INTO participants (race_id, bib, first_name, last_name, team, country_code, category_code, start_time,
                    has_hr_sensor, public_hr, email, phone, emergency_contact, notes)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
                 ${
                   upsert
                     ? `ON CONFLICT (race_id, bib) DO UPDATE SET first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name,
                        team = EXCLUDED.team, country_code = EXCLUDED.country_code, category_code = EXCLUDED.category_code,
                        start_time = EXCLUDED.start_time, has_hr_sensor = EXCLUDED.has_hr_sensor, public_hr = EXCLUDED.public_hr,
                        email = EXCLUDED.email, phone = EXCLUDED.phone, emergency_contact = EXCLUDED.emergency_contact, notes = EXCLUDED.notes`
                     : ''
                 } RETURNING *`;
    const { rows } = await tx.query<any>(sql, [
      raceId, b.bib, b.firstName, b.lastName, b.team, b.countryCode, b.categoryCode || null, b.startTime ?? null,
      b.hasHrSensor, b.publicHr, b.email || null, b.phone || null, b.emergencyContact || null, b.notes || null,
    ]);
    return mapParticipant(rows[0]);
  }

  app.post('/races/:id/participants', async (req, reply) => {
    const race = await raceParam(req);
    assertEditable(race, req);
    const b = participantBody.parse(req.body);
    const p = await insertParticipant(db, race.id, b, false);
    await audit(db, uid(req), 'participant.create', 'participant', p.id, { bib: p.bib });
    await reloadLive(race.id);
    return reply.status(201).send({ participant: p });
  });

  app.patch<{ Params: { pid: string } }>('/participants/:pid', async (req) => {
    const { participant: cur, race } = await participantRace(req.params.pid);
    assertEditable(race, req);
    const b = participantBody.partial().extend({ status: z.enum(['registered', 'dns', 'racing', 'finished', 'dnf', 'dsq']).optional() }).parse(req.body);
    if (b.status === 'finished' && !cur.finishedAt) throw badRequest('Para marcar la llegada registra un paso manual por meta');
    // Solo se aplican los campos presentes en la petición (evita que los valores por defecto sobrescriban datos).
    const present = new Set(Object.keys((req.body as object) ?? {}));
    const merged = { ...cur, ...Object.fromEntries(Object.entries(b).filter(([k, v]) => v !== undefined && present.has(k))) } as typeof cur;
    await db.query(
      `UPDATE participants SET bib=$2, first_name=$3, last_name=$4, team=$5, country_code=$6, category_code=$7, start_time=$8,
              has_hr_sensor=$9, public_hr=$10, email=$11, phone=$12, emergency_contact=$13, notes=$14, status=$15
        WHERE id = $1`,
      [cur.id, merged.bib, merged.firstName, merged.lastName, merged.team, merged.countryCode, merged.categoryCode || null,
        merged.startTime, merged.hasHrSensor, merged.publicHr, merged.email || null, merged.phone || null,
        merged.emergencyContact || null, merged.notes || null, merged.status],
    );
    await audit(db, uid(req), 'participant.update', 'participant', cur.id, { bib: merged.bib, changes: Object.keys(b) });
    await reloadLive(race.id);
    return { ok: true };
  });

  app.delete<{ Params: { pid: string } }>('/participants/:pid', async (req) => {
    const { participant, race } = await participantRace(req.params.pid);
    assertEditable(race, req);
    if (race.status === 'live') throw conflict('No se puede borrar un participante con la carrera en curso (márcalo como DNS/DNF)');
    await db.query('DELETE FROM participants WHERE id = $1', [participant.id]);
    await audit(db, uid(req), 'participant.delete', 'participant', participant.id, { bib: participant.bib });
    await reloadLive(race.id);
    return { ok: true };
  });

  /**
   * Importación CSV. Columnas reconocidas (cabecera en español o inglés):
   * dorsal|bib, nombre|first_name, apellidos|last_name, equipo|team, pais|country,
   * categoria|category, email, telefono|phone, sensor_fc|hr_sensor, fc_publica|public_hr.
   */
  app.post('/races/:id/participants/import', async (req) => {
    const race = await raceParam(req);
    assertEditable(race, req);
    const b = z.object({ csv: z.string().min(1).max(5_000_000), dryRun: z.boolean().default(false) }).parse(req.body);
    const { headers, records } = csvToObjects(b.csv);
    const pick = (r: Record<string, string>, ...keys: string[]) => keys.map((k) => r[k]).find((v) => v !== undefined && v !== '') ?? '';
    const yes = (v: string) => /^(1|si|sí|yes|true|x)$/i.test(v.trim());
    const required = [['dorsal', 'bib'], ['nombre', 'first_name', 'firstname'], ['apellidos', 'apellido', 'last_name', 'lastname'], ['pais', 'country', 'nacionalidad', 'country_code']];
    const missing = required.filter((alts) => !alts.some((a) => headers.includes(a))).map((a) => a[0]);
    if (missing.length) throw badRequest(`Faltan columnas obligatorias: ${missing.join(', ')}`);

    const valid: z.infer<typeof participantBody>[] = [];
    const errors: { line: number; message: string }[] = [];
    const seen = new Set<number>();
    records.forEach((r, i) => {
      const res = participantBody.safeParse({
        bib: Number(pick(r, 'dorsal', 'bib')),
        firstName: pick(r, 'nombre', 'first_name', 'firstname'),
        lastName: pick(r, 'apellidos', 'apellido', 'last_name', 'lastname'),
        team: pick(r, 'equipo', 'team'),
        countryCode: pick(r, 'pais', 'country', 'nacionalidad', 'country_code'),
        categoryCode: pick(r, 'categoria', 'category') || null,
        email: pick(r, 'email', 'correo') || null,
        phone: pick(r, 'telefono', 'phone') || null,
        hasHrSensor: yes(pick(r, 'sensor_fc', 'hr_sensor')),
        publicHr: yes(pick(r, 'fc_publica', 'public_hr')),
      });
      if (!res.success) {
        errors.push({ line: i + 2, message: res.error.issues.map((x) => `${x.path.join('.')}: ${x.message}`).join('; ') });
      } else if (seen.has(res.data.bib)) {
        errors.push({ line: i + 2, message: `Dorsal ${res.data.bib} repetido en el archivo` });
      } else {
        seen.add(res.data.bib);
        valid.push(res.data);
      }
    });
    if (!b.dryRun && errors.length === 0) {
      await db.transaction(async (tx) => {
        for (const v of valid) await insertParticipant(tx, race.id, v, true);
      });
      await audit(db, uid(req), 'participant.import', 'race', race.id, { count: valid.length });
      await reloadLive(race.id);
    }
    return { total: records.length, valid: valid.length, errors, imported: !b.dryRun && errors.length === 0 ? valid.length : 0 };
  });

  /** Paso manual por un punto de control (juez de llegada, cronometraje de respaldo). */
  app.post<{ Params: { pid: string } }>('/participants/:pid/passings', async (req, reply) => {
    const { participant, race } = await participantRace(req.params.pid);
    assertEditable(race, req);
    if (!race.startedAt) throw badRequest('La carrera aún no ha comenzado');
    const b = z.object({ checkpointId: uuid, lap: z.number().int().min(1).max(200).default(1), passedAt: isoDate }).parse(req.body);
    const { rows } = await db.query('SELECT 1 FROM checkpoints WHERE id = $1 AND race_id = $2', [b.checkpointId, race.id]);
    if (!rows.length) throw notFound('Punto de control');
    if (Date.parse(b.passedAt) < Date.parse(race.startedAt)) throw badRequest('El paso no puede ser anterior a la salida');
    await db.query(
      `INSERT INTO checkpoint_passings (race_id, participant_id, checkpoint_id, lap, passed_at, source, created_by)
       VALUES ($1,$2,$3,$4,$5,'manual',$6)
       ON CONFLICT (participant_id, checkpoint_id, lap, source) DO UPDATE SET passed_at = EXCLUDED.passed_at, created_by = EXCLUDED.created_by`,
      [race.id, participant.id, b.checkpointId, b.lap, b.passedAt, uid(req)],
    );
    await live.onManualPassing(race.id, participant.id, {
      key: `${b.checkpointId}:${b.lap}`, checkpointId: b.checkpointId, lap: b.lap, passedAt: Date.parse(b.passedAt), source: 'manual',
    });
    await audit(db, uid(req), 'passing.manual', 'participant', participant.id, b);
    return reply.status(201).send({ ok: true });
  });

  // ------------------------------------------------------------ Dispositivos
  app.get('/devices', async () => {
    const { rows } = await db.query<any>(
      `SELECT d.id, d.serial, d.label, d.hardware, d.firmware, d.key_hint, d.is_simulated, d.active, d.last_seen_at,
              d.last_battery, d.last_rssi, d.last_network, d.created_at,
              a.race_id, a.participant_id, p.bib, p.first_name, p.last_name, r.name AS race_name, r.mode AS race_mode
         FROM devices d
         LEFT JOIN device_assignments a ON a.device_id = d.id AND a.unassigned_at IS NULL
         LEFT JOIN participants p ON p.id = a.participant_id
         LEFT JOIN races r ON r.id = a.race_id
        ORDER BY d.is_simulated, d.serial`,
    );
    return {
      devices: rows.map((r) => ({
        id: r.id, serial: r.serial, label: r.label, hardware: r.hardware, firmware: r.firmware, keyHint: r.key_hint,
        isSimulated: r.is_simulated, active: r.active, lastSeenAt: r.last_seen_at, battery: r.last_battery, rssi: r.last_rssi,
        network: r.last_network, createdAt: r.created_at,
        assignment: r.participant_id
          ? { raceId: r.race_id, raceName: r.race_name, raceMode: r.race_mode, participantId: r.participant_id, bib: r.bib, name: `${r.first_name} ${r.last_name}` }
          : null,
      })),
    };
  });

  app.post('/devices', async (req, reply) => {
    const b = deviceBody.parse(req.body);
    const secret = generateDeviceSecret();
    const { rows } = await db.query<any>(
      `INSERT INTO devices (serial, label, hardware, firmware, key_hash, key_hint) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, serial`,
      [b.serial, b.label, b.hardware, b.firmware ?? null, hashSecret(secret), secretHint(secret)],
    );
    await audit(db, uid(req), 'device.create', 'device', rows[0].id, { serial: b.serial });
    // El token completo solo se devuelve aquí: el servidor no puede recuperarlo después.
    return reply.status(201).send({ device: rows[0], token: `${rows[0].serial}.${secret}` });
  });

  app.patch<{ Params: { did: string } }>('/devices/:did', async (req) => {
    const present = new Set(Object.keys((req.body as object) ?? {}));
    const parsed = deviceBody.partial().extend({ active: z.boolean().optional() }).omit({ serial: true }).parse(req.body);
    const b = Object.fromEntries(Object.entries(parsed).filter(([k]) => present.has(k))) as typeof parsed;
    const { rows } = await db.query<any>(
      `UPDATE devices SET label = COALESCE($2, label), hardware = COALESCE($3, hardware), firmware = COALESCE($4, firmware),
              active = COALESCE($5, active) WHERE id = $1 RETURNING id`,
      [uuid.parse(req.params.did), b.label ?? null, b.hardware ?? null, b.firmware ?? null, b.active ?? null],
    );
    if (!rows[0]) throw notFound('Dispositivo');
    await audit(db, uid(req), 'device.update', 'device', rows[0].id, b);
    return { ok: true };
  });

  app.post<{ Params: { did: string } }>('/devices/:did/rotate-key', async (req) => {
    const secret = generateDeviceSecret();
    const { rows } = await db.query<any>(
      `UPDATE devices SET key_hash = $2, key_hint = $3 WHERE id = $1 AND NOT is_simulated RETURNING serial`,
      [uuid.parse(req.params.did), hashSecret(secret), secretHint(secret)],
    );
    if (!rows[0]) throw notFound('Dispositivo');
    await audit(db, uid(req), 'device.rotate_key', 'device', req.params.did);
    return { token: `${rows[0].serial}.${secret}` };
  });

  app.delete<{ Params: { did: string } }>('/devices/:did', { preHandler: adminOnly }, async (req) => {
    const id = uuid.parse(req.params.did);
    const { rows: pos } = await db.query<{ n: number }>('SELECT count(*)::int AS n FROM positions WHERE device_id = $1', [id]);
    if (pos[0].n > 0) throw conflict('El dispositivo tiene telemetría registrada: desactívalo en lugar de borrarlo');
    const { rows } = await db.query<any>('DELETE FROM devices WHERE id = $1 RETURNING serial', [id]);
    if (!rows[0]) throw notFound('Dispositivo');
    await audit(db, uid(req), 'device.delete', 'device', id, { serial: rows[0].serial });
    return { ok: true };
  });

  app.post<{ Params: { did: string } }>('/devices/:did/assign', async (req) => {
    const deviceId = uuid.parse(req.params.did);
    const { participantId } = z.object({ participantId: uuid }).parse(req.body);
    const { participant, race } = await participantRace(participantId);
    assertEditable(race, req);
    const { rows } = await db.query<any>('SELECT is_simulated FROM devices WHERE id = $1', [deviceId]);
    if (!rows[0]) throw notFound('Dispositivo');
    if (rows[0].is_simulated && race.mode !== 'demo') throw badRequest('Un dispositivo simulado solo puede asignarse a carreras DEMO');
    const affected = new Set<string>([race.id]);
    await db.transaction(async (tx) => {
      const prev = await tx.query<any>(
        `UPDATE device_assignments SET unassigned_at = now() WHERE unassigned_at IS NULL AND (device_id = $1 OR participant_id = $2) RETURNING race_id`,
        [deviceId, participant.id],
      );
      prev.rows.forEach((r) => affected.add(r.race_id));
      await tx.query('INSERT INTO device_assignments (device_id, race_id, participant_id) VALUES ($1,$2,$3)', [deviceId, race.id, participant.id]);
    });
    await audit(db, uid(req), 'device.assign', 'device', deviceId, { raceId: race.id, bib: participant.bib });
    for (const r of affected) await reloadLive(r);
    return { ok: true };
  });

  app.post<{ Params: { did: string } }>('/devices/:did/unassign', async (req) => {
    const { rows } = await db.query<any>(
      `UPDATE device_assignments SET unassigned_at = now() WHERE device_id = $1 AND unassigned_at IS NULL RETURNING race_id`,
      [uuid.parse(req.params.did)],
    );
    await audit(db, uid(req), 'device.unassign', 'device', req.params.did);
    for (const r of rows) await reloadLive(r.race_id);
    return { ok: true };
  });

  // -------------------------------------------------- Supervisión y exportación
  app.get('/races/:id/live', async (req) => {
    const race = await raceParam(req);
    return live.adminSnapshot(race.id);
  });

  app.get('/races/:id/positions', async (req) => {
    const race = await raceParam(req);
    const q = z
      .object({ participantId: uuid.optional(), limit: z.coerce.number().int().min(1).max(1000).default(200), flagged: z.coerce.boolean().optional() })
      .parse(req.query);
    const { rows } = await db.query<any>(
      `SELECT pos.id, pos.recorded_at, pos.received_at, pos.lat, pos.lon, pos.speed_kmh, pos.hdop, pos.satellites, pos.battery_pct,
              pos.rssi_dbm, pos.flags, pos.is_simulated, p.bib, d.serial
         FROM positions pos JOIN participants p ON p.id = pos.participant_id JOIN devices d ON d.id = pos.device_id
        WHERE pos.race_id = $1 AND ($2::uuid IS NULL OR pos.participant_id = $2) AND (NOT $3 OR cardinality(pos.flags) > 0)
        ORDER BY pos.received_at DESC LIMIT $4`,
      [race.id, q.participantId ?? null, q.flagged ?? false, q.limit],
    );
    return { positions: rows };
  });

  app.get('/races/:id/stats', async (req) => {
    const race = await raceParam(req);
    const { rows } = await db.query<any>(
      `SELECT p.id, p.bib, count(pos.id)::int AS positions,
              count(pos.id) FILTER (WHERE 'late' = ANY(pos.flags))::int AS late,
              min(pos.recorded_at) AS first_at, max(pos.recorded_at) AS last_at,
              (SELECT count(*)::int FROM heart_rate_samples h WHERE h.participant_id = p.id) AS hr_samples
         FROM participants p LEFT JOIN positions pos ON pos.participant_id = p.id
        WHERE p.race_id = $1 GROUP BY p.id, p.bib ORDER BY p.bib`,
      [race.id],
    );
    const totals = rows.reduce((a, r) => ({ positions: a.positions + r.positions, late: a.late + r.late, hr: a.hr + r.hr_samples }), {
      positions: 0, late: 0, hr: 0,
    });
    return { totals, participants: rows };
  });

  app.get('/races/:id/export', async (req, reply) => {
    const race = await raceParam(req);
    const q = z.object({ type: z.enum(['results', 'standings', 'positions', 'passings']), format: z.enum(['csv', 'json']).default('csv') }).parse(req.query);
    let headers: string[] = [];
    let data: unknown[][] = [];
    if (q.type === 'results' || q.type === 'standings') {
      if (q.type === 'results') {
        const { rows } = await db.query<any>(
          `SELECT r.position, p.bib, p.first_name, p.last_name, p.team, p.country_code, p.category_code, r.status, r.total_time_ms, r.gap_ms
             FROM results r JOIN participants p ON p.id = r.participant_id WHERE r.race_id = $1 ORDER BY r.position NULLS LAST, p.bib`,
          [race.id],
        );
        headers = ['posicion', 'dorsal', 'nombre', 'apellidos', 'equipo', 'pais', 'categoria', 'estado', 'tiempo_ms', 'diferencia_ms'];
        data = rows.map((r) => [r.position, r.bib, r.first_name, r.last_name, r.team, r.country_code, r.category_code, r.status, r.total_time_ms, r.gap_ms]);
      } else {
        const snap = await live.adminSnapshot(race.id);
        headers = ['posicion', 'dorsal', 'nombre', 'apellidos', 'equipo', 'pais', 'estado', 'tiempo_ms', 'dif_lider_ms', 'metodo_dif', 'dif_anterior_ms', 'progreso_m', 'velocidad_kmh', 'frescura'];
        data = snap.rows.map((r) => [r.position, r.bib, r.firstName, r.lastName, r.team, r.countryCode, r.status, r.elapsedMs, r.gapLeader.ms, r.gapLeader.method, r.gapPrev.ms, r.progress !== null ? Math.round(r.progress) : null, r.speedKmh, r.freshness]);
      }
    } else if (q.type === 'positions') {
      const { rows } = await db.query<any>(
        `SELECT p.bib, d.serial, pos.recorded_at, pos.received_at, pos.lat, pos.lon, pos.alt_m, pos.speed_kmh, pos.hdop, pos.satellites,
                pos.battery_pct, pos.rssi_dbm, array_to_string(pos.flags, '|') AS flags, pos.is_simulated
           FROM positions pos JOIN participants p ON p.id = pos.participant_id JOIN devices d ON d.id = pos.device_id
          WHERE pos.race_id = $1 ORDER BY pos.recorded_at`,
        [race.id],
      );
      headers = ['dorsal', 'dispositivo', 'registrado_utc', 'recibido_utc', 'lat', 'lon', 'alt_m', 'velocidad_kmh', 'hdop', 'satelites', 'bateria_pct', 'rssi_dbm', 'marcas', 'simulado'];
      data = rows.map((r) => [r.bib, r.serial, new Date(r.recorded_at).toISOString(), new Date(r.received_at).toISOString(), r.lat, r.lon, r.alt_m, r.speed_kmh, r.hdop, r.satellites, r.battery_pct, r.rssi_dbm, r.flags, r.is_simulated]);
    } else {
      const { rows } = await db.query<any>(
        `SELECT p.bib, c.name, cp.lap, cp.passed_at, cp.source FROM checkpoint_passings cp
           JOIN participants p ON p.id = cp.participant_id JOIN checkpoints c ON c.id = cp.checkpoint_id
          WHERE cp.race_id = $1 ORDER BY cp.passed_at`,
        [race.id],
      );
      headers = ['dorsal', 'punto_control', 'vuelta', 'paso_utc', 'fuente'];
      data = rows.map((r) => [r.bib, r.name, r.lap, new Date(r.passed_at).toISOString(), r.source]);
    }
    const base = `${race.slug}-${q.type}${race.mode === 'demo' ? '-DEMO' : ''}`;
    await audit(db, uid(req), 'race.export', 'race', race.id, q);
    if (q.format === 'json') {
      reply.header('Content-Disposition', `attachment; filename="${base}.json"`);
      return { race: { id: race.id, name: race.name, mode: race.mode }, columns: headers, rows: data };
    }
    reply.header('Content-Type', 'text/csv; charset=utf-8');
    reply.header('Content-Disposition', `attachment; filename="${base}.csv"`);
    return '﻿' + toCsv(headers, data);
  });

  // ------------------------------------------------------------ Simulador DEMO
  async function demoRaceId(body: unknown) {
    const { raceId } = z.object({ raceId: uuid.optional() }).parse(body ?? {});
    const race = await getRace(db, raceId ?? DEMO_SLUG);
    if (race.mode !== 'demo') throw badRequest('El simulador solo funciona con carreras DEMO');
    return race.id;
  }
  app.get('/demo/status', async () => simulator.status());
  app.post('/demo/start', async (req) => {
    const id = await demoRaceId(req.body);
    await simulator.start(id);
    await audit(db, uid(req), 'demo.start', 'race', id);
    return simulator.status();
  });
  app.post('/demo/pause', async () => (simulator.pause(), simulator.status()));
  app.post('/demo/resume', async () => (simulator.resume(), simulator.status()));
  app.post('/demo/reset', async (req) => {
    const id = await demoRaceId(req.body);
    simulator.autoLoop = false;
    await simulator.reset(id);
    await audit(db, uid(req), 'demo.reset', 'race', id);
    return simulator.status();
  });
  app.post('/demo/speed', async (req) => {
    const { speed } = z.object({ speed: z.number().min(1).max(60) }).parse(req.body);
    simulator.setSpeed(speed);
    return simulator.status();
  });
  app.post('/demo/loop', async (req) => {
    simulator.autoLoop = z.object({ enabled: z.boolean() }).parse(req.body).enabled;
    return simulator.status();
  });

  // ---------------------------------------------------------------- Usuarios
  app.get('/users', { preHandler: adminOnly }, async () => {
    const { rows } = await db.query('SELECT id, email, name, role, disabled, created_at FROM users ORDER BY created_at');
    return { users: rows };
  });

  const userBody = z.object({
    email: z.string().trim().email().max(200),
    name: z.string().trim().min(1).max(120),
    role: z.enum(['admin', 'organizer']),
    password: z.string().min(10, 'La contraseña debe tener al menos 10 caracteres').max(200),
  });

  app.post('/users', { preHandler: adminOnly }, async (req, reply) => {
    const b = userBody.parse(req.body);
    const { rows } = await db.query<any>(
      'INSERT INTO users (email, name, role, password_hash) VALUES ($1,$2,$3,$4) RETURNING id, email, name, role',
      [b.email.toLowerCase(), b.name, b.role, await hashPassword(b.password)],
    );
    await audit(db, uid(req), 'user.create', 'user', rows[0].id, { email: b.email, role: b.role });
    return reply.status(201).send({ user: rows[0] });
  });

  app.patch<{ Params: { userId: string } }>('/users/:userId', { preHandler: adminOnly }, async (req) => {
    const id = uuid.parse(req.params.userId);
    const b = userBody.partial().extend({ disabled: z.boolean().optional() }).parse(req.body);
    if (id === uid(req) && (b.disabled || (b.role && b.role !== 'admin'))) throw badRequest('No puedes desactivarte ni quitarte el rol de administrador');
    const { rows } = await db.query<any>(
      `UPDATE users SET name = COALESCE($2, name), role = COALESCE($3, role), disabled = COALESCE($4, disabled),
              password_hash = COALESCE($5, password_hash) WHERE id = $1 RETURNING id`,
      [id, b.name ?? null, b.role ?? null, b.disabled ?? null, b.password ? await hashPassword(b.password) : null],
    );
    if (!rows[0]) throw notFound('Usuario');
    await audit(db, uid(req), 'user.update', 'user', id, { ...b, password: b.password ? '[cambiada]' : undefined });
    return { ok: true };
  });

  app.get('/audit', { preHandler: adminOnly }, async (req) => {
    const { limit } = z.object({ limit: z.coerce.number().int().min(1).max(500).default(100) }).parse(req.query);
    const { rows } = await db.query(
      `SELECT a.id, a.at, a.action, a.entity, a.entity_id, a.details, u.email FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
        ORDER BY a.at DESC LIMIT $1`,
      [limit],
    );
    return { entries: rows };
  });
}
