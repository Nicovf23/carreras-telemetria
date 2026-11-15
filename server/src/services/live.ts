import type { Db, Queryable } from '../db/index.js';
import { logger } from '../lib/logger.js';
import { CourseModel, advanceTracker, initialTrackerState, type TrackerState } from '../timing/course.js';
import { bearing } from '../timing/geo.js';
import { computeStandings, resolvePassings } from '../timing/standings.js';
import type { FixInfo, Passing, ParticipantStatus, StandingRow } from '../timing/types.js';
import {
  buildCourse,
  getRace,
  listCheckpoints,
  listParticipants,
  type Checkpoint,
  type Participant,
  type Race,
} from './races.js';

/** Una frecuencia cardíaca más antigua que esto no se muestra como valor actual. */
export const HR_MAX_AGE_MS = 30_000;
/** Resolución mínima del historial de progreso usado para estimar diferencias. */
const TRACK_MIN_INTERVAL_MS = 4_000;

export interface Fix {
  t: number;
  lat: number;
  lon: number;
  altM: number | null;
  speedKmh: number | null;
  headingDeg: number | null;
}

interface DeviceState {
  id: string;
  serial: string;
  isSimulated: boolean;
  lastSeen: number | null;
  battery: number | null;
  rssi: number | null;
  network: string | null;
}

interface PState {
  p: Participant;
  startTime: number | null;
  tracker: TrackerState;
  /** Instante de la última posición procesada por el tracker (orden temporal). */
  trackerT: number | null;
  onRoute: boolean;
  lastFix: Fix | null;
  prevFix: Fix | null;
  track: { t: number; progress: number }[];
  passings: Passing[];
  lastHr: { bpm: number; t: number; source: string } | null;
  device: DeviceState | null;
  rebuildTimer: NodeJS.Timeout | null;
}

export interface LiveRace {
  race: Race;
  checkpoints: Checkpoint[];
  course: CourseModel | null;
  ps: Map<string, PState>;
  /** Reloj de la carrera: tiempo real (oficial) o reloj simulado (DEMO). */
  clock: () => number;
  clockRate: number;
  clockRunning: boolean;
  dirty: boolean;
  lastSnapshot: PublicSnapshot | null;
}

export type HrState = 'ok' | 'no_sensor' | 'no_data' | 'stale' | 'private';

export interface SnapshotRow extends StandingRow {
  firstName: string;
  lastName: string;
  team: string;
  countryCode: string;
  categoryCode: string | null;
  startTime: string | null;
  lastFixAt: string | null;
  location: { lat: number; lon: number; heading: number | null } | null;
  hr: { bpm: number; at: string } | null;
  hrState: HrState;
  device: { battery: number | null; rssi: number | null; network: string | null; lastSeenAt: string | null; serial?: string } | null;
}

export interface PublicSnapshot {
  race: {
    id: string;
    slug: string;
    name: string;
    mode: Race['mode'];
    status: Race['status'];
    startedAt: string | null;
    courseLengthM: number | null;
    laps: number;
  };
  clock: { now: string; rate: number; running: boolean };
  checkpoints: { id: string; name: string; kind: string; distanceM: number; lat: number; lon: number }[];
  rows: SnapshotRow[];
  generatedAt: string;
}

const ms = (iso: string | null) => (iso ? Date.parse(iso) : null);
const isoOrNull = (t: number | null) => (t === null ? null : new Date(t).toISOString());

export class LiveManager {
  private races = new Map<string, LiveRace>();
  private broadcastTimers = new Map<string, NodeJS.Timeout>();
  private clocks = new Map<string, { clock: () => number; rate: number; running: boolean }>();

  constructor(
    private db: Db,
    private onSnapshot: (raceId: string, snapshot: PublicSnapshot) => void = () => {},
  ) {}

  /** Configura un reloj de carrera distinto del real (simulador DEMO). */
  setClock(raceId: string, clock: () => number, rate: number, running: boolean) {
    this.clocks.set(raceId, { clock, rate, running });
    const lr = this.races.get(raceId);
    if (lr) {
      lr.clock = clock;
      lr.clockRate = rate;
      lr.clockRunning = running;
      this.markDirty(raceId);
    }
  }

  now(raceId: string): number {
    return this.clocks.get(raceId)?.clock() ?? Date.now();
  }

