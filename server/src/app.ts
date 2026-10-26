import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import Fastify, { type FastifyBaseLogger } from 'fastify';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import { ZodError } from 'zod';
import { config } from './config.js';
import type { Db } from './db/index.js';
import { DemoSimulator } from './demo/simulator.js';
import { HttpError } from './lib/errors.js';
import { logger } from './lib/logger.js';
import { registerAdminRoutes } from './routes/admin.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerPublicRoutes } from './routes/public.js';
import { registerTelemetryRoutes } from './routes/telemetry.js';
import { LiveManager } from './services/live.js';
import { TelemetryService } from './services/telemetry.js';

const here = path.dirname(fileURLToPath(import.meta.url));

export interface AppServices {
  db: Db;
  live: LiveManager;
  telemetry: TelemetryService;
  simulator: DemoSimulator;
}

declare module 'fastify' {
  interface FastifyInstance {
    services: AppServices;
  }
}

export async function buildApp(db: Db, opts: { onSnapshot?: ConstructorParameters<typeof LiveManager>[1] } = {}) {
  const app = Fastify({
    loggerInstance: logger as unknown as FastifyBaseLogger,
    bodyLimit: 2 * 1024 * 1024,
    trustProxy: true,
  });

  const live = new LiveManager(db, opts.onSnapshot);
  const telemetry = new TelemetryService(db, live);
  const simulator = new DemoSimulator(db, live, telemetry, { speed: config.DEMO_SPEED, autoLoop: config.DEMO_AUTOSTART });
  app.decorate('services', { db, live, telemetry, simulator });

  await app.register(cors, { origin: config.corsOrigins, credentials: true });
  await app.register(cookie);
  await app.register(rateLimit, { global: false });

  // Documentación OpenAPI (contrato escrito a mano en openapi.yaml)
  const spec = YAML.parse(fs.readFileSync(path.join(here, 'openapi.yaml'), 'utf8'));
  await app.register(swagger, { mode: 'static', specification: { document: spec } });
  await app.register(swaggerUi, { routePrefix: '/api/docs' });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof HttpError) {
      return reply.status(err.statusCode).send({ error: err.code, message: err.message, details: err.details });
    }
    if (err instanceof ZodError) {
      return reply.status(400).send({
        error: 'validation',
        message: 'Datos no válidos',
        details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
    }
    const e = err as { statusCode?: number; message?: string; code?: string };
    if (e.statusCode && e.statusCode < 500) {
      return reply.status(e.statusCode).send({ error: e.code ?? 'bad_request', message: e.message });
    }
    // Errores de restricción única de PostgreSQL
    if ((err as { code?: string }).code === '23505') {
      return reply.status(409).send({ error: 'conflict', message: 'Ya existe un registro con esos datos (valor duplicado)' });
    }
    req.log.error({ err }, 'Error no controlado');
    return reply.status(500).send({ error: 'internal', message: 'Error interno del servidor' });
  });

  app.get('/api/health', { logLevel: 'warn' }, async () => ({ ok: true, db: db.kind, time: new Date().toISOString() }));

  // Las rutas de alta frecuencia (público, telemetría) solo registran avisos y errores.
  await app.register(registerPublicRoutes, { prefix: '/api/v1', logLevel: 'warn' });
  await app.register(registerAuthRoutes, { prefix: '/api/v1/auth' });
  await app.register(registerAdminRoutes, { prefix: '/api/v1/admin' });
  await app.register(registerTelemetryRoutes, { prefix: '/api/v1', logLevel: 'warn' });

  // En producción el backend sirve también el frontend compilado (web/dist).
  const webDist = path.resolve(config.rootDir, 'web/dist');
  if (fs.existsSync(webDist)) {
    await app.register(fastifyStatic, { root: webDist, wildcard: false });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api') || req.url.startsWith('/socket.io')) {
        return reply.status(404).send({ error: 'not_found', message: 'Ruta no encontrada' });
      }
      return reply.sendFile('index.html');
    });
  } else {
    // Sin la web compilada solo existe la API: lo decimos claramente en vez de un 404 genérico.
    app.log.warn({ webDist }, 'No existe web/dist: ejecuta "npm run build" para servir la web');
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api') || req.url.startsWith('/socket.io')) {
        return reply.status(404).send({ error: 'not_found', message: 'Ruta no encontrada' });
      }
      return reply
        .status(503)
        .type('text/html; charset=utf-8')
        .send(
          '<h1>La web no está compilada</h1><p>El servidor (API) funciona, pero falta <code>web/dist</code>. ' +
            'Usa como comando de build <code>npm ci --include=dev &amp;&amp; npm run build</code>. ' +
            'API: <a href="/api/health">/api/health</a> · <a href="/api/docs">/api/docs</a></p>',
        );
    });
  }

  app.addHook('onClose', async () => {
    simulator.stop();
    live.dispose();
  });

  return app;
}
