import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../config.js';
import { logger } from '../lib/logger.js';

export interface Queryable {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

export interface Db extends Queryable {
  kind: 'postgres' | 'pglite';
  /** Ejecuta varias sentencias SQL (sin parámetros). */
  exec(sql: string): Promise<void>;
  transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

async function createPostgres(url: string): Promise<Db> {
  const pg = await import('pg');
  // int8 (bigserial, count) como número JS; los valores de esta app caben en 2^53.
  pg.default.types.setTypeParser(20, (v) => Number(v));
  const pool = new pg.default.Pool({ connectionString: url, max: 10 });
  pool.on('error', (err) => logger.error({ err }, 'Error en el pool de PostgreSQL'));
  return {
    kind: 'postgres',
    query: async (sql, params) => pool.query(sql, params as unknown[]) as never,
    exec: async (sql) => {
      await pool.query(sql);
    },
    transaction: async (fn) => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const res = await fn({ query: (sql, params) => client.query(sql, params as unknown[]) as never });
        await client.query('COMMIT');
        return res;
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}

async function createPglite(dir: string | null): Promise<Db> {
  const { PGlite, types } = await import('@electric-sql/pglite');
  if (dir) fs.mkdirSync(dir, { recursive: true });
  const db = new PGlite(dir ?? undefined, {
    parsers: { [types.INT8]: (v: string) => Number(v) },
  });
  await db.waitReady;
  // PGlite es monoproceso: serializamos las transacciones para evitar intercalados.
  let chain: Promise<unknown> = Promise.resolve();
  return {
    kind: 'pglite',
    query: async (sql, params) => (await db.query(sql, params)) as never,
    exec: async (sql) => {
      await db.exec(sql);
    },
    transaction: (fn) => {
      const run = chain.then(() => db.transaction((tx) => fn({ query: (sql, params) => tx.query(sql, params) as never })));
      chain = run.catch(() => undefined);
      return run;
    },
    close: () => db.close(),
  };
}

let instance: Db | null = null;

/** Abre la base de datos configurada. `memory` fuerza PGlite en memoria (pruebas). */
export async function openDb(opts: { memory?: boolean } = {}): Promise<Db> {
  if (opts.memory) return createPglite(null);
  if (instance) return instance;
  if (config.DATABASE_URL) {
    instance = await createPostgres(config.DATABASE_URL);
    logger.info('Base de datos: PostgreSQL');
  } else {
    instance = await createPglite(config.pgliteDir);
    logger.info({ dir: config.pgliteDir }, 'Base de datos: PGlite (PostgreSQL embebido)');
  }
  return instance;
}

const migrationsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');

/** Aplica en orden las migraciones SQL pendientes. */
export async function migrate(db: Db): Promise<string[]> {
  await db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
  const done = new Set((await db.query<{ name: string }>('SELECT name FROM schema_migrations')).rows.map((r) => r.name));
  const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();
  const applied: string[] = [];
  for (const f of files) {
    if (done.has(f)) continue;
    const sql = fs.readFileSync(path.join(migrationsDir, f), 'utf8');
    await db.exec(`BEGIN;\n${sql}\nINSERT INTO schema_migrations (name) VALUES ('${f.replace(/'/g, "''")}');\nCOMMIT;`);
    applied.push(f);
    logger.info({ migration: f }, 'Migración aplicada');
  }
  return applied;
}
