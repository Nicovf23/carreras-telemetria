import { RouteModel } from './route.js';
import type { CourseCheckpoint, LatLon, ProgressSample } from './types.js';

export interface CheckpointDef {
  id: string;
  name: string;
  kind: 'start' | 'split' | 'finish';
  /** Distancia desde la salida dentro de una vuelta (m). */
  distance: number;
}

/** Distancia perpendicular máxima para considerar que una posición está en el recorrido. */
export const OFF_ROUTE_M = 150;
/** Velocidad máxima plausible para un ciclista (m/s ≈ 108 km/h). */
export const MAX_PLAUSIBLE_SPEED_MS = 30;
/** Hueco máximo entre dos posiciones para interpolar un paso por punto de control. */
export const MAX_CROSSING_INTERPOLATION_MS = 10 * 60_000;

/**
 * Recorrido completo de una carrera: la polilínea de una vuelta multiplicada por el
 * número de vueltas, con los puntos de control expandidos por vuelta.
 */
export class CourseModel {
  readonly route: RouteModel;
  readonly laps: number;
  readonly length: number;
  readonly checkpoints: CourseCheckpoint[];

  constructor(route: RouteModel, laps: number, defs: CheckpointDef[]) {
    this.route = route;
    this.laps = Math.max(1, Math.floor(laps));
    this.length = route.length * this.laps;
    const L = route.length;
    const out: CourseCheckpoint[] = [];
    const finish = defs.find((d) => d.kind === 'finish');
    for (let lap = 1; lap <= this.laps; lap++) {
      for (const d of defs) {
        if (d.kind !== 'split') continue;
        out.push({ key: `${d.id}:${lap}`, checkpointId: d.id, name: d.name, kind: 'split', lap, courseDistance: (lap - 1) * L + d.distance });
      }
      if (finish) {
        // En circuitos la línea de meta cuenta las vueltas intermedias.
        const isLast = lap === this.laps;
        out.push({
          key: `${finish.id}:${lap}`,
          checkpointId: finish.id,
          name: isLast ? finish.name : `${finish.name} · vuelta ${lap}`,
          kind: isLast ? 'finish' : 'split',
          lap,
          courseDistance: isLast ? this.length : (lap - 1) * L + Math.min(finish.distance, L),
        });
      }
    }
    out.sort((a, b) => a.courseDistance - b.courseDistance);
    this.checkpoints = out;
  }

  get finishKey(): string | null {
    return this.checkpoints.find((c) => c.kind === 'finish')?.key ?? null;
  }
}

export interface TrackerState {
  /** Progreso máximo alcanzado (monótono, en metros del recorrido total). */
  progress: number;
  /** Última muestra procesada (posición proyectada "cruda", sin máximo). */
  last: { t: number; raw: number; onRoute: boolean } | null;
  /** Progreso de la primera muestra válida: desde dónde se ha visto avanzar al corredor. */
  firstRaw: number | null;
}

export const initialTrackerState = (): TrackerState => ({ progress: 0, last: null, firstRaw: null });

/**
 * Un paso por un punto de control solo se acepta si el GPS vio al corredor acercarse
 * desde al menos esta distancia. Evita que un dispositivo quieto junto a la línea
 * (salida y meta en el mismo sitio, error GNSS de unos metros) "cruce" la meta.
 */
export const MIN_APPROACH_M = 100;

export interface Crossing {
  checkpoint: CourseCheckpoint;
  passedAt: number;
}

export interface AdvanceResult {
  state: TrackerState;
  sample: ProgressSample;
  crossings: Crossing[];
  flags: string[];
}

/**
 * Procesa una posición GPS válida (en orden temporal estricto) y devuelve el nuevo
 * estado, la muestra de progreso y los pasos por punto de control detectados.
 * Los pasos se interpolan linealmente entre las dos posiciones que los rodean.
 */
