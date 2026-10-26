import crypto from 'node:crypto';

/**
 * Credenciales de dispositivo. El token que se graba en el firmware es
 * `<serial>.<secreto>`; en la base de datos solo se guarda el SHA-256 del secreto
 * (el secreto tiene 192 bits de entropía, por lo que no hace falta un hash lento).
 */
export function generateDeviceSecret(): string {
  return crypto.randomBytes(24).toString('base64url');
}

export function hashSecret(secret: string): string {
  return crypto.createHash('sha256').update(secret, 'utf8').digest('hex');
}

export function secretMatches(secret: string, expectedHash: string): boolean {
  const a = Buffer.from(hashSecret(secret), 'hex');
  const b = Buffer.from(expectedHash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Pista no secreta para identificar la clave en el panel (últimos 4 caracteres). */
export const secretHint = (secret: string) => `…${secret.slice(-4)}`;

export function parseDeviceToken(header: string | undefined): { serial: string; secret: string } | null {
  if (!header) return null;
  const m = /^Bearer\s+([A-Za-z0-9_-]{1,64})\.([A-Za-z0-9_-]{16,128})$/.exec(header.trim());
  return m ? { serial: m[1], secret: m[2] } : null;
}
