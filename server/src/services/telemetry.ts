import { z } from 'zod';
import { config } from '../config.js';
import type { Db } from '../db/index.js';
import { isValidCoordinate } from '../timing/geo.js';
import type { LiveManager } from './live.js';

/**
 * Mensaje de telemetría v1. Todos los campos de sensores son opcionales: un mensaje
 * sin posición válida puede transportar solo frecuencia cardíaca o estado de batería.
 */
export const telemetryMessageSchema = z.object({
  v: z.literal(1).optional(),
  device_id: z.string().min(1).max(64).optional(),
  race_id: z.string().uuid().optional(),
  participant_id: z.string().uuid().optional(),
  seq: z.number().int().nonnegative().optional(),
  /** Marca temporal UTC de la medida (ISO 8601 o milisegundos epoch). */
  ts: z.union([z.string().datetime({ offset: true }), z.number().int().positive()]),
  lat: z.number().optional(),
  lon: z.number().optional(),
  alt_m: z.number().min(-500).max(9000).optional(),
  speed_kmh: z.number().min(0).max(150).optional(),
  heading_deg: z.number().min(0).max(360).optional(),
  fix: z
    .object({
      valid: z.boolean().optional(),
      sats: z.number().int().min(0).max(80).optional(),
      hdop: z.number().min(0).max(100).optional(),
    })
    .optional(),
  hr_bpm: z.number().int().min(25).max(250).optional(),
  hr_source: z.enum(['ant+', 'ble', 'unknown']).optional(),
  battery_pct: z.number().min(0).max(100).optional(),
  rssi_dbm: z.number().int().min(-140).max(0).optional(),
  network: z.string().max(16).optional(),
});
export type TelemetryMessage = z.infer<typeof telemetryMessageSchema>;

export const telemetryBodySchema = z.union([
  telemetryMessageSchema,
  z.object({ messages: z.array(z.unknown()).min(1).max(500) }),
]);

/** HDOP por encima de este valor se considera un fix de mala calidad y se descarta. */
const MAX_HDOP = 10;

export interface DeviceContext {
  id: string;
  serial: string;
  isSimulated: boolean;
}

export type MessageOutcome =
  | { status: 'accepted'; late?: boolean }
  | { status: 'duplicate' }
  | { status: 'rejected'; reason: string };

interface Assignment {
  raceId: string;
  participantId: string;
  raceMode: 'official' | 'demo';
  raceStatus: string;
}

export class TelemetryService {
  constructor(
    private db: Db,
    private live: LiveManager,
  ) {}

  private async assignment(deviceId: string): Promise<Assignment | null> {
    const { rows } = await this.db.query<any>(
      `SELECT a.race_id, a.participant_id, r.mode, r.status
         FROM device_assignments a JOIN races r ON r.id = a.race_id
        WHERE a.device_id = $1 AND a.unassigned_at IS NULL`,
      [deviceId],
    );
    const r = rows[0];
    return r ? { raceId: r.race_id, participantId: r.participant_id, raceMode: r.mode, raceStatus: r.status } : null;
  }

  /**
   * Procesa un lote de mensajes de un dispositivo autenticado. Cada mensaje se valida
   * por separado: uno erróneo no invalida el resto (importante al vaciar el búfer
   * almacenado en el dispositivo tras una pérdida de cobertura).
   *
   * `nowFn` permite al simulador DEMO usar su propio reloj de carrera.
   */
  async ingest(
    device: DeviceContext,
    raw: unknown[],
    opts: { nowFn?: () => number; simulated?: boolean } = {},
  ): Promise<{ results: MessageOutcome[]; serverTime: string }> {
    const now = opts.nowFn ?? Date.now;
    const simulated = opts.simulated ?? false;
    const results: MessageOutcome[] = [];
    const asg = await this.assignment(device.id);

    for (const item of raw) {
      results.push(await this.ingestOne(device, asg, item, now(), simulated));
    }
    if (asg) {
      await this.db.query(
        `UPDATE devices SET last_seen_at = GREATEST(COALESCE(last_seen_at, 'epoch'::timestamptz), $2) WHERE id = $1`,
        [device.id, new Date(now()).toISOString()],
      );
    }
    return { results, serverTime: new Date(now()).toISOString() };
  }

  private async ingestOne(
    device: DeviceContext,
    asg: Assignment | null,
    item: unknown,
    now: number,
    simulated: boolean,
  ): Promise<MessageOutcome> {
    const parsed = telemetryMessageSchema.safeParse(item);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      return { status: 'rejected', reason: `invalid:${first.path.join('.') || 'body'}` };
    }
    const m = parsed.data;
    if (m.device_id && m.device_id !== device.serial) return { status: 'rejected', reason: 'device_mismatch' };
    if (!asg) return { status: 'rejected', reason: 'device_not_assigned' };
    if (m.race_id && m.race_id !== asg.raceId) return { status: 'rejected', reason: 'race_mismatch' };
    if (m.participant_id && m.participant_id !== asg.participantId) return { status: 'rejected', reason: 'participant_mismatch' };
    // Separación estricta: los datos simulados nunca entran en una carrera oficial.
    if ((simulated || device.isSimulated) && asg.raceMode !== 'demo') return { status: 'rejected', reason: 'simulated_in_official_race' };
    if (asg.raceStatus === 'finished' || asg.raceStatus === 'cancelled') return { status: 'rejected', reason: 'race_closed' };