  isLoaded(raceId: string) {
    return this.races.has(raceId);
  }

  /** Carga (o recarga) el estado en memoria de una carrera reconstruyéndolo desde la base de datos. */
  async load(raceIdOrSlug: string): Promise<LiveRace> {
    const race = await getRace(this.db, raceIdOrSlug);
    const checkpoints = await listCheckpoints(this.db, race.id);
    const participants = await listParticipants(this.db, race.id);
    const course = buildCourse(race, checkpoints);
    const clk = this.clocks.get(race.id);
    const lr: LiveRace = {
      race,
      checkpoints,
      course,
      ps: new Map(),
      clock: clk?.clock ?? Date.now,
      clockRate: clk?.rate ?? 1,
      clockRunning: clk ? clk.running : race.status === 'live',
      dirty: true,
      lastSnapshot: null,
    };
    for (const p of participants) lr.ps.set(p.id, this.emptyState(race, p));

    // Dispositivos asignados
    const devs = await this.db.query<any>(
      `SELECT a.participant_id, d.id, d.serial, d.is_simulated, d.last_seen_at, d.last_battery, d.last_rssi, d.last_network
         FROM device_assignments a JOIN devices d ON d.id = a.device_id
        WHERE a.race_id = $1 AND a.unassigned_at IS NULL`,
      [race.id],
    );
    for (const d of devs.rows) {
      const ps = lr.ps.get(d.participant_id);
      if (ps) ps.device = this.mapDevice(d);
    }

    // Pasos registrados (manuales / alfombra); los GPS se recalculan al reconstruir.
    const passRows = await this.db.query<any>(
      `SELECT participant_id, checkpoint_id, lap, passed_at, source FROM checkpoint_passings WHERE race_id = $1 AND source <> 'gps'`,
      [race.id],
    );
    for (const r of passRows.rows) {
      lr.ps.get(r.participant_id)?.passings.push({
        key: `${r.checkpoint_id}:${r.lap}`,
        checkpointId: r.checkpoint_id,
        lap: r.lap,
        passedAt: new Date(r.passed_at).getTime(),
        source: r.source,
      });
    }

    // Última frecuencia cardíaca
    const hrRows = await this.db.query<any>(
      `SELECT DISTINCT ON (participant_id) participant_id, bpm, recorded_at, source
         FROM heart_rate_samples WHERE race_id = $1 ORDER BY participant_id, recorded_at DESC`,
      [race.id],
    );
    for (const r of hrRows.rows) {
      const ps = lr.ps.get(r.participant_id);
      if (ps) ps.lastHr = { bpm: r.bpm, t: new Date(r.recorded_at).getTime(), source: r.source };
    }

    this.races.set(race.id, lr);
    for (const ps of lr.ps.values()) await this.rebuildParticipant(lr, ps);
    this.markDirty(race.id);
    return lr;
  }

  unload(raceId: string) {
    const lr = this.races.get(raceId);
    if (lr) for (const ps of lr.ps.values()) if (ps.rebuildTimer) clearTimeout(ps.rebuildTimer);
    this.races.delete(raceId);
  }

  async get(raceId: string): Promise<LiveRace> {
    return this.races.get(raceId) ?? this.load(raceId);
  }

  private emptyState(race: Race, p: Participant): PState {
    return {
      p,
      startTime: ms(p.startTime) ?? ms(race.startedAt),
      tracker: initialTrackerState(),
      trackerT: null,
      onRoute: false,
      lastFix: null,
      prevFix: null,
      track: [],
      passings: [],
      lastHr: null,
      device: null,
      rebuildTimer: null,
    };
  }

  private mapDevice(d: any): DeviceState {
    return {
      id: d.id,
      serial: d.serial,
      isSimulated: d.is_simulated,
      lastSeen: d.last_seen_at ? new Date(d.last_seen_at).getTime() : null,
      battery: d.last_battery,
      rssi: d.last_rssi,
      network: d.last_network,
    };
  }

  /** El tracker solo procesa posiciones a partir de la salida del participante. */
  private trackable(lr: LiveRace, ps: PState, t: number) {
    return (
      lr.course !== null &&
      ps.startTime !== null &&
      t >= ps.startTime &&
      (ps.p.status === 'racing' || ps.p.status === 'finished')
    );
  }

