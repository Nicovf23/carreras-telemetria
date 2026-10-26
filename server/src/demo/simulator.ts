import type { Db } from '../db/index.js';
import { logger } from '../lib/logger.js';
import type { LiveManager } from '../services/live.js';
import { buildCourse, getRace, type Race } from '../services/races.js';
import type { TelemetryMessage, TelemetryService } from '../services/telemetry.js';
import { EARTH_RADIUS_M } from '../timing/geo.js';
import type { CourseModel } from '../timing/course.js';
import { DEMO_RIDERS } from './seed.js';

/**
 * Simulador del modo DEMO. Genera telemetría ficticia y la entrega por el mismo
 * flujo de ingesta que un dispositivo real (validación, deduplicación, datos
 * atrasados), pero marcada como simulada y solo para carreras en modo DEMO.
 *
 * Escenarios incluidos para probar la plataforma:
 *  - Cobertura intermitente con almacenamiento local y reenvío en orden (dorsal 4).
 *  - Pérdida de cobertura con reenvío del más reciente al más antiguo → datos fuera de orden (dorsal 8).
 *  - Batería agotada a mitad de carrera → conexión perdida (dorsal 7).
 *  - Avería: se detiene en el km 18 y sigue transmitiendo parado (dorsal 10).
 *  - Sin dispositivo asignado (dorsal 12).
 *  - Frecuencia cardíaca solo para los participantes con sensor ficticio asignado.
 */

type Profile = 'normal' | 'buffered' | 'lifo' | 'battery' | 'mechanical';

interface SimRider {
  bib: number;
  serial: string;
  deviceId: string;
  hasHr: boolean;
  baseKmh: number;
  fade: number;
  phase: number;
  profile: Profile;
  d: number;
  t: number;
  battery: number;
  rssi: number;
  hrDrift: number;
  buffer: TelemetryMessage[];
  finishedAt: number | null;
  dead: boolean;
}

const REPORT_INTERVAL_MS = 5_000;
/** Paso del simulador en tiempo real: corto para que a ×10 los datos lleguen con la cadencia de un dispositivo real. */
const TICK_MS = 250;

