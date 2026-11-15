import { describe, expect, it } from 'vitest';
import { haversine, isValidCoordinate } from './geo.js';
import { RouteModel } from './route.js';
import { CourseModel, advanceTracker, initialTrackerState, type TrackerState } from './course.js';
import { computeStandings, freshnessOf, resolvePassings, timeAtProgress } from './standings.js';
import type { LatLon, Passing, StandingInput } from './types.js';

// Recorrido recto hacia el este de ~10,5 km con un punto cada ~100 m.
const straight: LatLon[] = Array.from({ length: 101 }, (_, i) => ({ lat: 18.45, lon: -69.6 + i * 0.001 }));
const route = new RouteModel(straight);
const L = route.length;

// Circuito cuadrado de ~4 km.
const square: LatLon[] = [
  { lat: 18.45, lon: -69.6 },
  { lat: 18.45, lon: -69.59 },
  { lat: 18.459, lon: -69.59 },
  { lat: 18.459, lon: -69.6 },
  { lat: 18.45, lon: -69.6 },
];

const T0 = Date.UTC(2026, 9, 25, 13, 0, 0);
const min = 60_000;

describe('geo', () => {
  it('haversine: 1° de latitud ≈ 111,2 km', () => {
    expect(haversine({ lat: 0, lon: 0 }, { lat: 1, lon: 0 })).toBeCloseTo(111_195, -1);
  });
  it('rechaza coordenadas inválidas y el (0,0) de un GNSS sin fix', () => {
    expect(isValidCoordinate(18.4, -69.6)).toBe(true);
    expect(isValidCoordinate(91, 0)).toBe(false);
    expect(isValidCoordinate(0, 181)).toBe(false);
    expect(isValidCoordinate(0, 0)).toBe(false);
    expect(isValidCoordinate(Number.NaN, 1)).toBe(false);
  });
});

describe('RouteModel', () => {
  it('proyecta un punto del recorrido en su distancia', () => {
    const p = route.pointAt(4321);
    const proj = route.project(p);
    expect(proj.along).toBeCloseTo(4321, 0);
    expect(proj.offset).toBeLessThan(0.5);
  });
  it('calcula la distancia perpendicular de un punto fuera del recorrido', () => {
    const p = route.pointAt(2000);
    const proj = route.project({ lat: p.lat + 0.001, lon: p.lon }); // ~111 m al norte
    expect(proj.offset).toBeCloseTo(111, 0);
  });
  it('detecta circuitos cerrados', () => {
    expect(new RouteModel(square).isLoop).toBe(true);
    expect(route.isLoop).toBe(false);
  });
});

