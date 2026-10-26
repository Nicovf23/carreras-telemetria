import { haversine, lerp, projectOnSegment } from './geo.js';
import type { LatLon } from './types.js';

export interface Projection {
  along: number;
  offset: number;
  point: LatLon;
}

/** Polilínea del recorrido con distancias acumuladas. */
export class RouteModel {
  readonly points: LatLon[];
  readonly cum: number[];
  readonly length: number;
  /** El recorrido termina donde empieza (circuito). */
  readonly isLoop: boolean;

  constructor(points: LatLon[]) {
    if (points.length < 2) throw new Error('El recorrido necesita al menos 2 puntos');
    this.points = points;
    this.cum = [0];
    for (let i = 1; i < points.length; i++) this.cum.push(this.cum[i - 1] + haversine(points[i - 1], points[i]));
    this.length = this.cum[this.cum.length - 1];
    this.isLoop = haversine(points[0], points[points.length - 1]) < 50;
  }

  /** Punto a una distancia del inicio. Con `extrapolate`, más allá del final se prolonga el último tramo. */
  pointAt(distance: number, extrapolate = false): LatLon {
    const n = this.points.length;
    if (extrapolate && distance > this.length) {
      const segLen = this.cum[n - 1] - this.cum[n - 2];
      return lerp(this.points[n - 2], this.points[n - 1], segLen === 0 ? 1 : 1 + (distance - this.length) / segLen);
    }
    const d = Math.max(0, Math.min(this.length, distance));
    let lo = 0;
    let hi = this.cum.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (this.cum[mid] <= d) lo = mid;
      else hi = mid;
    }
    const seg = this.cum[hi] - this.cum[lo];
    return lerp(this.points[lo], this.points[hi], seg === 0 ? 0 : (d - this.cum[lo]) / seg);
  }

  /**
   * Proyecta una posición sobre el recorrido. Si se da `hint` (distancia previa),
   * se prefieren los segmentos dentro de [hint - back, hint + fwd]; así se resuelven
   * ambigüedades en recorridos de ida y vuelta o que se cruzan consigo mismos.
   */
  project(
    p: LatLon,
    hint?: number,
    window = { back: 300, fwd: 3000 },
    tolerance = 150,
    /** En circuitos la ventana es cíclica: tras el final viene el principio. */
    cyclic = false,
  ): Projection {
    let best: Projection | null = null;
    let bestInWindow: Projection | null = null;
    const last = this.points.length - 1;
    for (let i = 1; i < this.points.length; i++) {
      // Tras la meta de un recorrido lineal el ciclista sigue avanzando: el último tramo se
      // prolonga hasta 500 m para que el instante de llegada se pueda interpolar.
      const segLen = this.cum[i] - this.cum[i - 1];
      const maxF = i === last && !cyclic && segLen > 0 ? 1 + 500 / segLen : 1;
      const { fraction, offset } = projectOnSegment(p, this.points[i - 1], this.points[i], maxF);
      const along = this.cum[i - 1] + fraction * (this.cum[i] - this.cum[i - 1]);
      const cand = { along, offset, point: lerp(this.points[i - 1], this.points[i], fraction) };
      if (!best || offset < best.offset) best = cand;
      if (hint === undefined || offset > tolerance) continue;
      let delta = along - hint;
      if (cyclic) {
        delta = ((delta % this.length) + this.length) % this.length;
        if (delta > this.length / 2) delta -= this.length;
      }
      if (delta >= -window.back && delta <= window.fwd) {
        if (!bestInWindow || offset < bestInWindow.offset) bestInWindow = cand;
      }
    }
    return bestInWindow ?? best!;
  }
}
