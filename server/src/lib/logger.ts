import pino from 'pino';

/**
 * Logger estructurado. Los campos sensibles se redactan para no filtrar
 * contraseñas, claves de dispositivo ni cookies de sesión en los registros.
 */
export const logger = pino({
  level: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === 'test' ? 'silent' : 'info'),
  redact: {
    paths: [
      'password',
      '*.password',
      'req.headers.authorization',
      'req.headers.cookie',
      'res.headers["set-cookie"]',
      'apiKey',
      '*.apiKey',
      'key',
      '*.key',
    ],
    censor: '[redactado]',
  },
  transport:
    process.env.NODE_ENV === 'production' || process.env.NODE_ENV === 'test'
      ? undefined
      : { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } },
});
