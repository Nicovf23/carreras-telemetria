/**
 * Tipos del motor de cronometraje. Todas las marcas temporales son milisegundos
 * desde epoch (UTC) y todas las distancias son metros.
 */
export interface LatLon {
  lat: number;
  lon: number;
}

export type ParticipantStatus = 'registered' | 'dns' | 'racing' | 'finished' | 'dnf' | 'dsq';
export type PassingSource = 'gps' | 'manual' | 'mat';
export type Freshness = 'live' | 'delayed' | 'stale' | 'lost' | 'none';

/** Punto de control expandido por vuelta, en coordenadas de "recorrido total". */
export interface CourseCheckpoint {
  /** `${checkpointId}:${lap}` */
  key: string;
  checkpointId: string;
  name: string;
  kind: 'start' | 'split' | 'finish';
  lap: number; // 1..laps
  courseDistance: number;
}

export interface Passing {
  key: string;
  checkpointId: string;
  lap: number;
  passedAt: number;
  source: PassingSource;
}

/** Muestra de progreso derivada de una posición GPS válida. */
export interface ProgressSample {
  t: number;
  lat: number;
  lon: number;
  /** Distancia acumulada en el recorrido total (incluye vueltas). */
  progress: number;
  along: number;
  lap: number; // 0-based
  offset: number;
  onRoute: boolean;
}

export interface FixInfo {
  t: number;
  lat: number;
  lon: number;
  speedKmh: number | null;
  onRoute: boolean;
}

export interface StandingInput {
  participantId: string;
  bib: number;
  status: ParticipantStatus;
  /** Hora de salida del participante (salida general o individual). */
  startTime: number | null;
  finishedAt: number | null;
  /** Progreso conocido en metros (máximo entre GPS y último punto de control). */
  progress: number | null;
  lastFix: FixInfo | null;
  prevFix: FixInfo | null;
  passings: Passing[];
  /** Historial (t, progress) ordenado por t, para diferencias estimadas. */
  track: { t: number; progress: number }[];
}

export interface FreshnessThresholds {
  liveMs: number;
  delayedMs: number;
  staleMs: number;
}

export interface StandingsOptions {
  now: number;
  courseLength: number;
  checkpoints: CourseCheckpoint[];
  allowEstimatedGaps: boolean;
  freshness?: FreshnessThresholds;
  /** Hueco máximo entre dos muestras del historial para interpolar (ms). */
  maxInterpolationGapMs?: number;
}

export type GapMethod = 'finish' | 'checkpoint' | 'estimated';
export type GapReason = 'leader' | 'no_reference' | 'not_racing';

export interface GapValue {
  ms: number | null;
  method: GapMethod | null;
  /** Nombre del punto de control usado como referencia */
  reference?: string;
  reason?: GapReason;
}

export interface StandingRow {
  participantId: string;
  bib: number;
  position: number | null;
  status: ParticipantStatus;
  elapsedMs: number | null;
  progress: number | null;
  lastCheckpoint: {
    name: string;
    lap: number;
    passedAt: number;
    splitMs: number | null;
    source: PassingSource;
  } | null;
  gapLeader: GapValue;
  gapPrev: GapValue;
  /** Distancia geográfica (línea recta) al corredor anterior. */
  distanceToPrevM: number | null;
  /** Distancia a lo largo del recorrido al corredor anterior. */
  courseDistanceToPrevM: number | null;
  speedKmh: number | null;
  speedSource: 'device' | 'estimated' | null;
  freshness: Freshness;
  lastFixAgeMs: number | null;
}
