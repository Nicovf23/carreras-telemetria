import type { LatLon } from './types.js';

export const EARTH_RADIUS_M = 6371008.8;
const toRad = (d: number) => (d * Math.PI) / 180;

export function isValidCoordinate(lat: unknown, lon: unknown): boolean {
  return (
    typeof lat === 'number' &&
    typeof lon === 'number' &&
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    lat >= -90 &&
    lat <= 90 &&
    lon >= -180 &&
    lon <= 180 &&
    // (0,0) es el valor típico de un receptor GNSS sin fix: se rechaza.
    !(lat === 0 && lon === 0)
  );
}

/** Distancia de círculo máximo (haversine) en metros. */
export function haversine(a: LatLon, b: LatLon): number {
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function lerp(a: LatLon, b: LatLon, f: number): LatLon {
  return { lat: a.lat + (b.lat - a.lat) * f, lon: a.lon + (b.lon - a.lon) * f };
}

/** Rumbo inicial de a hacia b en grados [0, 360). */
export function bearing(a: LatLon, b: LatLon): number {
  const y = Math.sin(toRad(b.lon - a.lon)) * Math.cos(toRad(b.lat));
  const x =
    Math.cos(toRad(a.lat)) * Math.sin(toRad(b.lat)) -
    Math.sin(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.cos(toRad(b.lon - a.lon));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/**
 * Proyección de p sobre el segmento a-b con una aproximación equirectangular local
 * (error despreciable para segmentos de pocos km). Devuelve la fracción [0,1] y la
 * distancia perpendicular en metros. Con `maxFraction` > 1 se permite prolongar el
 * segmento más allá de `b` (para posiciones pasada la meta).
 */
export function projectOnSegment(p: LatLon, a: LatLon, b: LatLon, maxFraction = 1): { fraction: number; offset: number } {
  const kx = Math.cos(toRad(p.lat)) * toRad(1) * EARTH_RADIUS_M;
  const ky = toRad(1) * EARTH_RADIUS_M;
  const ax = a.lon * kx, ay = a.lat * ky;
  const bx = b.lon * kx, by = b.lat * ky;
  const px = p.lon * kx, py = p.lat * ky;
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let f = len2 === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / len2;
  f = Math.max(0, Math.min(maxFraction, f));
  const cx = ax + f * dx, cy = ay + f * dy;
  return { fraction: f, offset: Math.hypot(px - cx, py - cy) };
}