describe('CourseModel y detección de pasos', () => {
  const course = new CourseModel(route, 1, [
    { id: 'start', name: 'Salida', kind: 'start', distance: 0 },
    { id: 'cp5', name: 'Km 5', kind: 'split', distance: 5000 },
    { id: 'fin', name: 'Meta', kind: 'finish', distance: L },
  ]);

  it('interpola el instante exacto de paso por un punto de control', () => {
    let st: TrackerState = initialTrackerState();
    st = advanceTracker(course, st, { t: T0, ...route.pointAt(4900) }).state;
    // 200 m en 20 s → el km 5 se cruza a mitad de intervalo
    const r = advanceTracker(course, st, { t: T0 + 20_000, ...route.pointAt(5100) });
    expect(r.crossings).toHaveLength(1);
    expect(r.crossings[0].checkpoint.key).toBe('cp5:1');
    expect(r.crossings[0].passedAt).toBeCloseTo(T0 + 10_000, -2);
  });

  it('interpola la llegada aunque la posición siguiente esté más allá del final del recorrido', () => {
    let st = advanceTracker(course, initialTrackerState(), { t: T0, ...route.pointAt(L - 250) }).state;
    st = advanceTracker(course, st, { t: T0 + 10_000, ...route.pointAt(L - 50) }).state;
    const r = advanceTracker(course, st, { t: T0 + 20_000, ...route.pointAt(L + 50, true) });
    expect(r.crossings.map((c) => c.checkpoint.key)).toEqual(['fin:1']);
    expect(r.crossings[0].passedAt).toBeCloseTo(T0 + 15_000, -2);
    expect(r.state.progress).toBeCloseTo(L, 0);
  });

  it('un dispositivo quieto junto a la meta no la "cruza" por el error del GPS', () => {
    // Caso real: rastreador encendido a 17 m de la meta, con unos metros de ruido GNSS.
    let st = initialTrackerState();
    const keys: string[] = [];
    for (let i = 0; i < 20; i++) {
      const jitter = (i % 2 ? 1 : -1) * 15; // ±15 m a lo largo del recorrido
      const r = advanceTracker(course, st, { t: T0 + i * 5000, ...route.pointAt(L - 17 + jitter, true) });
      st = r.state;
      keys.push(...r.crossings.map((c) => c.checkpoint.key));
    }
    expect(keys).toEqual([]);
  });

  it('trata como circuito un GPX cuya salida y meta quedan a ~124 m y no da llegadas falsas en la salida', () => {
    // Bucle de ~4 km que no cierra exactamente (como el GPX de la prueba real)
    const almostLoop: LatLon[] = [...square.slice(0, -1), { lat: 18.4511, lon: -69.6 }];
    const loop = new RouteModel(almostLoop);
    expect(loop.isLoop).toBe(true);
    const c = new CourseModel(loop, 1, [
      { id: 's', name: 'Salida', kind: 'start', distance: 0 },
      { id: 'f', name: 'Meta', kind: 'finish', distance: loop.length },
    ]);
    let st = initialTrackerState();
    const keys: string[] = [];
    // Quieto entre el final del trazado y la salida durante 2 minutos
    for (let i = 0; i < 24; i++) {
      const r = advanceTracker(c, st, { t: T0 + i * 5000, lat: 18.4505 + (i % 2 ? 0.00005 : -0.00005), lon: -69.6 });
      st = r.state;
      keys.push(...r.crossings.map((x) => x.checkpoint.key));
    }
    expect(keys).toEqual([]);
    expect(st.progress).toBeLessThan(200);
  });

  it('no inventa un paso si el hueco entre posiciones es demasiado grande', () => {
    let st = advanceTracker(course, initialTrackerState(), { t: T0, ...route.pointAt(4000) }).state;
    const r = advanceTracker(course, st, { t: T0 + 15 * min, ...route.pointAt(6000) });
    expect(r.crossings).toHaveLength(0);
    expect(r.flags).toContain('crossing_unresolved');
    st = r.state;
    expect(st.progress).toBeCloseTo(6000, 0);
  });

  it('descarta saltos imposibles (más de 108 km/h)', () => {
    const st = advanceTracker(course, initialTrackerState(), { t: T0, ...route.pointAt(1000) }).state;
    const r = advanceTracker(course, st, { t: T0 + 10_000, ...route.pointAt(5000) });
    expect(r.flags).toContain('implausible_jump');
    expect(r.state.progress).toBeCloseTo(1000, 0);
  });

  it('el progreso es monótono ante ruido GPS hacia atrás', () => {
    let st = advanceTracker(course, initialTrackerState(), { t: T0, ...route.pointAt(3000) }).state;
    st = advanceTracker(course, st, { t: T0 + 5000, ...route.pointAt(2990) }).state;
    expect(st.progress).toBeCloseTo(3000, 0);
  });

  it('marca posiciones fuera del recorrido sin avanzar el progreso', () => {
    const st = advanceTracker(course, initialTrackerState(), { t: T0, ...route.pointAt(3000) }).state;
    const p = route.pointAt(3100);
    const r = advanceTracker(course, st, { t: T0 + 10_000, lat: p.lat + 0.01, lon: p.lon });
    expect(r.sample.onRoute).toBe(false);
    expect(r.flags).toContain('off_route');
    expect(r.state.progress).toBeCloseTo(3000, 0);
  });

  it('cuenta vueltas en un circuito y detecta la meta en la última', () => {
    const loop = new RouteModel(square);
    const c = new CourseModel(loop, 3, [
      { id: 's', name: 'Salida', kind: 'start', distance: 0 },
      { id: 'f', name: 'Meta', kind: 'finish', distance: loop.length },
    ]);
    expect(c.checkpoints.map((x) => x.key)).toEqual(['f:1', 'f:2', 'f:3']);
    expect(c.checkpoints[2].kind).toBe('finish');
    let st = initialTrackerState();
    const keys: string[] = [];
    let t = T0;
    // ~10 m/s, una muestra cada 20 s
    for (let d = 0; d <= c.length + 100; d += 200) {
      const r = advanceTracker(c, st, { t, ...loop.pointAt(d % loop.length) });
      st = r.state;
      keys.push(...r.crossings.map((x) => x.checkpoint.key));
      t += 20_000;
    }
    expect(keys).toEqual(['f:1', 'f:2', 'f:3']);
    expect(st.progress).toBeCloseTo(c.length, 0);
  });
});

// --- Clasificación ---------------------------------------------------------

const course = new CourseModel(route, 1, [
  { id: 'start', name: 'Salida', kind: 'start', distance: 0 },
  { id: 'cp3', name: 'Km 3', kind: 'split', distance: 3000 },
  { id: 'cp6', name: 'Km 6', kind: 'split', distance: 6000 },
  { id: 'fin', name: 'Meta', kind: 'finish', distance: L },
]);

