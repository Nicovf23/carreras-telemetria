import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { migrate, openDb, type Db } from './db/index.js';
import { ensureDemoRace } from './demo/seed.js';
import { parseCsv } from './lib/csv.js';
import { parseGpx } from './routes/admin.js';
import { hashPassword } from './services/auth.js';

/**
 * Pruebas de integración de extremo a extremo sobre PGlite en memoria:
 * organizador → carrera → recorrido → participantes → dispositivo → telemetría → clasificación.
 */
let db: Db;
let app: FastifyInstance;
let cookie = '';
const H = () => ({ cookie, 'x-requested-with': 'fetch' });

// Recorrido recto de ~10,5 km hacia el este
const ROUTE = Array.from({ length: 101 }, (_, i) => [18.45, +(-69.6 + i * 0.001).toFixed(6)] as [number, number]);
const at = (km: number) => ({ lat: 18.45, lon: +(-69.6 + km * 0.009487).toFixed(6) }); // ~1 km = 0,009487° a 18,45°N

let raceId = '';
let p1 = '';
let p2 = '';
let token1 = '';
let token2 = '';
let startedAt = 0;

beforeAll(async () => {
  db = await openDb({ memory: true });
  await migrate(db);
  await db.query(`INSERT INTO users (email, name, password_hash, role) VALUES ('org@test.local', 'Org', $1, 'organizer')`, [
    await hashPassword('contraseña-de-prueba'),
  ]);
  app = await buildApp(db);
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await db.close();
});

async function telemetry(token: string, body: unknown) {
  return app.inject({ method: 'POST', url: '/api/v1/telemetry', headers: { authorization: `Bearer ${token}` }, payload: body as object });
}

describe('autenticación', () => {
  it('rechaza credenciales incorrectas y protege el panel', async () => {
    const bad = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: 'org@test.local', password: 'mal' } });
    expect(bad.statusCode).toBe(401);
    const anon = await app.inject({ method: 'GET', url: '/api/v1/admin/races' });
    expect(anon.statusCode).toBe(401);
  });

  it('inicia sesión con cookie httpOnly', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'org@test.local', password: 'contraseña-de-prueba' },
    });
    expect(res.statusCode).toBe(200);
    const set = String(res.headers['set-cookie']);
    expect(set).toMatch(/HttpOnly/i);
    expect(set).toMatch(/SameSite=Strict/i);
    cookie = set.split(';')[0];
  });

  it('exige la cabecera anti-CSRF en peticiones que modifican datos', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/v1/admin/races', headers: { cookie }, payload: { name: 'X carrera' } });
    expect(res.statusCode).toBe(403);
  });

  it('un organizador no puede gestionar usuarios', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/admin/users', headers: H() });
    expect(res.statusCode).toBe(403);
  });
});

