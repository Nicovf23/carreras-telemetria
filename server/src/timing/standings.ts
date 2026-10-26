import { haversine } from './geo.js';
import type {
  CourseCheckpoint,
  FixInfo,
  Freshness,
  FreshnessThresholds,
  GapValue,
  Passing,
  ParticipantStatus,
  StandingInput,
  StandingRow,
  StandingsOptions,
} from './types.js';

export const DEFAULT_FRESHNESS: FreshnessThresholds = { liveMs: 15_000, delayedMs: 60_000, staleMs: 300_000 };
/** Hueco máximo entre dos muestras del historial para interpolar una diferencia estimada. */
export const DEFAULT_MAX_INTERPOLATION_MS = 120_000;

export function freshnessOf(ageMs: number | null, th: FreshnessThresholds = DEFAULT_FRESHNESS): Freshness {
  if (ageMs === null) return 'none';
  if (ageMs <= th.liveMs) return 'live';
  if (ageMs <= th.delayedMs) return 'delayed';
  if (ageMs <= th.staleMs) return 'stale';
  return 'lost';
}

/** Orden de los estados en la clasificación (menor = más arriba). */
const STATUS_RANK: Record<ParticipantStatus, number> = {
  finished: 0,
  racing: 1,
  registered: 2,
  dnf: 3,
  dsq: 4,
  dns: 5,
};

/** Paso más reciente (mayor distancia en el recorrido) de un participante. */
function lastPassing(p: StandingInput, cps: Map<string, CourseCheckpoint>): { passing: Passing; cp: CourseCheckpoint } | null {
  let best: { passing: Passing; cp: CourseCheckpoint } | null = null;
  for (const passing of p.passings) {
    const cp = cps.get(passing.key);
    if (!cp) continue;
    if (!best || cp.courseDistance > best.cp.courseDistance) best = { passing, cp };
  }
  return best;
}

/** Progreso efectivo para ordenar: el mayor entre GPS y último punto de control. */
function effectiveProgress(p: StandingInput, cps: Map<string, CourseCheckpoint>, courseLength: number): number | null {
  if (p.status === 'finished') return courseLength;
  const lp = lastPassing(p, cps);
  const vals = [p.progress, lp?.cp.courseDistance].filter((v): v is number => typeof v === 'number');
  return vals.length ? Math.max(...vals) : null;
}

/**
 * Momento (epoch ms) en el que el participante alcanzó `distance` según su historial,
 * interpolando entre las dos muestras que lo rodean. Null si no hay referencia fiable.
 */
export function timeAtProgress(track: { t: number; progress: number }[], distance: number, maxGapMs: number): number | null {
  if (track.length === 0) return null;
  // El historial es monótono en progreso (máximo acumulado), así que basta con buscar el primer punto >= distance.
  let lo = 0;
  let hi = track.length - 1;
  if (track[hi].progress < distance) return null;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (track[mid].progress >= distance) hi = mid;
    else lo = mid + 1;
  }
  if (lo === 0) return track[0].progress === distance ? track[0].t : null;
  const a = track[lo - 1];
  const b = track[lo];
  if (b.t - a.t > maxGapMs || b.progress === a.progress) return null;
  return a.t + ((distance - a.progress) / (b.progress - a.progress)) * (b.t - a.t);
}

interface Ctx {
  opts: Required<Pick<StandingsOptions, 'now' | 'courseLength' | 'allowEstimatedGaps'>> & {
    freshness: FreshnessThresholds;
    maxInterpolationGapMs: number;
  };
  cps: Map<string, CourseCheckpoint>;
}

/**
 * Diferencia temporal de `r` respecto a `ref` (que va por delante). Se calcula con
 * tiempos transcurridos (no horas absolutas) para admitir salidas individuales.
 *  1. Ambos en meta → diferencia de tiempos finales.
 *  2. Diferencia estimada: el instante en que `ref` pasó por el punto donde está
 *     ahora `r` (punto de control virtual, interpolado en su historial).
 *  3. Último punto de control por el que han pasado ambos.
 *  4. Si nada de lo anterior es fiable → "sin referencia temporal".
 */
