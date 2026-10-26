/** Error con código HTTP y código estable para el cliente. El mensaje es apto para mostrar al usuario. */
export class HttpError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export const notFound = (what = 'Recurso') => new HttpError(404, 'not_found', `${what} no encontrado`);
export const badRequest = (msg: string, details?: unknown) => new HttpError(400, 'bad_request', msg, details);
export const conflict = (msg: string) => new HttpError(409, 'conflict', msg);
export const forbidden = (msg = 'No tienes permiso para esta acción') => new HttpError(403, 'forbidden', msg);
export const unauthorized = (msg = 'Autenticación requerida') => new HttpError(401, 'unauthorized', msg);
