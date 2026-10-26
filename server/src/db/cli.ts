/**
 * Utilidades de línea de comandos:
 *   npm run db:migrate            Aplica migraciones pendientes
 *   npm run db:seed               Crea la carrera DEMO (datos ficticios)
 *   npm run device:key -- SERIAL  Crea (o regenera la clave de) un dispositivo real y muestra su token una sola vez
 */
import { ensureDemoRace } from '../demo/seed.js';
import { generateDeviceSecret, hashSecret, secretHint } from '../lib/keys.js';
import { bootstrapAdmin } from '../services/auth.js';
import { migrate, openDb } from './index.js';

const [cmd, arg] = process.argv.slice(2);
const db = await openDb();
try {
  await migrate(db);
  if (cmd === 'migrate') {
    await bootstrapAdmin(db);
    console.log('Migraciones al día.');
  } else if (cmd === 'seed') {
    await ensureDemoRace(db);
    console.log('Carrera DEMO lista.');
  } else if (cmd === 'device-key') {
    if (!arg || !/^[A-Za-z0-9_-]{3,64}$/.test(arg)) throw new Error('Uso: npm run device:key -- SERIAL');
    const secret = generateDeviceSecret();
    const { rows } = await db.query(
      `INSERT INTO devices (serial, label, key_hash, key_hint) VALUES ($1, $1, $2, $3)
       ON CONFLICT (serial) DO UPDATE SET key_hash = EXCLUDED.key_hash, key_hint = EXCLUDED.key_hint WHERE NOT devices.is_simulated
       RETURNING id`,
      [arg, hashSecret(secret), secretHint(secret)],
    );
    if (!rows.length) throw new Error(`${arg} es un dispositivo virtual del modo DEMO y no admite clave`);
    console.log(`Token del dispositivo (guárdalo ahora, no se puede recuperar):\n${arg}.${secret}`);
  } else {
    console.log('Comandos: migrate | seed | device-key SERIAL');
  }
} finally {
  await db.close();
}
