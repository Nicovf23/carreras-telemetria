import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { notFound } from '../lib/errors.js';
import { resolvePassings } from '../timing/standings.js';
import { getRace, listCategories, listCheckpoints, mapRace, type Race } from '../services/races.js';

/** Campos de la carrera visibles públicamente. */
export function publicRace(r: Race) {
  return {
    id: r.id,
    slug: r.slug,
    name: r.name,
    description: r.description,
    location: r.location,
    discipline: r.discipline,
    mode: r.mode,
    status: r.status,
    scheduledStart: r.scheduledStart,
    startedAt: r.startedAt,
    finishedAt: r.finishedAt,
    timezone: r.timezone,
    laps: r.laps,
    routeLengthM: r.routeLengthM,
  };
}

/** Reduce un trazado a como máximo `max` puntos (submuestreo uniforme, conserva extremos). */
function downsample<T>(arr: T[], max: number): T[] {
  if (arr.length <= max) return arr;
  const step = (arr.length - 1) / (max - 1);
  return Array.from({ length: max }, (_, i) => arr[Math.round(i * step)]);
}

export async function registerPublicRoutes(app: FastifyInstance) {
  const { db, live } = app.services;

  async function publicRaceOr404(slug: string) {
    const race = await getRace(db, slug);
    if (race.status === 'draft') throw notFound('Carrera');
    return race;
  }

  app.get('/races', async () => {
    const { rows } = await db.query<any>(
      `SELECT r.*, (SELECT count(*)::int FROM participants p WHERE p.race_id = r.id) AS participant_count
         FROM races r WHERE r.status <> 'draft'
        ORDER BY CASE r.status WHEN 'live' THEN 0 WHEN 'scheduled' THEN 1 WHEN 'finished' THEN 2 ELSE 3 END,
                 r.scheduled_start NULLS LAST`,
    );
    return { races: rows.map((r) => ({ ...publicRace(mapRace(r)), participantCount: r.participant_count })) };
  });

  app.get<{ Params: { slug: string } }>('/races/:slug', async (req) => {
    const race = await publicRaceOr404(req.params.slug);
    const [checkpoints, categories] = await Promise.all([listCheckpoints(db, race.id), listCategories(db, race.id)]);
    return {
      race: { ...publicRace(race), route: race.route },
      categories,
      checkpoints: checkpoints.map(({ raceId: _r, ...c }) => c),
    };
  });

  app.get<{ Params: { slug: string } }>('/races/:slug/live', async (req) => {
    const race = await publicRaceOr404(req.params.slug);
    return live.publicSnapshot(race.id);
  });

  app.get<{ Params: { slug: string; bib: string } }>('/races/:slug/participants/:bib', async (req) => {
    const race = await publicRaceOr404(req.params.slug);
    const bib = z.coerce.number().int().positive().parse(req.params.bib);
    const snap = await live.publicSnapshot(race.id);
    const row = snap.rows.find((r) => r.bib === bib);
    if (!row) throw notFound('Participante');

    const { rows: pRows } = await db.query<any>('SELECT public_hr, has_hr_sensor FROM participants WHERE id = $1', [row.participantId]);
    const pos = await db.query<any>(
      `SELECT recorded_at, lat, lon, speed_kmh, alt_m FROM positions WHERE participant_id = $1 ORDER BY recorded_at`,
      [row.participantId],
    );
    const track = downsample(pos.rows, 1500).map((r) => ({
      t: new Date(r.recorded_at).toISOString(),
      lat: r.lat,
      lon: r.lon,
      speedKmh: r.speed_kmh,
      altM: r.alt_m,
    }));

    // La frecuencia cardíaca es un dato de salud: solo se publica con consentimiento.
    let heartRate: { t: string; bpm: number }[] | null = null;
    if (pRows[0]?.has_hr_sensor && pRows[0]?.public_hr) {
      const hr = await db.query<any>(`SELECT recorded_at, bpm FROM heart_rate_samples WHERE participant_id = $1 ORDER BY recorded_at`, [
        row.participantId,
      ]);
      heartRate = downsample(hr.rows, 1500).map((r) => ({ t: new Date(r.recorded_at).toISOString(), bpm: r.bpm }));
    }

    const lr = await live.get(race.id);
    const ps = lr.ps.get(row.participantId);
    const cpByKey = new Map((lr.course?.checkpoints ?? []).map((c) => [c.key, c]));
    const start = row.startTime ? Date.parse(row.startTime) : null;
    const splits = resolvePassings(ps?.passings ?? [])
      .map((p) => {
        const cp = cpByKey.get(p.key);
        return cp
          ? {
              checkpoint: cp.name,
              lap: cp.lap,
              distanceM: cp.courseDistance,
              passedAt: new Date(p.passedAt).toISOString(),
              elapsedMs: start !== null ? p.passedAt - start : null,
              source: p.source,
            }
          : null;
      })
      .filter(Boolean);

    return { race: publicRace(race), clock: snap.clock, participant: row, splits, track, heartRate };
  });

  /**
   * Reinicia la simulación de una carrera DEMO desde la web pública. Solo afecta a datos
   * simulados (se rechaza en carreras oficiales) y está limitado para evitar abusos.
   */
  app.post<{ Params: { slug: string } }>(
    '/races/:slug/demo/restart',
    { config: { rateLimit: { max: 3, timeWindow: '1 minute' } } },
    async (req) => {
      const race = await publicRaceOr404(req.params.slug);
      if (race.mode !== 'demo') throw notFound('Carrera DEMO');
      await app.services.simulator.start(race.id);
      req.log.info({ raceId: race.id }, 'Simulación DEMO reiniciada desde la web pública');
      return app.services.simulator.status();
    },
  );

  app.get<{ Params: { slug: string } }>('/races/:slug/results', async (req) => {
    const race = await publicRaceOr404(req.params.slug);
    const { rows } = await db.query<any>(
      `SELECT r.position, r.status, r.total_time_ms, r.gap_ms, r.published_at,
              p.bib, p.first_name, p.last_name, p.team, p.country_code, p.category_code
         FROM results r JOIN participants p ON p.id = r.participant_id
        WHERE r.race_id = $1 ORDER BY r.position NULLS LAST, p.bib`,
      [race.id],
    );
    return {
      race: publicRace(race),
      official: race.mode === 'official',
      results: rows.map((r) => ({
        position: r.position,
        status: r.status,
        totalTimeMs: r.total_time_ms,
        gapMs: r.gap_ms,
        bib: r.bib,
        firstName: r.first_name,
        lastName: r.last_name,
        team: r.team,
        countryCode: String(r.country_code).trim(),
        categoryCode: r.category_code,
        publishedAt: r.published_at,
      })),
    };
  });
}
