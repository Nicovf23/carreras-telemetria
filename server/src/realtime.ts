import type { Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';
import { config } from './config.js';
import type { LiveManager, PublicSnapshot } from './services/live.js';
import { getRace } from './services/races.js';
import type { Db } from './db/index.js';
import { logger } from './lib/logger.js';

/**
 * Canal en tiempo real (Socket.IO). Los clientes se unen a la sala de una carrera y
 * reciben instantáneas completas de la clasificación (como máximo 1 por segundo).
 * Socket.IO gestiona la reconexión automática; al reconectar el cliente vuelve a
 * unirse y recibe la instantánea actual, así que no se pierde estado.
 */
export function attachRealtime(httpServer: HttpServer, db: Db, live: () => LiveManager) {
  const io = new Server(httpServer, {
    cors: { origin: config.corsOrigins, credentials: true },
    serveClient: false,
  });

  io.on('connection', (socket) => {
    socket.on('race:join', async (slug: unknown, ack?: (r: unknown) => void) => {
      try {
        if (typeof slug !== 'string' || slug.length > 80) throw new Error('slug');
        const race = await getRace(db, slug);
        if (race.status === 'draft') throw new Error('draft');
        for (const room of socket.rooms) if (room.startsWith('race:')) await socket.leave(room);
        await socket.join(`race:${race.id}`);
        const snap = await live().publicSnapshot(race.id);
        socket.emit('race:snapshot', snap);
        ack?.({ ok: true });
      } catch {
        ack?.({ ok: false, error: 'Carrera no encontrada' });
      }
    });
    socket.on('race:leave', async () => {
      for (const room of socket.rooms) if (room.startsWith('race:')) await socket.leave(room);
    });
  });

  logger.info('Canal en tiempo real (Socket.IO) activo');
  return {
    io,
    emitSnapshot: (raceId: string, snap: PublicSnapshot) => io.to(`race:${raceId}`).emit('race:snapshot', snap),
  };
}
