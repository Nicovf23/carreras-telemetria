import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { config } from '../config.js';
import { forbidden, unauthorized } from '../lib/errors.js';
import { DUMMY_HASH, SESSION_COOKIE, signSession, verifyPassword, verifySession, type Role, type SessionUser } from '../services/auth.js';

declare module 'fastify' {
  interface FastifyRequest {
    user?: SessionUser;
  }
}

/**
 * preHandler de autenticación. Las peticiones que modifican datos deben llevar la
 * cabecera X-Requested-With: fetch, que un formulario de otro sitio no puede enviar
 * sin una petición CORS previa (protección CSRF junto a la cookie SameSite=Strict).
 */
export function requireRole(...roles: Role[]) {
  return async (req: FastifyRequest, _reply: FastifyReply) => {
    const token = req.cookies[SESSION_COOKIE];
    const user = token ? await verifySession(token) : null;
    if (!user) throw unauthorized();
    if (req.method !== 'GET' && req.method !== 'HEAD' && req.headers['x-requested-with'] !== 'fetch') {
      throw forbidden('Falta la cabecera X-Requested-With');
    }
    if (roles.length && !roles.includes(user.role)) throw forbidden();
    req.user = user;
  };
}

const loginSchema = z.object({ email: z.string().email().max(200), password: z.string().min(1).max(200) });

export async function registerAuthRoutes(app: FastifyInstance) {
  const { db } = app.services;

  app.post(
    '/login',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const { email, password } = loginSchema.parse(req.body);
      const { rows } = await db.query<any>('SELECT * FROM users WHERE email = $1 AND NOT disabled', [email.toLowerCase()]);
      const u = rows[0];
      // Compara siempre un hash para no revelar por tiempos si el email existe.
      const ok = await verifyPassword(password, u?.password_hash ?? DUMMY_HASH);
      if (!u || !ok) {
        req.log.warn({ email }, 'Inicio de sesión fallido');
        throw unauthorized('Email o contraseña incorrectos');
      }
      const user: SessionUser = { id: u.id, email: u.email, name: u.name, role: u.role };
      reply.setCookie(SESSION_COOKIE, await signSession(user), {
        httpOnly: true,
        sameSite: 'strict',
        secure: config.NODE_ENV === 'production',
        path: '/',
        maxAge: config.SESSION_HOURS * 3600,
      });
      req.log.info({ userId: u.id }, 'Sesión iniciada');
      return { user };
    },
  );

  app.post('/logout', async (_req, reply) => {
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  app.get('/me', { preHandler: requireRole() }, async (req) => ({ user: req.user }));
}