  /**
   * Reconstruye el progreso y los pasos GPS de un participante a partir de todas sus
   * posiciones guardadas. Se usa al cargar y cuando llegan datos fuera de orden.
   */
  private async rebuildParticipant(lr: LiveRace, ps: PState) {
    const { rows } = await this.db.query<any>(
      `SELECT recorded_at, lat, lon, alt_m, speed_kmh, heading_deg FROM positions
        WHERE participant_id = $1 ORDER BY recorded_at`,
      [ps.p.id],
    );
    ps.tracker = initialTrackerState();
    ps.trackerT = null;
    ps.track = [];
    ps.lastFix = null;
    ps.prevFix = null;
    ps.passings = ps.passings.filter((x) => x.source !== 'gps');
    const gps: Passing[] = [];
    for (const r of rows) {
      const fix: Fix = {
        t: new Date(r.recorded_at).getTime(),
        lat: r.lat,
        lon: r.lon,
        altM: r.alt_m,
        speedKmh: r.speed_kmh,
        headingDeg: r.heading_deg,
      };
      this.updateLastFix(ps, fix);
      if (this.trackable(lr, ps, fix.t)) gps.push(...this.advance(lr, ps, fix));
    }
    ps.passings.push(...gps);
    await this.db.transaction(async (tx) => {
      await tx.query(`DELETE FROM checkpoint_passings WHERE participant_id = $1 AND source = 'gps'`, [ps.p.id]);
      for (const g of gps) await this.insertPassing(tx, lr.race.id, ps.p.id, g);
    });
    await this.applyFinish(lr, ps);
  }

  private scheduleRebuild(lr: LiveRace, ps: PState) {
    if (ps.rebuildTimer) return;
    ps.rebuildTimer = setTimeout(() => {
      ps.rebuildTimer = null;
      this.rebuildParticipant(lr, ps)
        .then(() => this.markDirty(lr.race.id))
        .catch((err) => logger.error({ err, participant: ps.p.id }, 'Error reconstruyendo participante'));
    }, 300);
  }

  private updateLastFix(ps: PState, fix: Fix) {
    if (!ps.lastFix || fix.t > ps.lastFix.t) {
      ps.prevFix = ps.lastFix;
      ps.lastFix = fix;
    } else if (!ps.prevFix || fix.t > ps.prevFix.t) {
      ps.prevFix = fix;
    }
  }

  /** Avanza el tracker con una posición posterior a la última procesada. Devuelve los pasos detectados. */
  private advance(lr: LiveRace, ps: PState, fix: Fix): Passing[] {
    const r = advanceTracker(lr.course!, ps.tracker, fix);
    ps.tracker = r.state;
    ps.trackerT = fix.t;
    ps.onRoute = r.sample.onRoute;
    const lastTrack = ps.track[ps.track.length - 1];
    if (r.sample.onRoute && (!lastTrack || (fix.t - lastTrack.t >= TRACK_MIN_INTERVAL_MS && r.state.progress > lastTrack.progress))) {
      ps.track.push({ t: fix.t, progress: r.state.progress });
    }
    return r.crossings.map((c) => ({
      key: c.checkpoint.key,
      checkpointId: c.checkpoint.checkpointId,
      lap: c.checkpoint.lap,
      passedAt: c.passedAt,
      source: 'gps' as const,
    }));
  }

  private async insertPassing(db: Queryable, raceId: string, participantId: string, p: Passing) {
    await db.query(
      `INSERT INTO checkpoint_passings (race_id, participant_id, checkpoint_id, lap, passed_at, source)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (participant_id, checkpoint_id, lap, source) DO UPDATE SET passed_at = EXCLUDED.passed_at`,
      [raceId, participantId, p.checkpointId, p.lap, new Date(p.passedAt).toISOString(), p.source],
    );
  }