    const t = typeof m.ts === 'number' ? m.ts : Date.parse(m.ts);
    if (!Number.isFinite(t)) return { status: 'rejected', reason: 'invalid:ts' };
    if (t > now + config.TELEMETRY_MAX_FUTURE_SKEW_S * 1000) return { status: 'rejected', reason: 'timestamp_in_future' };
    if (t < now - config.TELEMETRY_MAX_AGE_H * 3600_000) return { status: 'rejected', reason: 'timestamp_too_old' };
    const tsIso = new Date(t).toISOString();

    const hasPosition = m.lat !== undefined || m.lon !== undefined;
    const fixValid = m.fix?.valid !== false && (m.fix?.hdop === undefined || m.fix.hdop <= MAX_HDOP);
    if (hasPosition && !isValidCoordinate(m.lat, m.lon)) return { status: 'rejected', reason: 'invalid_coordinates' };
    if (!hasPosition && m.hr_bpm === undefined && m.battery_pct === undefined && m.rssi_dbm === undefined) {
      return { status: 'rejected', reason: 'empty_message' };
    }

    let inserted = false;
    let duplicate = false;
    let late = false;

    if (hasPosition && fixValid) {
      const { rows } = await this.db.query<{ id: number }>(
        `INSERT INTO positions (race_id, participant_id, device_id, seq, recorded_at, received_at, lat, lon, alt_m, speed_kmh,
                                heading_deg, hdop, satellites, battery_pct, rssi_dbm, network, is_simulated)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
         ON CONFLICT (device_id, recorded_at) DO NOTHING RETURNING id`,
        [
          asg.raceId, asg.participantId, device.id, m.seq ?? null, tsIso, new Date(now).toISOString(),
          m.lat, m.lon, m.alt_m ?? null, m.speed_kmh ?? null, m.heading_deg ?? null, m.fix?.hdop ?? null,
          m.fix?.sats ?? null, m.battery_pct ?? null, m.rssi_dbm ?? null, m.network ?? null, simulated || device.isSimulated,
        ],
      );
      if (rows.length) {
        inserted = true;
        const r = await this.live.onPosition(asg.raceId, asg.participantId, {
          t,
          lat: m.lat!,
          lon: m.lon!,
          altM: m.alt_m ?? null,
          speedKmh: m.speed_kmh ?? null,
          headingDeg: m.heading_deg ?? null,
        });
        late = r.late || now - t > 60_000;
        if (late) await this.db.query(`UPDATE positions SET flags = array_append(flags, 'late') WHERE id = $1`, [rows[0].id]);
      } else duplicate = true;
    }

    if (m.hr_bpm !== undefined) {
      const { rows } = await this.db.query(
        `INSERT INTO heart_rate_samples (race_id, participant_id, device_id, recorded_at, bpm, source, is_simulated)
         VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (device_id, recorded_at) DO NOTHING RETURNING id`,
        [asg.raceId, asg.participantId, device.id, tsIso, m.hr_bpm, m.hr_source ?? 'unknown', simulated || device.isSimulated],
      );
      if (rows.length) {
        inserted = true;
        await this.live.onHeartRate(asg.raceId, asg.participantId, m.hr_bpm, t, m.hr_source ?? 'unknown');
      } else duplicate = true;
    }

    if (m.battery_pct !== undefined || m.rssi_dbm !== undefined || m.network !== undefined) {
      await this.db.query(
        `UPDATE devices SET last_battery = COALESCE($2, last_battery), last_rssi = COALESCE($3, last_rssi),
                            last_network = COALESCE($4, last_network)
          WHERE id = $1 AND (last_seen_at IS NULL OR last_seen_at <= $5)`,
        [device.id, m.battery_pct ?? null, m.rssi_dbm ?? null, m.network ?? null, tsIso],
      );
      await this.live.onDeviceStatus(asg.raceId, asg.participantId, {
        t,
        battery: m.battery_pct ?? null,
        rssi: m.rssi_dbm ?? null,
        network: m.network ?? null,
      });
      // Un mensaje solo de estado cuenta como aceptado; si llevaba posición o FC duplicadas, es un reenvío.
      if (!hasPosition && m.hr_bpm === undefined) inserted = true;
    } else {
      await this.live.onDeviceStatus(asg.raceId, asg.participantId, { t });
    }

    if (hasPosition && !fixValid && !inserted) return { status: 'rejected', reason: 'no_gnss_fix' };
    if (duplicate && !inserted) return { status: 'duplicate' };
    return late ? { status: 'accepted', late: true } : { status: 'accepted' };
  }
}
