import { createRequire } from 'node:module';
import type { Db } from '../db/index.js';
import { generateDeviceSecret, hashSecret, secretHint } from '../lib/keys.js';
import { logger } from '../lib/logger.js';
import { RouteModel } from '../timing/route.js';

const require = createRequire(import.meta.url);
/** Trazado por carretera Boca Chica → Juan Dolio → San Pedro de Macorís (OSRM / © OpenStreetMap). */
const ROUTE: [number, number][] = require('./costa-este-route.json');

export const DEMO_SLUG = 'demo-gran-fondo-costa-este';

/** Participantes ficticios: los nombres son inventados y no corresponden a personas reales. */
export const DEMO_RIDERS = [
  { bib: 1, first: 'Mateo', last: 'Rojas', country: 'CO', team: 'Caribe Demo Racing', cat: 'ELITE', hr: true, publicHr: true },
  { bib: 2, first: 'Lucas', last: 'Moreau', country: 'FR', team: 'Atlántico Demo Cycling', cat: 'ELITE', hr: true, publicHr: true },
  { bib: 3, first: 'Giulio', last: 'Ferretti', country: 'IT', team: 'Costa Este Demo Team', cat: 'ELITE', hr: false, publicHr: false },
  { bib: 4, first: 'Jonas', last: 'Weber', country: 'DE', team: 'Sierra Demo Pro', cat: 'ELITE', hr: true, publicHr: true },
  { bib: 5, first: 'Tiago', last: 'Mendes', country: 'PT', team: 'Caribe Demo Racing', cat: 'SUB23', hr: true, publicHr: true },
  { bib: 6, first: 'Wout', last: 'Claes', country: 'BE', team: 'Atlántico Demo Cycling', cat: 'ELITE', hr: true, publicHr: false },
  { bib: 7, first: 'Daan', last: 'Visser', country: 'NL', team: 'Costa Este Demo Team', cat: 'SUB23', hr: true, publicHr: true },
  { bib: 8, first: 'Oliver', last: 'Hughes', country: 'GB', team: 'Sierra Demo Pro', cat: 'ELITE', hr: false, publicHr: false },
  { bib: 9, first: 'Ethan', last: 'Brooks', country: 'US', team: 'Caribe Demo Racing', cat: 'MASTER', hr: true, publicHr: true },
  { bib: 10, first: 'Javier', last: 'Ortega', country: 'ES', team: 'Atlántico Demo Cycling', cat: 'MASTER', hr: true, publicHr: true },
  { bib: 11, first: 'Luis', last: 'Peña', country: 'DO', team: 'Costa Este Demo Team', cat: 'SUB23', hr: true, publicHr: true },
  { bib: 12, first: 'Andrés', last: 'Salcedo', country: 'VE', team: 'Sierra Demo Pro', cat: 'MASTER', hr: false, publicHr: false },
] as const;

/** Dorsales sin dispositivo asignado (para mostrar "sin datos"). */
export const DEMO_NO_DEVICE = new Set([12]);

export async function ensureDemoRace(db: Db): Promise<string> {
  const existing = await db.query<{ id: string }>('SELECT id FROM races WHERE slug = $1', [DEMO_SLUG]);
  if (existing.rows[0]) return existing.rows[0].id;

  const route = new RouteModel(ROUTE.map(([lat, lon]) => ({ lat, lon })));
  const id = await db.transaction(async (tx) => {
    const today = new Date();
    today.setUTCHours(13, 0, 0, 0);
    const { rows } = await tx.query<{ id: string }>(
      `INSERT INTO races (slug, name, description, location, discipline, mode, status, scheduled_start, laps, route, route_length_m)
       VALUES ($1,$2,$3,$4,'cycling_road','demo','scheduled',$5,1,$6,$7) RETURNING id`,
      [
        DEMO_SLUG,
        'Gran Fondo Costa Este',
        'Carrera de demostración con ciclistas y telemetría simulados. Ningún dato de esta carrera es real.',
        'Boca Chica → San Pedro de Macorís, República Dominicana',
        today.toISOString(),
        JSON.stringify(ROUTE),
        route.length,
      ],
    );
    const raceId = rows[0].id;
    for (const [code, name] of [
      ['ELITE', 'Élite'],
      ['SUB23', 'Sub-23'],
      ['MASTER', 'Máster'],
    ]) {
      await tx.query('INSERT INTO race_categories (race_id, code, name) VALUES ($1,$2,$3)', [raceId, code, name]);
    }
    await tx.query(`INSERT INTO race_segments (race_id, seq, discipline, name) VALUES ($1, 1, 'bike', 'Ciclismo')`, [raceId]);

    const cps: [string, 'start' | 'split' | 'finish', number][] = [
      ['Salida · Boca Chica', 'start', 0],
      ['Guayacanes', 'split', 12_000],
      ['Juan Dolio', 'split', 21_000],
      ['Km 30', 'split', 30_000],
      ['Meta · San Pedro de Macorís', 'finish', route.length],
    ];
    for (const [name, kind, d] of cps) {
      const p = route.pointAt(d);
      await tx.query('INSERT INTO checkpoints (race_id, name, kind, distance_m, lat, lon) VALUES ($1,$2,$3,$4,$5,$6)', [
        raceId, name, kind, d, p.lat, p.lon,
      ]);
    }

    for (const r of DEMO_RIDERS) {
      const p = await tx.query<{ id: string }>(
        `INSERT INTO participants (race_id, bib, first_name, last_name, team, country_code, category_code, has_hr_sensor, public_hr)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
        [raceId, r.bib, r.first, r.last, r.team, r.country, r.cat, r.hr, r.publicHr],
      );
      if (DEMO_NO_DEVICE.has(r.bib)) continue;
      const serial = `SIM-${String(r.bib).padStart(3, '0')}`;
      // Los dispositivos virtuales reciben una clave aleatoria que nunca se muestra:
      // solo el simulador interno envía datos en su nombre.
      const secret = generateDeviceSecret();
      const d = await tx.query<{ id: string }>(
        `INSERT INTO devices (serial, label, hardware, key_hash, key_hint, is_simulated)
         VALUES ($1,$2,'Simulador DEMO',$3,$4,true)
         ON CONFLICT (serial) DO UPDATE SET is_simulated = true RETURNING id`,
        [serial, `Dispositivo virtual ${serial}`, hashSecret(secret), secretHint(secret)],
      );
      await tx.query(
        `UPDATE device_assignments SET unassigned_at = now() WHERE device_id = $1 AND unassigned_at IS NULL`,
        [d.rows[0].id],
      );
      await tx.query('INSERT INTO device_assignments (device_id, race_id, participant_id) VALUES ($1,$2,$3)', [
        d.rows[0].id, raceId, p.rows[0].id,
      ]);
    }
    return raceId;
  });
  logger.info({ slug: DEMO_SLUG }, 'Carrera DEMO creada');
  return id;
}