export function computeGap(r: StandingInput, ref: StandingInput, ctx: Ctx): GapValue {
  const { opts, cps } = ctx;
  if (r.startTime === null || ref.startTime === null) return { ms: null, method: null, reason: 'no_reference' };

  if (r.status === 'finished' && ref.status === 'finished' && r.finishedAt !== null && ref.finishedAt !== null) {
    return { ms: Math.max(0, r.finishedAt - r.startTime - (ref.finishedAt - ref.startTime)), method: 'finish' };
  }

  const rLast = lastPassing(r, cps);

  if (opts.allowEstimatedGaps && r.lastFix && r.lastFix.onRoute && r.progress !== null && r.progress > 0) {
    const age = opts.now - r.lastFix.t;
    const beyondCheckpoint = !rLast || r.progress > rLast.cp.courseDistance;
    if (age <= opts.freshness.delayedMs && beyondCheckpoint) {
      const tRef = timeAtProgress(ref.track, r.progress, opts.maxInterpolationGapMs);
      if (tRef !== null) {
        const ms = r.lastFix.t - r.startTime - (tRef - ref.startTime);
        return { ms: Math.max(0, Math.round(ms)), method: 'estimated' };
      }
    }
  }

  if (rLast) {
    const refPassing = ref.passings.find((p) => p.key === rLast.passing.key);
    if (refPassing) {
      const ms = rLast.passing.passedAt - r.startTime - (refPassing.passedAt - ref.startTime);
      return { ms: Math.max(0, ms), method: 'checkpoint', reference: rLast.cp.name };
    }
  }
  return { ms: null, method: null, reason: 'no_reference' };
}

function estimateSpeed(last: FixInfo | null, prev: FixInfo | null): { kmh: number | null; source: 'device' | 'estimated' | null } {
  if (!last) return { kmh: null, source: null };
  if (last.speedKmh !== null && Number.isFinite(last.speedKmh)) return { kmh: last.speedKmh, source: 'device' };
  if (!prev) return { kmh: null, source: null };
  const dt = (last.t - prev.t) / 1000;
  if (dt < 1 || dt > 60) return { kmh: null, source: null };
  return { kmh: (haversine(prev, last) / dt) * 3.6, source: 'estimated' };
}

const isActive = (s: ParticipantStatus) => s === 'racing' || s === 'finished';

