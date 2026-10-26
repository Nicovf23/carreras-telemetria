import type { FastifyInstance, FastifyRequest } from 'fastify';
import { unauthorized } from '../lib/errors.js';
import { parseDeviceToken, secretMatches } from '../lib/keys.js';
import type { DeviceContext } from '../services/telemetry.js';

declare module 'fastify' {
  interface FastifyRequest {
    device?: DeviceContext;
  }
}

/**
 * Endpoint de ingesta para los dispositivos de seguimiento.
 * Autenticación: `Authorization: Bearer <serial>.<secreto>` (una clave por dispositivo).
 */
export async function registerTelemetryRoutes(app: FastifyInstance) {
  const { db, telemetry } = app.services;

  async function authenticateDevice(req: FastifyRequest) {
    const tok = parseDeviceToken(req.headers.authorization);
    if (!tok) throw unauthorized('Credencial de dispositivo ausente o mal formada');
    const { rows } = await db.query<any>('SELECT id, serial, key_hash, is_simulated, active FROM devices WHERE serial = $1', [tok.serial]);
    const d = rows[0];
    if (!d || !d.active || !secretMatches(tok.secret, d.key_hash)) {
      req.log.warn({ serial: tok.serial }, 'Telemetría rechazada: credencial no válida');
      throw unauthorized('Credencial de dispositivo no válida');
    }
    req.device = { id: d.id, serial: d.serial, isSimulated: d.is_simulated };
  }

  app.post(
    '/telemetry',
    {
      bodyLimit: 512 * 1024,
      preHandler: authenticateDevice,
      config: {
        rateLimit: {
          max: 240,
          timeWindow: '1 minute',
          keyGenerator: (req: FastifyRequest) => parseDeviceToken(req.headers.authorization)?.serial ?? req.ip,
        },
      },
    },
    async (req, reply) => {
      const body = req.body as unknown;
      const isBatch = typeof body === 'object' && body !== null && Array.isArray((body as { messages?: unknown }).messages);
      const messages = isBatch ? (body as { messages: unknown[] }).messages : [body];
      if (messages.length === 0 || messages.length > 500) {
        return reply.status(400).send({ error: 'bad_request', message: 'El lote debe tener entre 1 y 500 mensajes' });
      }
      const { results, serverTime } = await telemetry.ingest(req.device!, messages);
      const summary = {
        accepted: results.filter((r) => r.status === 'accepted').length,
        duplicates: results.filter((r) => r.status === 'duplicate').length,
        rejected: results.flatMap((r, index) => (r.status === 'rejected' ? [{ index, reason: r.reason }] : [])),
      };
      // 207 si parte del lote se rechazó; el dispositivo solo debe reintentar ante errores 5xx o de red.
      return reply.status(summary.rejected.length && summary.accepted + summary.duplicates > 0 ? 207 : summary.rejected.length ? 422 : 200).send({
        ...summary,
        serverTime,
      });
    },
  );
}
