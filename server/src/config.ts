import { config as loadEnv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { z } from 'zod';

const here = path.dirname(fileURLToPath(import.meta.url));
// El .env vive en la raíz del monorepo (../../ desde src o dist)
loadEnv({ path: path.resolve(here, '../../.env') });

const bool = z
  .string()
  .optional()
  .transform((v) => v === 'true' || v === '1');

const schema = z.object({
  PORT: z.coerce.number().int().default(4000),
  HOST: z.string().default('0.0.0.0'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  CORS_ORIGINS: z.string().default('http://localhost:5173'),
  DATABASE_URL: z.string().optional().default(''),
  PGLITE_DIR: z.string().default('./data/pglite'),
  JWT_SECRET: z.string().optional().default(''),
  SESSION_HOURS: z.coerce.number().positive().default(12),
  ADMIN_EMAIL: z.string().optional().default(''),
  ADMIN_PASSWORD: z.string().optional().default(''),
  TELEMETRY_MAX_FUTURE_SKEW_S: z.coerce.number().nonnegative().default(30),
  TELEMETRY_MAX_AGE_H: z.coerce.number().positive().default(48),
  DEMO_SEED: bool,
  DEMO_AUTOSTART: bool,
  DEMO_SPEED: z.coerce.number().positive().max(120).default(10),
});

const parsed = schema.parse(process.env);

if (parsed.JWT_SECRET.length < 32) {
  if (parsed.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET debe tener al menos 32 caracteres en producción. Revisa .env');
  }
}

export const config = {
  ...parsed,
  rootDir: path.resolve(here, '../..'),
  pgliteDir: path.resolve(here, '../..', parsed.PGLITE_DIR),
  corsOrigins: parsed.CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean),
};
export type Config = typeof config;