function passing(id: string, at: number, source: Passing['source'] = 'gps', lap = 1): Passing {
  return { key: `${id}:${lap}`, checkpointId: id, lap, passedAt: at, source };
}

function rider(over: Partial<StandingInput> & { bib: number }): StandingInput {
  return {
    participantId: `p${over.bib}`,
    status: 'racing',
    startTime: T0,
    finishedAt: null,
    progress: null,
    lastFix: null,
    prevFix: null,
    passings: [],
    track: [],
    ...over,
  };
}

const fixAt = (d: number, t: number, speedKmh: number | null = null) => ({ ...route.pointAt(d), t, speedKmh, onRoute: true });

describe('computeStandings', () => {
  const now = T0 + 20 * min;
  const base = { now, courseLength: course.length, checkpoints: course.checkpoints, allowEstimatedGaps: false };

  it('ordena por progreso y calcula el tiempo transcurrido', () => {
    const rows = computeStandings(
      [rider({ bib: 1, progress: 5000, lastFix: fixAt(5000, now) }), rider({ bib: 2, progress: 6200, lastFix: fixAt(6200, now) })],
      base,
    );
    expect(rows.map((r) => r.bib)).toEqual([2, 1]);
    expect(rows[0].position).toBe(1);
    expect(rows[0].elapsedMs).toBe(20 * min);
  });

  it('diferencia con el líder y con el anterior en el último punto de control común', () => {
    const rows = computeStandings(
      [
        rider({ bib: 1, progress: 6500, passings: [passing('cp3', T0 + 5 * min), passing('cp6', T0 + 10 * min)] }),
        rider({ bib: 2, progress: 6300, passings: [passing('cp3', T0 + 5 * min + 4000), passing('cp6', T0 + 10 * min + 12_000)] }),
        rider({ bib: 3, progress: 6100, passings: [passing('cp3', T0 + 5 * min + 9000), passing('cp6', T0 + 10 * min + 30_000)] }),
      ],
      base,
    );
    expect(rows.map((r) => r.bib)).toEqual([1, 2, 3]);
    expect(rows[0].gapLeader.reason).toBe('leader');
    expect(rows[1].gapLeader).toMatchObject({ ms: 12_000, method: 'checkpoint', reference: 'Km 6' });
    expect(rows[2].gapLeader).toMatchObject({ ms: 30_000, method: 'checkpoint' });
    expect(rows[2].gapPrev).toMatchObject({ ms: 18_000, method: 'checkpoint' });
  });

  it('usa el último punto común: si el líder ya pasó uno nuevo, se compara en el del perseguidor', () => {
    const rows = computeStandings(
      [
        rider({ bib: 1, progress: 6500, passings: [passing('cp3', T0 + 5 * min), passing('cp6', T0 + 10 * min)] }),
        rider({ bib: 2, progress: 4000, passings: [passing('cp3', T0 + 6 * min)] }),
      ],
      base,
    );
    expect(rows[1].gapLeader).toMatchObject({ ms: 60_000, reference: 'Km 3' });
  });

  it('muestra "sin referencia temporal" en lugar de inventar una diferencia', () => {
    const rows = computeStandings(
      [rider({ bib: 1, progress: 2500, lastFix: fixAt(2500, now) }), rider({ bib: 2, progress: 2000, lastFix: fixAt(2000, now) })],
      base,
    );
    expect(rows[1].gapLeader).toEqual({ ms: null, method: null, reason: 'no_reference' });
    // Pero la distancia sí se puede calcular con posiciones válidas
    expect(rows[1].distanceToPrevM).toBeCloseTo(500, -1);
    expect(rows[1].courseDistanceToPrevM).toBeCloseTo(500, 0);
  });

  it('diferencia estimada: instante en que el líder pasó por la posición actual del perseguidor', () => {
    // El líder pasó por el km 2 a los 4 min (historial cada 30 s a 500 m/min)
    const leaderTrack = Array.from({ length: 21 }, (_, i) => ({ t: T0 + i * 30_000, progress: i * 250 }));
    const rows = computeStandings(
      [
        rider({ bib: 1, progress: 5000, lastFix: fixAt(5000, T0 + 10 * min), track: leaderTrack }),
        rider({ bib: 2, progress: 2000, lastFix: fixAt(2000, T0 + 10 * min) }),
      ],
      { ...base, now: T0 + 10 * min, allowEstimatedGaps: true },
    );
    expect(rows[1].gapLeader).toMatchObject({ ms: 6 * min, method: 'estimated' });
  });

  it('no estima diferencias si la posición del perseguidor está desactualizada', () => {
    const leaderTrack = Array.from({ length: 21 }, (_, i) => ({ t: T0 + i * 30_000, progress: i * 250 }));
    const rows = computeStandings(
      [
        rider({ bib: 1, progress: 5000, lastFix: fixAt(5000, T0 + 10 * min), track: leaderTrack }),
        rider({ bib: 2, progress: 2000, lastFix: fixAt(2000, T0 + 5 * min) }),
      ],
      { ...base, now: T0 + 10 * min, allowEstimatedGaps: true },
    );
    expect(rows[1].gapLeader.reason).toBe('no_reference');
    expect(rows[1].freshness).toBe('stale');
    expect(rows[1].speedKmh).toBeNull();
  });

  it('respeta salidas individuales (contrarreloj): compara tiempos transcurridos', () => {
    const rows = computeStandings(
      [
        rider({ bib: 1, startTime: T0, progress: 3500, passings: [passing('cp3', T0 + 6 * min)] }),
        // Sale 1 min después y pasa 30 s más tarde en hora absoluta → va 30 s por delante en tiempo real
        rider({ bib: 2, startTime: T0 + min, progress: 3400, passings: [passing('cp3', T0 + 6 * min + 30_000)] }),
      ],
      base,
    );
    // Ordenado por progreso, el 1 va delante en carretera, pero su diferencia es negativa → se acota a 0
    expect(rows[1].gapLeader.ms).toBe(0);
    expect(rows[0].elapsedMs).toBe(20 * min);
    expect(rows[1].elapsedMs).toBe(19 * min);
  });

  it('los llegados a meta van primero, ordenados por tiempo final, y los DNF/DNS al final', () => {
    const rows = computeStandings(
      [
        rider({ bib: 5, status: 'dnf', progress: 8000 }),
        rider({ bib: 1, status: 'finished', finishedAt: T0 + 18 * min, passings: [passing('fin', T0 + 18 * min)] }),
        rider({ bib: 2, status: 'finished', finishedAt: T0 + 17 * min + 30_000, passings: [passing('fin', T0 + 17 * min + 30_000)] }),
        rider({ bib: 3, progress: 9000 }),
        rider({ bib: 4, status: 'dns' }),
      ],
      base,
    );
    expect(rows.map((r) => r.bib)).toEqual([2, 1, 3, 5, 4]);
    expect(rows[1].gapLeader).toMatchObject({ ms: 30_000, method: 'finish' });
    expect(rows[3].position).toBeNull();
    expect(rows[3].gapLeader.reason).toBe('not_racing');
    expect(rows[0].elapsedMs).toBe(17 * min + 30_000);
  });

  it('velocidad: usa la del dispositivo o la estima con las dos últimas posiciones', () => {
    const rows = computeStandings(
      [
        rider({ bib: 1, progress: 5000, lastFix: fixAt(5000, now, 41.2) }),
        rider({ bib: 2, progress: 4000, lastFix: fixAt(4000, now), prevFix: fixAt(3900, now - 10_000) }),
      ],
      base,
    );
    expect(rows[0]).toMatchObject({ speedKmh: 41.2, speedSource: 'device' });
    expect(rows[1].speedSource).toBe('estimated');
    expect(rows[1].speedKmh).toBeCloseTo(36, 0);
  });
});

describe('utilidades', () => {
  it('estado de frescura según antigüedad', () => {
    expect(freshnessOf(null)).toBe('none');
    expect(freshnessOf(5000)).toBe('live');
    expect(freshnessOf(30_000)).toBe('delayed');
    expect(freshnessOf(120_000)).toBe('stale');
    expect(freshnessOf(600_000)).toBe('lost');
  });

  it('timeAtProgress interpola y rechaza huecos grandes', () => {
    const track = [
      { t: 0, progress: 0 },
      { t: 10_000, progress: 100 },
      { t: 400_000, progress: 3000 },
    ];
    expect(timeAtProgress(track, 50, 120_000)).toBe(5000);
    expect(timeAtProgress(track, 1000, 120_000)).toBeNull();
    expect(timeAtProgress(track, 5000, 120_000)).toBeNull();
  });

  it('prioridad de fuentes: manual > alfombra > GPS', () => {
    const r = resolvePassings([passing('cp3', 1000, 'gps'), passing('cp3', 1200, 'manual'), passing('cp6', 3000, 'gps'), passing('cp6', 2900, 'mat')]);
    expect(r).toEqual([passing('cp3', 1200, 'manual'), passing('cp6', 2900, 'mat')]);
  });
});