  /** Si hay paso por meta (cualquier fuente), el participante pasa a "finished". */
  private async applyFinish(lr: LiveRace, ps: PState) {
    const finishKey = lr.course?.finishKey;
    if (!finishKey) return;
    const fin = resolvePassings(ps.passings).find((p) => p.key === finishKey);
    if (!fin) {
      // Una llegada que ya no se sostiene al recalcular (p. ej. un falso cruce por error GPS)
      // se retira mientras la carrera siga en directo. Una llegada manual nunca desaparece aquí.
      if (ps.p.status === 'finished' && lr.race.status === 'live') {
        ps.p.status = 'racing';
        ps.p.finishedAt = null;
        await this.db.query(`UPDATE participants SET status = 'racing', finished_at = NULL WHERE id = $1`, [ps.p.id]);
      }
      return;
    }
    const finishedAtIso = new Date(fin.passedAt).toISOString();
    if (ps.p.status === 'racing' || (ps.p.status === 'finished' && ps.p.finishedAt !== finishedAtIso)) {
      ps.p.status = 'finished';
      ps.p.finishedAt = finishedAtIso;
      await this.db.query(`UPDATE participants SET status = 'finished', finished_at = $2 WHERE id = $1`, [ps.p.id, finishedAtIso]);
    }
  }

  /**
   * Procesa una posición ya validada y guardada en la base de datos.
   * `late` indica que el dato llegó desordenado respecto a lo ya procesado.
   */
  async onPosition(raceId: string, participantId: string, fix: Fix): Promise<{ late: boolean }> {
    const lr = await this.get(raceId);
    const ps = lr.ps.get(participantId);
    if (!ps) return { late: false };
    this.updateLastFix(ps, fix);
    let late = false;
    if (this.trackable(lr, ps, fix.t)) {
      if (ps.trackerT !== null && fix.t <= ps.trackerT) {
        late = true;
        this.scheduleRebuild(lr, ps);
      } else {
        const found = this.advance(lr, ps, fix);
        for (const g of found) {
          ps.passings.push(g);
          await this.insertPassing(this.db, raceId, participantId, g);
        }
        if (found.length) await this.applyFinish(lr, ps);
      }
    }
    this.markDirty(raceId);
    return { late };
  }

  async onHeartRate(raceId: string, participantId: string, bpm: number, t: number, source: string) {
    const lr = await this.get(raceId);
    const ps = lr.ps.get(participantId);
    if (!ps) return;
    if (!ps.lastHr || t > ps.lastHr.t) ps.lastHr = { bpm, t, source };
    this.markDirty(raceId);
  }

  async onDeviceStatus(raceId: string, participantId: string, s: { t: number; battery?: number | null; rssi?: number | null; network?: string | null }) {
    const lr = await this.get(raceId);
    const ps = lr.ps.get(participantId);
    if (!ps?.device) return;
    if (ps.device.lastSeen === null || s.t >= ps.device.lastSeen) {
      ps.device.lastSeen = s.t;
      if (s.battery !== undefined && s.battery !== null) ps.device.battery = s.battery;
      if (s.rssi !== undefined && s.rssi !== null) ps.device.rssi = s.rssi;
      if (s.network !== undefined && s.network !== null) ps.device.network = s.network;
    }
    this.markDirty(raceId);
  }

  /** Paso manual registrado por un juez/organizador. */
  async onManualPassing(raceId: string, participantId: string, p: Passing) {
    const lr = await this.get(raceId);
    const ps = lr.ps.get(participantId);
    if (!ps) return;
    ps.passings = ps.passings.filter((x) => !(x.key === p.key && x.source === p.source));
    ps.passings.push(p);
    await this.applyFinish(lr, ps);
    this.markDirty(raceId);
  }

  markDirty(raceId: string) {
    const lr = this.races.get(raceId);
    if (!lr) return;
    lr.dirty = true;
    if (this.broadcastTimers.has(raceId)) return;
    // Agrupa las actualizaciones: como máximo una instantánea por segundo de reloj de carrera
    // (en DEMO acelerado, más a menudo en tiempo real, con un mínimo de 250 ms).
    const interval = Math.max(250, 1000 / Math.max(1, lr.clockRate));
    this.broadcastTimers.set(
      raceId,
      setTimeout(() => {
        this.broadcastTimers.delete(raceId);
        try {
          this.onSnapshot(raceId, this.snapshot(raceId, false));
        } catch (err) {
          logger.error({ err, raceId }, 'Error generando la instantánea');
        }
      }, interval),
    );
  }

  /** Recalcula periódicamente las carreras en directo (la frescura cambia con el tiempo). */
  tick() {
    for (const [id, lr] of this.races) if (lr.race.status === 'live') this.markDirty(id);
  }