/** Generador pseudoaleatorio determinista (mulberry32): cada simulación es reproducible. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type SimState = 'idle' | 'running' | 'paused' | 'finished';

export class DemoSimulator {
  state: SimState = 'idle';
  speed: number;
  private raceId: string | null = null;
  private race: Race | null = null;
  private course: CourseModel | null = null;
  private riders: SimRider[] = [];
  private timer: NodeJS.Timeout | null = null;
  private loopTimer: NodeJS.Timeout | null = null;
  private simAnchor = 0;
  private wallAnchor = 0;
  private rand = rng(1);
  private stepping = false;

  constructor(
    private db: Db,
    private live: LiveManager,
    private telemetry: TelemetryService,
    opts: { speed: number; autoLoop: boolean },
  ) {
    this.speed = opts.speed;
    this.autoLoop = opts.autoLoop;
  }
  autoLoop: boolean;

  /** Reloj de carrera simulado (ms epoch). */
  now = (): number => (this.state === 'running' ? this.simAnchor + (Date.now() - this.wallAnchor) * this.speed : this.simAnchor);

  status() {
    return {
      raceId: this.raceId,
      state: this.state,
      speed: this.speed,
      simTime: this.raceId ? new Date(this.now()).toISOString() : null,
      autoLoop: this.autoLoop,
    };
  }

  /** Borra todos los datos generados en la carrera DEMO y la deja lista para empezar. */
  async reset(raceId: string) {
    this.stopTimers();
    const race = await getRace(this.db, raceId);
    if (race.mode !== 'demo') throw new Error('El simulador solo puede usarse en carreras DEMO');
    await this.db.transaction(async (tx) => {
      for (const t of ['positions', 'heart_rate_samples', 'checkpoint_passings', 'results']) {
        await tx.query(`DELETE FROM ${t} WHERE race_id = $1`, [raceId]);
      }
      await tx.query(`UPDATE participants SET status = 'registered', finished_at = NULL WHERE race_id = $1`, [raceId]);
      await tx.query(`UPDATE races SET status = 'scheduled', started_at = NULL, finished_at = NULL, updated_at = now() WHERE id = $1`, [raceId]);
      await tx.query(
        `UPDATE devices SET last_seen_at = NULL, last_battery = NULL, last_rssi = NULL, last_network = NULL
          WHERE id IN (SELECT device_id FROM device_assignments WHERE race_id = $1 AND unassigned_at IS NULL)`,
        [raceId],
      );
    });
    this.state = 'idle';
    this.raceId = raceId;
    this.simAnchor = Date.now();
    this.live.setClock(raceId, this.now, this.speed, false);
    this.live.unload(raceId);
    await this.live.load(raceId);
  }

  async start(raceId: string) {
    await this.reset(raceId);
    const startAt = Date.now();
    await this.db.query(`UPDATE races SET status = 'live', started_at = $2, updated_at = now() WHERE id = $1`, [raceId, new Date(startAt).toISOString()]);
    await this.db.query(`UPDATE participants SET status = 'racing' WHERE race_id = $1 AND status = 'registered'`, [raceId]);
    this.race = await getRace(this.db, raceId);
    const { rows: cps } = await this.db.query<any>('SELECT * FROM checkpoints WHERE race_id = $1', [raceId]);
    this.course = buildCourse(this.race, cps.map((c) => ({ id: c.id, raceId, name: c.name, kind: c.kind, distanceM: c.distance_m, lat: c.lat, lon: c.lon })));
    if (!this.course) throw new Error('La carrera DEMO no tiene recorrido');

    const devs = await this.db.query<any>(
      `SELECT p.bib, p.has_hr_sensor, d.id AS device_id, d.serial
         FROM device_assignments a JOIN devices d ON d.id = a.device_id JOIN participants p ON p.id = a.participant_id
        WHERE a.race_id = $1 AND a.unassigned_at IS NULL AND d.is_simulated`,
      [raceId],
    );
    this.rand = rng(20261025);
    const profiles: Record<number, Profile> = { 4: 'buffered', 7: 'battery', 8: 'lifo', 10: 'mechanical' };
    this.riders = devs.rows
      .sort((a, b) => a.bib - b.bib)
      .map((r) => {
        const def = DEMO_RIDERS.find((x) => x.bib === r.bib);
        return {
          bib: r.bib,
          serial: r.serial,
          deviceId: r.device_id,
          hasHr: r.has_hr_sensor,
          // Grupo delantero, pelotón y rezagados (km/h medios plausibles para aficionados de nivel alto)
          baseKmh: 41.5 - r.bib * 0.35 + this.rand() * 0.8 - (def?.cat === 'MASTER' ? 1 : 0),
          fade: 1 + this.rand() * 2.5,
          phase: this.rand() * Math.PI * 2,
          profile: profiles[r.bib] ?? 'normal',
          d: this.rand() * 4, // pequeña dispersión en la línea de salida
          t: startAt,
          battery: profiles[r.bib] === 'battery' ? 14 : 60 + this.rand() * 40,
          rssi: -70 - this.rand() * 15,
          hrDrift: 0,
          buffer: [],
          finishedAt: null,
          dead: false,
        };
      });

    this.simAnchor = startAt;
    this.wallAnchor = Date.now();
    this.state = 'running';
    this.live.setClock(raceId, this.now, this.speed, true);
    this.live.unload(raceId);
    await this.live.load(raceId);
    this.timer = setInterval(() => void this.step(), TICK_MS);
    logger.info({ raceId, speed: this.speed }, 'Simulación DEMO iniciada');
  }

  pause() {
    if (this.state !== 'running' || !this.raceId) return;
    this.simAnchor = this.now();
    this.state = 'paused';
    this.live.setClock(this.raceId, this.now, this.speed, false);
  }

  resume() {
    if (this.state !== 'paused' || !this.raceId) return;
    this.wallAnchor = Date.now();
    this.state = 'running';
    this.live.setClock(this.raceId, this.now, this.speed, true);
  }

  setSpeed(speed: number) {
    const s = Math.max(1, Math.min(60, speed));
    if (this.state === 'running') {
      this.simAnchor = this.now();
      this.wallAnchor = Date.now();
    }
    this.speed = s;
    if (this.raceId) this.live.setClock(this.raceId, this.now, s, this.state === 'running');
  }

  private stopTimers() {
    if (this.timer) clearInterval(this.timer);
    if (this.loopTimer) clearTimeout(this.loopTimer);
    this.timer = null;
    this.loopTimer = null;
  }

  stop() {
    this.stopTimers();
    if (this.state === 'running') this.simAnchor = this.now();
    this.state = this.state === 'idle' ? 'idle' : 'finished';
  }

  private gauss() {
    // Box-Muller
    const u = 1 - this.rand();
    const v = this.rand();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  private async step() {
    if (this.stepping || this.state !== 'running' || !this.course || !this.raceId) return;
    this.stepping = true;
    try {
      const simNow = this.now();
      for (const r of this.riders) {
        const batch: TelemetryMessage[] = [];
        while (r.t + REPORT_INTERVAL_MS <= simNow && !r.dead) {
          r.t += REPORT_INTERVAL_MS;
          const msg = this.advanceRider(r);
          if (msg) batch.push(msg);
        }
        if (batch.length) await this.deliver(r, batch);
      }
      const allDone = this.riders.every((r) => r.dead || (r.finishedAt !== null && simNow - r.finishedAt > 60_000));
      if (allDone) await this.finish();
    } catch (err) {
      logger.error({ err }, 'Error en el paso de simulación');
    } finally {
      this.stepping = false;
    }
  }

  private advanceRider(r: SimRider): TelemetryMessage | null {
    const course = this.course!;
    const L = course.length;
    const dt = REPORT_INTERVAL_MS / 1000;
    let v = 0;
    if (r.finishedAt === null) {
      if (r.profile === 'mechanical' && r.d >= 18_000) v = 0;
      else {
        const kmh = r.baseKmh - r.fade * (r.d / L) + 1.2 * Math.sin(r.t / 97_000 + r.phase) + 0.4 * this.gauss();
        v = Math.max(5, kmh) / 3.6;
      }
      r.d += v * dt;
      if (r.d >= L) r.finishedAt = r.t;
    } else if (r.t - r.finishedAt > 60_000) {
      // Tras cruzar la meta el dispositivo deja de transmitir.
      r.dead = true;
      return null;
    } else {
      // Pasada la meta el ciclista frena y se detiene unos metros después.
      v = r.t - r.finishedAt < 20_000 ? 15 / 3.6 : 0;
      r.d += v * dt;
    }

    // Batería y señal
    r.battery = Math.max(0, r.battery - (r.profile === 'battery' ? 0.006 : 0.004) * dt);
    if (r.battery <= 0) {
      r.dead = true;
      return null;
    }
    r.rssi = Math.max(-110, Math.min(-55, r.rssi + this.gauss() * 1.5));

    const p = course.route.pointAt(r.d, true);
    // Error GNSS típico de ~3 m
    const n = (3 * this.gauss()) / EARTH_RADIUS_M;
    const e = (3 * this.gauss()) / (EARTH_RADIUS_M * Math.cos((p.lat * Math.PI) / 180));
    const ahead = course.route.pointAt(r.d + 15, true);
    const heading = (Math.atan2(ahead.lon - p.lon, ahead.lat - p.lat) * 180) / Math.PI;
    const validFix = this.rand() > 0.01;

    const msg: TelemetryMessage = {
      v: 1,
      device_id: r.serial,
      ts: new Date(r.t).toISOString(),
      battery_pct: Math.round(r.battery * 10) / 10,
      rssi_dbm: Math.round(r.rssi),
      network: 'LTE',
    };
    if (validFix) {
      msg.lat = +(p.lat + (n * 180) / Math.PI).toFixed(6);
      msg.lon = +(p.lon + (e * 180) / Math.PI).toFixed(6);
      msg.speed_kmh = Math.round(v * 3.6 * 10) / 10;
      msg.heading_deg = Math.round((heading + 360) % 360);
      msg.fix = { valid: true, sats: 8 + Math.floor(this.rand() * 6), hdop: +(0.7 + this.rand() * 0.8).toFixed(1) };
    } else {
      msg.fix = { valid: false, sats: 2 };
    }
    if (r.hasHr) {
      const elapsedMin = (r.t - this.simAnchorStart()) / 60_000;
      r.hrDrift = elapsedMin * 0.25;
      const bpm = v === 0 ? 105 + 5 * this.gauss() : 128 + (v * 3.6 - 34) * 3.2 + r.hrDrift + 2.5 * this.gauss();
      msg.hr_bpm = Math.round(Math.max(60, Math.min(198, bpm)));
      msg.hr_source = 'ant+';
    }
    return msg;
  }

  private simAnchorStart() {
    return this.race?.startedAt ? Date.parse(this.race.startedAt) : this.simAnchor;
  }

  /** Simula la entrega según la cobertura celular del perfil del dispositivo. */
  private async deliver(r: SimRider, batch: TelemetryMessage[]) {
    const km = r.d / 1000;
    const noCoverage = (r.profile === 'buffered' && km >= 14 && km < 19) || (r.profile === 'lifo' && km >= 24 && km < 27.5);
    if (noCoverage) {
      r.buffer.push(...batch);
      return;
    }
    let toSend = batch;
    if (r.buffer.length) {
      // buffered: vacía el búfer del más antiguo al más reciente (en orden).
      // lifo: envía primero lo más reciente y después el histórico → llega fuera de orden.
      toSend = r.profile === 'lifo' ? [...batch, ...r.buffer.reverse()] : [...r.buffer, ...batch];
      r.buffer = [];
    }
    const device = { id: r.deviceId, serial: r.serial, isSimulated: true };
    for (let i = 0; i < toSend.length; i += 200) {
      await this.telemetry.ingest(device, toSend.slice(i, i + 200), { nowFn: this.now, simulated: true });
    }
  }

  private async finish() {
    if (!this.raceId) return;
    this.stopTimers();
    this.simAnchor = this.now();
    this.state = 'finished';
    // Los que no llegan a meta (avería, batería) quedan en carrera; el organizador decide.
    this.live.setClock(this.raceId, this.now, this.speed, false);
    logger.info('Simulación DEMO terminada');
    if (this.autoLoop) {
      const id = this.raceId;
      this.loopTimer = setTimeout(() => {
        this.start(id).catch((err) => logger.error({ err }, 'No se pudo reiniciar la simulación DEMO'));
      }, 60_000);
    }
  }
}