export function advanceTracker(course: CourseModel, state: TrackerState, fix: { t: number } & LatLon): AdvanceResult {
  const flags: string[] = [];
  const route = course.route;
  const L = route.length;
  const prev = state.last;
  if (prev && fix.t <= prev.t) throw new Error('advanceTracker requiere posiciones en orden temporal');

  const unwrappedPrev = prev ? prev.raw : 0;
  const prevLap = Math.min(course.laps - 1, Math.floor(unwrappedPrev / L));
  const hintAlong = unwrappedPrev - prevLap * L;
  const dt = prev ? (fix.t - prev.t) / 1000 : 0;
  const fwd = Math.max(3000, dt * MAX_PLAUSIBLE_SPEED_MS);
  // Sin muestra previa en un recorrido lineal no hay pista: proyección global.
  const hint = prev || route.isLoop ? hintAlong : undefined;
  const proj = route.project(fix, hint, { back: 300, fwd }, OFF_ROUTE_M, route.isLoop);
  const onRoute = proj.offset <= OFF_ROUTE_M;

  // En circuitos, elegimos la vuelta que da continuidad con la muestra anterior.
  let raw = proj.along;
  if (route.isLoop) {
    let bestK = prevLap;
    let bestDiff = Infinity;
    for (const k of [prevLap - 1, prevLap, prevLap + 1]) {
      // k = laps solo sirve para alcanzar exactamente la meta (along ≈ 0 tras la última vuelta);
      // k = -1 representa estar "detrás" de la línea de salida antes de empezar (se acota a 0).
      if (k < -1 || k > course.laps) continue;
      const diff = Math.abs(k * L + proj.along - unwrappedPrev);
      if (diff < bestDiff) {
        bestDiff = diff;
        bestK = k;
      }
    }
    raw = Math.max(0, bestK * L + proj.along);
    // Antes de la salida el corredor puede estar "detrás" de la línea (final de vuelta).
    if (!prev && proj.along > L - 500) raw = 0;
  }
  // `beyond` conserva la posición pasada la meta para interpolar el instante de llegada.
  const beyond = raw;
  raw = Math.min(raw, course.length);

  let progress = state.progress;
  const crossings: Crossing[] = [];
  const firstRaw = state.firstRaw ?? (onRoute ? raw : null);
  if (onRoute) {
    if (prev && dt > 0 && (raw - unwrappedPrev) / dt > MAX_PLAUSIBLE_SPEED_MS) {
      flags.push('implausible_jump');
    } else if (raw > state.progress) {
      if (prev && prev.onRoute && fix.t - prev.t <= MAX_CROSSING_INTERPOLATION_MS && raw > prev.raw) {
        for (const cp of course.checkpoints) {
          const approached = firstRaw !== null && cp.courseDistance - firstRaw >= MIN_APPROACH_M;
          if (cp.courseDistance > state.progress && cp.courseDistance <= raw && cp.courseDistance > 0 && approached) {
            const f = Math.max(0, Math.min(1, (cp.courseDistance - prev.raw) / (beyond - prev.raw)));
            crossings.push({ checkpoint: cp, passedAt: Math.round(prev.t + f * (fix.t - prev.t)) });
          }
        }
      } else if (prev && course.checkpoints.some((cp) => cp.courseDistance > state.progress && cp.courseDistance <= raw)) {
        flags.push('crossing_unresolved');
      }
      progress = raw;
    }
  } else {
    flags.push('off_route');
  }

  const lap = Math.min(course.laps - 1, Math.floor(raw / L));
  const usable = onRoute && !flags.includes('implausible_jump');
  return {
    state: { progress, last: { t: fix.t, raw: usable ? raw : unwrappedPrev, onRoute: usable }, firstRaw },
    sample: { t: fix.t, lat: fix.lat, lon: fix.lon, progress, along: proj.along, lap, offset: proj.offset, onRoute },
    crossings,
    flags,
  };
}
