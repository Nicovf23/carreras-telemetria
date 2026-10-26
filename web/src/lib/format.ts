import type { Freshness, Gap, ParticipantStatus, RaceStatus } from './types';

/** 1:02:14 o 12:05 */
export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return '—';
  const total = Math.floor(Math.max(0, ms) / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

export function formatGapMs(ms: number): string {
  return `+${formatDuration(ms)}`;
}

/** Texto de una diferencia temporal y su explicación accesible. */
export function describeGap(g: Gap): { text: string; title: string; kind: 'value' | 'estimated' | 'leader' | 'none' } {
  if (g.reason === 'leader') return { text: 'Líder', title: 'Primer clasificado', kind: 'leader' };
  if (g.reason === 'not_racing') return { text: '—', title: 'No está en carrera', kind: 'none' };
  if (g.ms === null) return { text: 'Sin ref.', title: 'Sin referencia temporal: no hay puntos de control comunes ni datos suficientes', kind: 'none' };
  if (g.method === 'estimated') {
    return {
      text: `≈${formatGapMs(g.ms)}`,
      title: 'Estimada: instante en que el corredor de referencia pasó por la posición actual (punto de control virtual)',
      kind: 'estimated',
    };
  }
  if (g.method === 'checkpoint') return { text: formatGapMs(g.ms), title: `Medida en el punto de control «${g.reference}»`, kind: 'value' };
  return { text: formatGapMs(g.ms), title: 'Diferencia de tiempos finales en meta', kind: 'value' };
}

export function formatKm(m: number | null | undefined, digits = 1): string {
  if (m === null || m === undefined) return '—';
  return `${(m / 1000).toLocaleString('es', { minimumFractionDigits: digits, maximumFractionDigits: digits })} km`;
}

export function formatMeters(m: number | null | undefined): string {
  if (m === null || m === undefined) return '—';
  return m >= 1000 ? formatKm(m, 2) : `${Math.round(m)} m`;
}

export function formatAge(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return 'sin datos';
  const s = Math.round(ms / 1000);
  if (s < 60) return `hace ${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `hace ${m} min`;
  return `hace ${Math.floor(m / 60)} h ${m % 60} min`;
}

export function formatClock(iso: string | number | null, tz?: string): string {
  if (iso === null) return '—';
  return new Date(iso).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: tz });
}

export function formatDate(iso: string | null, tz?: string): string {
  if (!iso) return 'Fecha por confirmar';
  return new Date(iso).toLocaleDateString('es', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: tz });
}

const regionNames = (() => {
  try {
    return new Intl.DisplayNames(['es'], { type: 'region' });
  } catch {
    return null;
  }
})();
export const countryName = (code: string) => regionNames?.of(code.toUpperCase()) ?? code.toUpperCase();

export const FRESHNESS_LABEL: Record<Freshness, string> = {
  live: 'En vivo',
  delayed: 'Retrasado',
  stale: 'Desactualizado',
  lost: 'Conexión perdida',
  none: 'Sin datos',
};

export const STATUS_LABEL: Record<ParticipantStatus, string> = {
  registered: 'Inscrito',
  racing: 'En carrera',
  finished: 'En meta',
  dnf: 'Abandono',
  dns: 'No salió',
  dsq: 'Descalificado',
};

export const RACE_STATUS_LABEL: Record<RaceStatus, string> = {
  draft: 'Borrador',
  scheduled: 'Próxima',
  live: 'En directo',
  finished: 'Finalizada',
  cancelled: 'Cancelada',
};

/** Color estable por dorsal para marcadores y leyendas. */
const PALETTE = ['#2f6bff', '#e11d48', '#16a34a', '#f59e0b', '#9333ea', '#0891b2', '#db2777', '#65a30d', '#ea580c', '#4f46e5', '#0d9488', '#b45309'];
export const riderColor = (bib: number) => PALETTE[(bib - 1) % PALETTE.length];