/** Calcula la clasificación en vivo a partir del estado de cada participante. */
export function computeStandings(inputs: StandingInput[], options: StandingsOptions): StandingRow[] {
  const ctx: Ctx = {
    opts: {
      now: options.now,
      courseLength: options.courseLength,
      allowEstimatedGaps: options.allowEstimatedGaps,
      freshness: options.freshness ?? DEFAULT_FRESHNESS,
      maxInterpolationGapMs: options.maxInterpolationGapMs ?? DEFAULT_MAX_INTERPOLATION_MS,
    },
    cps: new Map(options.checkpoints.map((c) => [c.key, c])),
  };
  const { now, courseLength } = ctx.opts;

  const enriched = inputs.map((p) => {
    const lp = lastPassing(p, ctx.cps);
    return {
      p,
      lp,
      progress: effectiveProgress(p, ctx.cps, courseLength),
      finishElapsed: p.status === 'finished' && p.finishedAt !== null && p.startTime !== null ? p.finishedAt - p.startTime : null,
    };
  });

  enriched.sort((a, b) => {
    const sr = STATUS_RANK[a.p.status] - STATUS_RANK[b.p.status];
    if (sr !== 0) return sr;
    if (a.p.status === 'finished') return (a.finishElapsed ?? Infinity) - (b.finishElapsed ?? Infinity) || a.p.bib - b.p.bib;
    const pa = a.progress ?? -1;
    const pb = b.progress ?? -1;
    if (pa !== pb) return pb - pa;
    // Mismo progreso: quien pasó antes por su último punto de control va delante.
    const ta = a.lp ? a.lp.passing.passedAt - (a.p.startTime ?? 0) : Infinity;
    const tb = b.lp ? b.lp.passing.passedAt - (b.p.startTime ?? 0) : Infinity;
    return ta - tb || a.p.bib - b.p.bib;
  });

  const ranked = enriched.filter((e) => isActive(e.p.status) && e.progress !== null);
  const leader = ranked[0]?.p;

  return enriched.map((e): StandingRow => {
    const p = e.p;
    const rankIdx = ranked.indexOf(e);
    const prevRanked = rankIdx > 0 ? ranked[rankIdx - 1].p : null;
    const age = p.lastFix ? Math.max(0, now - p.lastFix.t) : null;
    const freshness = freshnessOf(age, ctx.opts.freshness);

    let gapLeader: GapValue;
    let gapPrev: GapValue;
    if (rankIdx === -1) {
      gapLeader = gapPrev = { ms: null, method: null, reason: 'not_racing' };
    } else if (rankIdx === 0) {
      gapLeader = gapPrev = { ms: null, method: null, reason: 'leader' };
    } else {
      gapLeader = computeGap(p, leader!, ctx);
      gapPrev = computeGap(p, prevRanked!, ctx);
    }

    // Distancias al anterior: solo con posiciones válidas y recientes de ambos.
    let distanceToPrevM: number | null = null;
    let courseDistanceToPrevM: number | null = null;
    if (prevRanked && p.lastFix && prevRanked.lastFix && p.status === 'racing' && prevRanked.status === 'racing') {
      const fresh = (f: FixInfo) => now - f.t <= ctx.opts.freshness.delayedMs;
      if (fresh(p.lastFix) && fresh(prevRanked.lastFix)) {
        distanceToPrevM = haversine(p.lastFix, prevRanked.lastFix);
        if (p.progress !== null && prevRanked.progress !== null && p.lastFix.onRoute && prevRanked.lastFix.onRoute) {
          courseDistanceToPrevM = Math.max(0, prevRanked.progress - p.progress);
        }
      }
    }

    let elapsedMs: number | null = null;
    if (p.startTime !== null) {
      if (p.status === 'finished' && p.finishedAt !== null) elapsedMs = p.finishedAt - p.startTime;
      else if (p.status === 'racing') elapsedMs = Math.max(0, now - p.startTime);
    }

    const speedFresh = age !== null && age <= ctx.opts.freshness.delayedMs && p.status === 'racing';
    const speed = speedFresh ? estimateSpeed(p.lastFix, p.prevFix) : { kmh: null, source: null };

    return {
      participantId: p.participantId,
      bib: p.bib,
      position: rankIdx >= 0 ? rankIdx + 1 : null,
      status: p.status,
      elapsedMs,
      progress: e.progress,
      lastCheckpoint: e.lp
        ? {
            name: e.lp.cp.name,
            lap: e.lp.cp.lap,
            passedAt: e.lp.passing.passedAt,
            splitMs: p.startTime !== null ? e.lp.passing.passedAt - p.startTime : null,
            source: e.lp.passing.source,
          }
        : null,
      gapLeader,
      gapPrev,
      distanceToPrevM,
      courseDistanceToPrevM,
      speedKmh: speed.kmh !== null ? Math.round(speed.kmh * 10) / 10 : null,
      speedSource: speed.source,
      freshness,
      lastFixAgeMs: age,
    };
  });
}

/**
 * Resuelve los pasos de un participante cuando hay varias fuentes para el mismo
 * punto/vuelta: manual (juez) > alfombra de cronometraje > GPS.
 */
export function resolvePassings(all: Passing[]): Passing[] {
  const prio = { manual: 0, mat: 1, gps: 2 } as const;
  const byKey = new Map<string, Passing>();
  for (const p of all) {
    const cur = byKey.get(p.key);
    if (!cur || prio[p.source] < prio[cur.source]) byKey.set(p.key, p);
  }
  return [...byKey.values()].sort((a, b) => a.passedAt - b.passedAt);
}