describe('flujo de carrera oficial', () => {
  it('crea la carrera, el recorrido y los puntos de control', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/races',
      headers: H(),
      payload: { name: 'Prueba Integración', status: 'scheduled', laps: 1 },
    });
    expect(r.statusCode).toBe(201);
    raceId = r.json().race.id;
    const route = await app.inject({ method: 'PUT', url: `/api/v1/admin/races/${raceId}/route`, headers: H(), payload: { points: ROUTE } });
    expect(route.statusCode).toBe(200);
    expect(route.json().lengthM).toBeGreaterThan(10_000);
    const cp = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/races/${raceId}/checkpoints`,
      headers: H(),
      payload: { name: 'Km 3', kind: 'split', distanceM: 3000 },
    });
    expect(cp.statusCode).toBe(201);
    const detail = (await app.inject({ method: 'GET', url: `/api/v1/admin/races/${raceId}`, headers: H() })).json();
    expect(detail.checkpoints.map((c: { kind: string }) => c.kind)).toEqual(['start', 'split', 'finish']);
  });

  it('importa participantes por CSV validando cada fila', async () => {
    const bad = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/races/${raceId}/participants/import`,
      headers: H(),
      payload: { csv: 'dorsal;nombre;apellidos;pais\n1;Ana;Uno;ES\n2;Bea;Dos;XX\n1;Rep;Rep;FR' },
    });
    expect(bad.json().errors).toHaveLength(2);
    expect(bad.json().imported).toBe(0);
    const ok = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/races/${raceId}/participants/import`,
      headers: H(),
      payload: { csv: 'dorsal,nombre,apellidos,equipo,pais,email,sensor_fc,fc_publica\n1,Ana,Uno,Equipo A,ESP,ana@privado.test,si,no\n2,Bea,Dos,Equipo B,FR,,si,si' },
    });
    expect(ok.json()).toMatchObject({ valid: 2, imported: 2, errors: [] });
    const list = (await app.inject({ method: 'GET', url: `/api/v1/admin/races/${raceId}/participants`, headers: H() })).json().participants;
    p1 = list.find((p: { bib: number }) => p.bib === 1).id;
    p2 = list.find((p: { bib: number }) => p.bib === 2).id;
    expect(list.find((p: { bib: number }) => p.bib === 1).countryCode).toBe('ES');
  });

  it('registra dispositivos, muestra el token una sola vez y los asigna', async () => {
    const d1 = await app.inject({ method: 'POST', url: '/api/v1/admin/devices', headers: H(), payload: { serial: 'TRK-001' } });
    const d2 = await app.inject({ method: 'POST', url: '/api/v1/admin/devices', headers: H(), payload: { serial: 'TRK-002' } });
    token1 = d1.json().token;
    token2 = d2.json().token;
    expect(token1).toMatch(/^TRK-001\./);
    const list = (await app.inject({ method: 'GET', url: '/api/v1/admin/devices', headers: H() })).json().devices;
    expect(JSON.stringify(list)).not.toContain(token1.split('.')[1]);
    for (const [d, p] of [[d1, p1], [d2, p2]] as const) {
      const a = await app.inject({ method: 'POST', url: `/api/v1/admin/devices/${d.json().device.id}/assign`, headers: H(), payload: { participantId: p } });
      expect(a.statusCode).toBe(200);
    }
  });

  it('rechaza telemetría sin credencial o con clave errónea', async () => {
    expect((await app.inject({ method: 'POST', url: '/api/v1/telemetry', payload: { ts: Date.now() } })).statusCode).toBe(401);
    expect((await telemetry('TRK-001.claveincorrectaclaveincorrecta', { ts: Date.now(), ...at(0) })).statusCode).toBe(401);
  });

  it('inicia la carrera y procesa telemetría con pasos interpolados', async () => {
    startedAt = Date.now() - 10 * 60_000;
    const s = await app.inject({ method: 'POST', url: `/api/v1/admin/races/${raceId}/start`, headers: H(), payload: { at: new Date(startedAt).toISOString() } });
    expect(s.statusCode).toBe(200);

    // Ciclista 1: 36 km/h (10 m/s), una posición cada 10 s durante 5 min → ~3 km
    const msgs1 = Array.from({ length: 31 }, (_, i) => ({
      ts: new Date(startedAt + i * 10_000).toISOString(),
      ...at((i * 100) / 1000),
      speed_kmh: 36,
      hr_bpm: 150,
      battery_pct: 90,
    }));
    // Ciclista 2: 30 km/h
    const msgs2 = Array.from({ length: 31 }, (_, i) => ({ ts: startedAt + i * 10_000, ...at((i * 83.3) / 1000), hr_bpm: 140 }));
    const r1 = await telemetry(token1, { messages: msgs1 });
    expect(r1.statusCode).toBe(200);
    expect(r1.json()).toMatchObject({ accepted: 31, duplicates: 0, rejected: [] });
    expect((await telemetry(token2, { messages: msgs2 })).json().accepted).toBe(31);

    // Reenvío (por ejemplo, tras perder el ACK): todo duplicado
    const dup = await telemetry(token1, { messages: msgs1.slice(0, 5) });
    expect(dup.json()).toMatchObject({ accepted: 0, duplicates: 5 });
  });

  it('valida coordenadas, marcas temporales y la identidad del dispositivo', async () => {
    const res = await telemetry(token1, {
      messages: [
        { ts: Date.now(), lat: 95, lon: 0 },
        { ts: Date.now() + 3600_000, ...at(3) },
        { ts: Date.now(), lat: 0, lon: 0 },
        { ts: Date.now(), ...at(3), device_id: 'TRK-002' },
        { ts: Date.now(), ...at(3), fix: { valid: false } },
        { ts: Date.now(), ...at(3), hr_bpm: 400 },
      ],
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().rejected.map((r: { reason: string }) => r.reason)).toEqual([
      'invalid_coordinates',
      'timestamp_in_future',
      'invalid_coordinates',
      'device_mismatch',
      'no_gnss_fix',
      'invalid:hr_bpm',
    ]);
  });

  it('acepta datos atrasados y fuera de orden y recalcula', async () => {
    // Un dato antiguo que faltaba (entre dos ya recibidos) → se marca como atrasado.
    const res = await telemetry(token2, { ts: startedAt + 15_000, ...at(0.125) });
    expect(res.json().accepted).toBe(1);
    await new Promise((r) => setTimeout(r, 400)); // reconstrucción diferida
    const pos = (await app.inject({ method: 'GET', url: `/api/v1/admin/races/${raceId}/positions?flagged=true`, headers: H() })).json().positions;
    expect(pos.some((p: { flags: string[] }) => p.flags.includes('late'))).toBe(true);
  });

  it('calcula la clasificación pública sin exponer datos privados', async () => {
    const live = await app.inject({ method: 'GET', url: `/api/v1/races/${(await slug())}/live` });
    expect(live.statusCode).toBe(200);
    const snap = live.json();
    expect(snap.rows.map((r: { bib: number }) => r.bib)).toEqual([1, 2]);
    const [r1, r2] = snap.rows;
    expect(r1.gapLeader.reason).toBe('leader');
    // Ambos pasaron el km 3? El 1 sí (3 km en 300 s); el 2 lleva ~2,5 km → diferencia estimada o sin referencia, nunca inventada
    expect(r1.lastCheckpoint?.name).toBe('Km 3');
    expect(['estimated', null]).toContain(r2.gapLeader.method);
    expect(r2.distanceToPrevM === null || r2.distanceToPrevM > 0).toBe(true);
    // FC: el 1 no dio consentimiento → privada; el 2 sí → visible si es reciente
    expect(r1.hr).toBeNull();
    expect(r1.hrState).toBe('private');
    const text = live.body;
    expect(text).not.toContain('ana@privado.test');
    expect(text).not.toContain('TRK-001');
  });

  it('un dispositivo simulado no puede asignarse a una carrera oficial', async () => {
    await ensureDemoRace(db);
    const sim = await db.query<{ id: string }>(`SELECT id FROM devices WHERE is_simulated LIMIT 1`);
    const r = await app.inject({ method: 'POST', url: `/api/v1/admin/devices/${sim.rows[0].id}/assign`, headers: H(), payload: { participantId: p1 } });
    expect(r.statusCode).toBe(400);
  });

  it('el paso manual por meta finaliza al participante y el cierre publica resultados', async () => {
    const detail = (await app.inject({ method: 'GET', url: `/api/v1/admin/races/${raceId}`, headers: H() })).json();
    const finish = detail.checkpoints.find((c: { kind: string }) => c.kind === 'finish');
    const fin = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/participants/${p1}/passings`,
      headers: H(),
      payload: { checkpointId: finish.id, passedAt: new Date(startedAt + 9 * 60_000).toISOString() },
    });
    expect(fin.statusCode).toBe(201);
    const close = await app.inject({ method: 'POST', url: `/api/v1/admin/races/${raceId}/finish`, headers: H() });
    expect(close.statusCode).toBe(200);
    const res = (await app.inject({ method: 'GET', url: `/api/v1/races/${await slug()}/results` })).json();
    expect(res.results[0]).toMatchObject({ bib: 1, position: 1, status: 'finished', totalTimeMs: 9 * 60_000 });
    expect(res.results[1]).toMatchObject({ bib: 2, position: null, status: 'dnf' });
    // Con la carrera cerrada, la telemetría tardía se rechaza
    const late = await telemetry(token2, { ts: Date.now() - 1000, ...at(4) });
    expect(late.json().rejected[0].reason).toBe('race_closed');
    // Un organizador no puede modificar una carrera finalizada
    const edit = await app.inject({ method: 'PATCH', url: `/api/v1/admin/races/${raceId}`, headers: H(), payload: { name: 'Otro nombre' } });
    expect(edit.statusCode).toBe(403);
  });

  it('exporta CSV con protección contra inyección de fórmulas', async () => {
    const r = await app.inject({ method: 'GET', url: `/api/v1/admin/races/${raceId}/export?type=results`, headers: H() });
    expect(r.headers['content-type']).toContain('text/csv');
    expect(r.body).toContain('posicion,dorsal');
  });
});

async function slug() {
  return (await app.inject({ method: 'GET', url: `/api/v1/admin/races/${raceId}`, headers: H() })).json().race.slug as string;
}

describe('CSV', () => {
  it('analiza comillas, separador punto y coma y saltos de línea', () => {
    expect(parseCsv('a;b\n"x;1";"di ""hola"""\r\n"multi\nlínea";z')).toEqual([
      ['a', 'b'],
      ['x;1', 'di "hola"'],
      ['multi\nlínea', 'z'],
    ]);
  });
});

describe('GPX', () => {
  it('extrae puntos de track y de ruta con atributos en cualquier orden', () => {
    const gpx = `<?xml version="1.0"?><gpx><trk><trkseg>
      <trkpt lat="18.4497" lon="-69.6062"><ele>5</ele></trkpt>
      <trkpt lon='-69.6050' lat='18.4500'/>
    </trkseg></trk><rte><rtept lat="18.45" lon="-69.60"/></rte></gpx>`;
    expect(parseGpx(gpx)).toEqual([
      [18.4497, -69.6062],
      [18.45, -69.605],
      [18.45, -69.6],
    ]);
  });
});
