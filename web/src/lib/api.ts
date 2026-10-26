export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

/**
 * Cliente HTTP. Envía la cookie de sesión y la cabecera X-Requested-With que el
 * backend exige en peticiones que modifican datos (protección CSRF).
 */
export async function api<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('X-Requested-With', 'fetch');
  let body = init.body;
  if (init.json !== undefined) {
    headers.set('Content-Type', 'application/json');
    body = JSON.stringify(init.json);
  }
  const res = await fetch(path, { ...init, body, headers, credentials: 'include' });
  const isJson = res.headers.get('content-type')?.includes('application/json');
  const data = isJson ? await res.json() : await res.text();
  if (!res.ok) {
    const d = (isJson ? data : {}) as { error?: string; message?: string; details?: unknown };
    const fallback = res.status >= 502 && res.status <= 504 ? 'El servidor no está disponible en este momento' : `Error ${res.status}`;
    throw new ApiError(res.status, d.error ?? 'error', d.message ?? fallback, d.details);
  }
  return data as T;
}

export const post = <T>(path: string, json?: unknown) => api<T>(path, { method: 'POST', json: json ?? {} });
export const patch = <T>(path: string, json: unknown) => api<T>(path, { method: 'PATCH', json });
export const put = <T>(path: string, json: unknown) => api<T>(path, { method: 'PUT', json });
export const del = <T>(path: string) => api<T>(path, { method: 'DELETE' });

/** Mensaje legible de un error (incluye detalles de validación). */
export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) {
    if (Array.isArray(e.details) && e.details.length) {
      return `${e.message}: ${(e.details as { path: string; message: string }[]).map((d) => `${d.path} ${d.message}`).join('; ')}`;
    }
    return e.message;
  }
  return e instanceof Error ? e.message : String(e);
}