  standings(lr: LiveRace): StandingRow[] {
    const now = lr.clock();
    const toFix = (f: Fix | null, onRoute: boolean): FixInfo | null =>
      f ? { t: f.t, lat: f.lat, lon: f.lon, speedKmh: f.speedKmh, onRoute } : null;
    const inputs = [...lr.ps.values()].map((ps) => ({
      participantId: ps.p.id,
      bib: ps.p.bib,
      status: ps.p.status as ParticipantStatus,
      startTime: ps.startTime,
      finishedAt: ms(ps.p.finishedAt),
      progress: ps.trackerT !== null ? ps.tracker.progress : null,
      lastFix: toFix(ps.lastFix, ps.onRoute),
      prevFix: toFix(ps.prevFix, ps.onRoute),
      passings: resolvePassings(ps.passings),
      track: ps.track,
    }));
    return computeStandings(inputs, {
      now,
      courseLength: lr.course?.length ?? 0,
      checkpoints: lr.course?.checkpoints ?? [],
      allowEstimatedGaps: lr.race.allowEstimatedGaps,
    });
  }

  /**
   * Instantánea de la carrera. La versión pública omite datos privados: contacto,
   * número de serie del dispositivo y la frecuencia cardíaca sin consentimiento.
   */
  snapshot(raceId: string, admin: boolean): PublicSnapshot {
    const lr = this.races.get(raceId);
    if (!lr) throw new Error('Carrera no cargada');
    const now = lr.clock();
    const rows = this.standings(lr).map((s): SnapshotRow => {
      const ps = lr.ps.get(s.participantId)!;
      let hrState: HrState = 'ok';
      let hr: SnapshotRow['hr'] = null;
      if (!ps.p.hasHrSensor) hrState = 'no_sensor';
      else if (!admin && !ps.p.publicHr) hrState = 'private';
      else if (!ps.lastHr) hrState = 'no_data';
      else if (now - ps.lastHr.t > HR_MAX_AGE_MS || ps.p.status !== 'racing') hrState = 'stale';
      else hr = { bpm: ps.lastHr.bpm, at: new Date(ps.lastHr.t).toISOString() };

      let heading = ps.lastFix?.headingDeg ?? null;
      if (heading === null && ps.lastFix && ps.prevFix) heading = Math.round(bearing(ps.prevFix, ps.lastFix));
      return {
        ...s,
        firstName: ps.p.firstName,
        lastName: ps.p.lastName,
        team: ps.p.team,
        countryCode: ps.p.countryCode,
        categoryCode: ps.p.categoryCode,
        startTime: isoOrNull(ps.startTime),
        lastFixAt: isoOrNull(ps.lastFix?.t ?? null),
        location: ps.lastFix ? { lat: ps.lastFix.lat, lon: ps.lastFix.lon, heading } : null,
        hr,
        hrState,
        device: ps.device
          ? {
              battery: ps.device.battery,
              rssi: ps.device.rssi,
              network: ps.device.network,
              lastSeenAt: isoOrNull(ps.device.lastSeen),
              ...(admin ? { serial: ps.device.serial } : {}),
            }
          : null,
      };
    });
    const snap: PublicSnapshot = {
      race: {
        id: lr.race.id,
        slug: lr.race.slug,
        name: lr.race.name,
        mode: lr.race.mode,
        status: lr.race.status,
        startedAt: lr.race.startedAt,
        courseLengthM: lr.course?.length ?? null,
        laps: lr.race.laps,
      },
      clock: { now: new Date(now).toISOString(), rate: lr.clockRate, running: lr.clockRunning && lr.race.status === 'live' },
      checkpoints: lr.checkpoints.map((c) => ({ id: c.id, name: c.name, kind: c.kind, distanceM: c.distanceM, lat: c.lat, lon: c.lon })),
      rows,
      generatedAt: new Date().toISOString(),
    };
    if (!admin) {
      lr.lastSnapshot = snap;
      lr.dirty = false;
    }
    return snap;
  }

  async publicSnapshot(raceId: string): Promise<PublicSnapshot> {
    const lr = await this.get(raceId);
    return lr.dirty || !lr.lastSnapshot ? this.snapshot(raceId, false) : lr.lastSnapshot;
  }

  async adminSnapshot(raceId: string): Promise<PublicSnapshot> {
    await this.get(raceId);
    return this.snapshot(raceId, true);
  }

  dispose() {
    for (const t of this.broadcastTimers.values()) clearTimeout(t);
    for (const id of [...this.races.keys()]) this.unload(id);
  }
}
