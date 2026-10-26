/** Tipos compartidos con la API (ver server/src/openapi.yaml). */
export type RaceMode = 'official' | 'demo';
export type RaceStatus = 'draft' | 'scheduled' | 'live' | 'finished' | 'cancelled';
export type ParticipantStatus = 'registered' | 'dns' | 'racing' | 'finished' | 'dnf' | 'dsq';
export type Freshness = 'live' | 'delayed' | 'stale' | 'lost' | 'none';
export type HrState = 'ok' | 'no_sensor' | 'no_data' | 'stale' | 'private';

export interface RaceSummary {
  id: string;
  slug: string;
  name: string;
  description: string;
  location: string;
  discipline: string;
  mode: RaceMode;
  status: RaceStatus;
  scheduledStart: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  timezone: string;
  laps: number;
  routeLengthM: number | null;
  participantCount?: number;
}

export interface Checkpoint {
  id: string;
  name: string;
  kind: 'start' | 'split' | 'finish';
  distanceM: number;
  lat: number;
  lon: number;
}

export interface RaceDetail {
  race: RaceSummary & { route: [number, number][] | null };
  categories: { code: string; name: string }[];
  checkpoints: Checkpoint[];
}

export interface Gap {
  ms: number | null;
  method: 'finish' | 'checkpoint' | 'estimated' | null;
  reference?: string;
  reason?: 'leader' | 'no_reference' | 'not_racing';
}

export interface LiveRow {
  participantId: string;
  bib: number;
  position: number | null;
  status: ParticipantStatus;
  firstName: string;
  lastName: string;
  team: string;
  countryCode: string;
  categoryCode: string | null;
  startTime: string | null;
  elapsedMs: number | null;
  progress: number | null;
  lastCheckpoint: { name: string; lap: number; passedAt: number; splitMs: number | null; source: string } | null;
  gapLeader: Gap;
  gapPrev: Gap;
  distanceToPrevM: number | null;
  courseDistanceToPrevM: number | null;
  speedKmh: number | null;
  speedSource: 'device' | 'estimated' | null;
  freshness: Freshness;
  lastFixAgeMs: number | null;
  lastFixAt: string | null;
  location: { lat: number; lon: number; heading: number | null } | null;
  hr: { bpm: number; at: string } | null;
  hrState: HrState;
  device: { battery: number | null; rssi: number | null; network: string | null; lastSeenAt: string | null; serial?: string } | null;
}

export interface LiveSnapshot {
  race: {
    id: string;
    slug: string;
    name: string;
    mode: RaceMode;
    status: RaceStatus;
    startedAt: string | null;
    courseLengthM: number | null;
    laps: number;
  };
  clock: { now: string; rate: number; running: boolean };
  checkpoints: Checkpoint[];
  rows: LiveRow[];
  generatedAt: string;
}

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'organizer';
}
