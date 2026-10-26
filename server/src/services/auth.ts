import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';
import { config } from '../config.js';
import type { Db } from '../db/index.js';
import { logger } from '../lib/logger.js';

export type Role = 'admin' | 'organizer';
export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: Role;
}

let secret: Uint8Array;
if (config.JWT_SECRET.length >= 32) {
  secret = new TextEncoder().encode(config.JWT_SECRET);
} else {
  // Solo en desarrollo: secreto efímero (las sesiones se pierden al reiniciar).
  secret = crypto.randomBytes(48);
  logger.warn('JWT_SECRET no configurado: usando un secreto temporal. Configúralo en .env');
}

export const SESSION_COOKIE = 'session';

export const hashPassword = (pw: string) => bcrypt.hash(pw, 12);
export const verifyPassword = (pw: string, hash: string) => bcrypt.compare(pw, hash);
/** Hash de relleno para que un email inexistente tarde lo mismo que una contraseña errónea. */
export const DUMMY_HASH = bcrypt.hashSync(crypto.randomBytes(16).toString('hex'), 12);

export async function signSession(u: SessionUser): Promise<string> {
  return new SignJWT({ email: u.email, name: u.name, role: u.role })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(u.id)
    .setIssuedAt()
    .setExpirationTime(`${config.SESSION_HOURS}h`)
    .sign(secret);
}

export async function verifySession(token: string): Promise<SessionUser | null> {
  try {
    const { payload } = await jwtVerify(token, secret, { algorithms: ['HS256'] });
    if (!payload.sub || (payload.role !== 'admin' && payload.role !== 'organizer')) return null;
    return { id: payload.sub, email: String(payload.email), name: String(payload.name), role: payload.role };
  } catch {
    return null;
  }
}

/** Crea el primer administrador a partir de ADMIN_EMAIL / ADMIN_PASSWORD si no hay usuarios. */
export async function bootstrapAdmin(db: Db) {
  const { rows } = await db.query<{ n: number }>('SELECT count(*)::int AS n FROM users');
  if (rows[0].n > 0) return;
  if (!config.ADMIN_EMAIL || !config.ADMIN_PASSWORD) {
    logger.warn('No hay usuarios. Define ADMIN_EMAIL y ADMIN_PASSWORD en .env para crear el administrador inicial.');
    return;
  }
  if (config.ADMIN_PASSWORD.length < 10) {
    logger.error('ADMIN_PASSWORD debe tener al menos 10 caracteres. No se ha creado el administrador.');
    return;
  }
  await db.query(`INSERT INTO users (email, name, password_hash, role) VALUES ($1, $2, $3, 'admin')`, [
    config.ADMIN_EMAIL.toLowerCase(),
    'Administrador',
    await hashPassword(config.ADMIN_PASSWORD),
  ]);
  logger.info({ email: config.ADMIN_EMAIL }, 'Administrador inicial creado');
}
