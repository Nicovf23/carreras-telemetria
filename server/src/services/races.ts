import type { Queryable } from '../db/index.js';
import { notFound } from '../lib/errors.js';
import { CourseModel, type CheckpointDef } from '../timing/course.js';
import { RouteModel } from '../timing/route.js';
import type { LatLon, ParticipantStatus } from '../timing/types.js';

export type RaceMode = 'official' | 'demo';
export type RaceStatus = 'draft' | 'scheduled' | 'live' | 'finished' | 'cancelled';

export interface Race {
  id: string;
  slug: string;
  name: string;
  description: string;
  location: string;
  discipline: 'cycling_road' | 'cycling_circuit' | 'cycling_tt' | 'triathlon';
  mode: RaceMode;
  status: RaceStatus;
  scheduledStart: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  timezone: string;
  laps: number;
  route: [number, number][] | null;
  routeLengthM: number | null;
  allowEstimatedGaps: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Checkpoint {
  id: string;
  raceId: string;
  name: string;
  kind: 'start' | 'split' | 'finish';
  distanceM: number;
  lat: number;
  lon: number;
}

export interface Participant {
  id: string;
  raceId: string;
  bib: number;
  firstName: string;
  lastName: string;
  team: string;
  countryCode: string;
  categoryCode: string | null;
  status: ParticipantStatus;
  startTime: string | null;
  finishedAt: string | null;
  hasHrSensor: boolean;
  publicHr: boolean;
  email: string | null;
  phone: string | null;
  emergencyContact: string | null;
  notes: string | null;
}

const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : v === null || v === undefined ? null : String(v));

/* eslint-disable @typescript-eslint/no-explicit-any */
export function mapRace(r: any): Race {
  return {
    id: r.id,
    slug: r.slug,
    name: r.name,
    description: r.description,
    location: r.location,
    discipline: r.discipline,
    mode: r.mode,
    status: r.status,
    scheduledStart: iso(r.scheduled_start),
    startedAt: iso(r.started_at),
    finishedAt: iso(r.finished_at),
    timezone: r.timezone,
    laps: r.laps,
    route: r.route ?? null,
    routeLengthM: r.route_length_m,
    allowEstimatedGaps: r.allow_estimated_gaps,
    createdAt: iso(r.created_at)!,
    updatedAt: iso(r.updated_at)!,
  };
}

export function mapCheckpoint(r: any): Checkpoint {
  return { id: r.id, raceId: r.race_id, name: r.name, kind: r.kind, distanceM: r.distance_m, lat: r.lat, lon: r.lon };
}

export function mapParticipant(r: any): Participant {
  return {
    id: r.id,
    raceId: r.race_id,
    bib: r.bib,
    firstName: r.first_name,
    lastName: r.last_name,
    team: r.team,
    countryCode: String(r.country_code).trim(),
    categoryCode: r.category_code,
    status: r.status,
    startTime: iso(r.start_time),
    finishedAt: iso(r.finished_at),
    hasHrSensor: r.has_hr_sensor,
    publicHr: r.public_hr,
    email: r.email,
    phone: r.phone,
    emergencyContact: r.emergency_contact,
    notes: r.notes,
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export async function getRace(db: Queryable, idOrSlug: string): Promise<Race> {
  const isUuid = /^[0-9a-f-]{36}$/i.test(idOrSlug);
  const { rows } = await db.query(`SELECT * FROM races WHERE ${isUuid ? 'id' : 'slug'} = $1`, [idOrSlug]);
  if (!rows[0]) throw notFound('Carrera');
  return mapRace(rows[0]);
}

export async function listCheckpoints(db: Queryable, raceId: string): Promise<Checkpoint[]> {
  const { rows } = await db.query('SELECT * FROM checkpoints WHERE race_id = $1 ORDER BY distance_m, created_at', [raceId]);
  return rows.map(mapCheckpoint);
}

export async function listParticipants(db: Queryable, raceId: string): Promise<Participant[]> {
  const { rows } = await db.query('SELECT * FROM participants WHERE race_id = $1 ORDER BY bib', [raceId]);
  return rows.map(mapParticipant);
}

export async function listCategories(db: Queryable, raceId: string) {
  const { rows } = await db.query<{ code: string; name: string }>(
    'SELECT code, name FROM race_categories WHERE race_id = $1 ORDER BY code',
    [raceId],
  );
  return rows;
}

export function buildCourse(race: Race, checkpoints: Checkpoint[]): CourseModel | null {
  if (!race.route || race.route.length < 2) return null;
  const route = new RouteModel(race.route.map(([lat, lon]): LatLon => ({ lat, lon })));
  const defs: CheckpointDef[] = checkpoints.map((c) => ({ id: c.id, name: c.name, kind: c.kind, distance: c.distanceM }));
  return new CourseModel(route, race.laps, defs);
}

/** Crea un slug URL a partir del nombre. */
export function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 60) || 'carrera'
  );
}

export async function audit(
  db: Queryable,
  userId: string | null,
  action: string,
  entity: string,
  entityId: string | null,
  details: Record<string, unknown> = {},
) {
  await db.query('INSERT INTO audit_log (user_id, action, entity, entity_id, details) VALUES ($1,$2,$3,$4,$5)', [
    userId,
    action,
    entity,
    entityId,
    JSON.stringify(details),
  ]);
}
