import { buildApp } from './app.js';
import { config } from './config.js';
import { migrate, openDb } from './db/index.js';
import { ensureDemoRace } from './demo/seed.js';
import { logger } from './lib/logger.js';
import { attachRealtime } from './realtime.js';
import { bootstrapAdmin } from './services/auth.js';
import type { PublicSnapshot } from './services/live.js';

async function main() {
  const db = await openDb();
  await migrate(db);
  await bootstrapAdmin(db);

  let emit: (raceId: string, s: PublicSnapshot) => void = () => {};
  const app = await buildApp(db, { onSnapshot: (id, s) => emit(id, s) });
  const rt = attachRealtime(app.server, db, () => app.services.live);
  emit = rt.emitSnapshot;

  // Carreras en directo: se cargan al arrancar para seguir recibiendo telemetría.
  const { rows } = await db.query<{ id: string }>(`SELECT id FROM races WHERE status = 'live' AND mode = 'official'`);
  for (const r of rows) await app.services.live.load(r.id);
  const ticker = setInterval(() => app.services.live.tick(), 5000);

  if (config.DEMO_SEED || config.DEMO_AUTOSTART) {
    const demoId = await ensureDemoRace(db);
    if (config.DEMO_AUTOSTART) await app.services.simulator.start(demoId);
    else await app.services.simulator.reset(demoId);
  }

  await app.listen({ port: config.PORT, host: config.HOST });
  logger.info(`API en http://localhost:${config.PORT}  ·  Documentación: http://localhost:${config.PORT}/api/docs`);

  const shutdown = async (sig: string) => {
    logger.info({ sig }, 'Cerrando servidor…');
    clearInterval(ticker);
    rt.io.close();
    await app.close();
    await db.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  logger.fatal({ err }, 'No se pudo arrancar el servidor');
  process.exit(1);
});
