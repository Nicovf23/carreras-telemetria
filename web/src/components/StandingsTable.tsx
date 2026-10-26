import { useEffect, useRef } from 'react';
import { Link } from 'react-router';
import { describeGap, formatAge, formatDuration, formatKm, formatMeters, FRESHNESS_LABEL, STATUS_LABEL } from '../lib/format';
import type { LiveRow } from '../lib/types';
import { IconBattery } from './icons';
import { Flag, FreshnessDot } from './ui';

/** Tiempo transcurrido: los que están en carrera avanzan con el reloj de carrera local. */
export function elapsedFor(r: LiveRow, now: number | null): number | null {
  if (r.status === 'racing' && r.startTime && now !== null) return Math.max(0, now - Date.parse(r.startTime));
  return r.elapsedMs;
}

function GapCell({ g, extra }: { g: LiveRow['gapLeader']; extra?: string | null }) {
  const d = describeGap(g);
  const cls =
    d.kind === 'leader' ? 'font-semibold text-amber-600 dark:text-amber-300' : d.kind === 'none' ? 'muted text-xs italic' : d.kind === 'estimated' ? 'text-sky-700 dark:text-sky-300' : '';
  return (
    <td className="px-2 py-2 text-right whitespace-nowrap" title={d.title}>
      <span className={`tnum ${cls}`}>{d.text}</span>
      {extra && <div className="muted tnum text-[11px]">{extra}</div>}
    </td>
  );
}

function HrCell({ r }: { r: LiveRow }) {
  if (r.hr) return <span className="tnum font-semibold text-rose-600 dark:text-rose-400">{r.hr.bpm}</span>;
  const label: Record<string, string> = { no_sensor: 'Sin sensor', private: 'Privada', no_data: 'Sin datos', stale: 'Sin señal', ok: '' };
  return <span className="muted text-[11px]">{label[r.hrState]}</span>;
}

function DeviceCell({ r, now }: { r: LiveRow; now: number | null }) {
  if (!r.device) return <span className="muted text-[11px]">Sin dispositivo</span>;
  // Tras la llegada el dispositivo deja de emitir: no es una pérdida de conexión.
  if (r.status === 'finished') return <span className="muted text-[11px]">En meta</span>;
  const age = r.lastFixAt && now !== null ? now - Date.parse(r.lastFixAt) : r.lastFixAgeMs;
  return (
    <div className="flex items-center gap-2" title={`${FRESHNESS_LABEL[r.freshness]} · última posición ${formatAge(age)}${r.device.network ? ` · ${r.device.network}` : ''}${r.device.rssi !== null ? ` ${r.device.rssi} dBm` : ''}`}>
      <FreshnessDot f={r.freshness} />
      <div className="leading-tight">
        <div className="text-[11px]">{formatAge(age)}</div>
        {r.device.battery !== null && (
          <div className={`tnum flex items-center gap-1 text-[11px] ${r.device.battery < 15 ? 'text-red-600 dark:text-red-400' : 'muted'}`}>
            <IconBattery className="size-3" aria-label="Batería" /> {Math.round(r.device.battery)}%
          </div>
        )}
      </div>
    </div>
  );
}

export function StandingsTable({
  rows,
  now,
  selectedId,
  onSelect,
  raceSlug,
  compact = false,
}: {
  rows: LiveRow[];
  now: number | null;
  selectedId: string | null;
  onSelect: (id: string) => void;
  raceSlug: string;
  compact?: boolean;
}) {
  const selectedRef = useRef<HTMLTableRowElement>(null);
  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [selectedId]);

  return (
    <div className="overflow-auto">
      <table className="w-full min-w-[920px] border-collapse text-sm">
        <caption className="sr-only">Clasificación en vivo</caption>
        <thead className="sticky top-0 z-10 bg-white text-[11px] uppercase tracking-wide text-slate-500 dark:bg-ink-850 dark:text-ink-300">
          <tr className="border-b border-slate-200 dark:border-ink-700">
            <th scope="col" className="px-2 py-2 text-left">Pos</th>
            <th scope="col" className="px-2 py-2 text-left">Dorsal</th>
            <th scope="col" className="px-1 py-2"><span className="sr-only">Bandera</span></th>
            <th scope="col" className="px-2 py-2 text-left">Ciclista</th>
            {!compact && <th scope="col" className="px-2 py-2 text-left">Equipo</th>}
            <th scope="col" className="px-2 py-2 text-right">Tiempo</th>
            <th scope="col" className="px-2 py-2 text-right">Dif. líder</th>
            <th scope="col" className="px-2 py-2 text-right">Dif. anterior</th>
            <th scope="col" className="px-2 py-2 text-right">Vel. km/h</th>
            <th scope="col" className="px-2 py-2 text-right">Distancia</th>
            <th scope="col" className="px-2 py-2 text-right">FC ppm</th>
            <th scope="col" className="px-2 py-2 text-left">Dispositivo</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const sel = r.participantId === selectedId;
            const prevDist = r.distanceToPrevM !== null ? `${formatMeters(r.distanceToPrevM)} en línea recta` : null;
            return (
              <tr
                key={r.participantId}
                ref={sel ? selectedRef : undefined}
                onClick={() => onSelect(r.participantId)}
                onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onSelect(r.participantId))}
                tabIndex={0}
                aria-selected={sel}
                className={`cursor-pointer border-b border-slate-100 outline-none transition-colors dark:border-ink-800 ${
                  sel ? 'bg-brand-500/15 dark:bg-brand-500/20' : 'hover:bg-slate-50 focus-visible:bg-slate-50 dark:hover:bg-ink-800 dark:focus-visible:bg-ink-800'
                }`}
              >
                <td className="px-2 py-2">
                  {r.position !== null ? (
                    <span
                      className={`inline-flex size-7 items-center justify-center rounded-full text-xs font-bold ${
                        r.position === 1 ? 'bg-amber-400 text-amber-950' : r.position === 2 ? 'bg-slate-300 text-slate-900' : r.position === 3 ? 'bg-orange-400 text-orange-950' : 'bg-slate-200 text-slate-700 dark:bg-ink-700 dark:text-slate-200'
                      }`}
                    >
                      {r.position}
                    </span>
                  ) : (
                    <span className="muted text-[11px] font-semibold uppercase" title={STATUS_LABEL[r.status]}>
                      {r.status === 'racing' ? '—' : r.status.toUpperCase()}
                    </span>
                  )}
                </td>
                <td className="tnum px-2 py-2 font-semibold">{r.bib}</td>
                <td className="px-1 py-2">
                  <Flag code={r.countryCode} className="text-base" />
                </td>
                <td className="max-w-[180px] px-2 py-2">
                  <Link
                    to={`/carreras/${raceSlug}/participantes/${r.bib}`}
                    onClick={(e) => e.stopPropagation()}
                    className="block truncate font-medium hover:text-brand-500 hover:underline"
                  >
                    {r.firstName} {r.lastName}
                  </Link>
                  {r.status !== 'racing' && <div className="muted text-[11px]">{STATUS_LABEL[r.status]}</div>}
                </td>
                {!compact && <td className="muted max-w-[160px] truncate px-2 py-2 text-xs">{r.team}</td>}
                <td className="tnum px-2 py-2 text-right font-semibold">{formatDuration(elapsedFor(r, now))}</td>
                <GapCell g={r.gapLeader} />
                <GapCell g={r.gapPrev} extra={prevDist} />
                <td className="tnum px-2 py-2 text-right" title={r.speedSource === 'estimated' ? 'Estimada a partir de las dos últimas posiciones' : undefined}>
                  {r.speedKmh !== null ? (
                    <>
                      {r.speedKmh.toFixed(1)}
                      {r.speedSource === 'estimated' && <span className="muted">*</span>}
                    </>
                  ) : (
                    <span className="muted">—</span>
                  )}
                </td>
                <td className="tnum px-2 py-2 text-right">{formatKm(r.progress)}</td>
                <td className="px-2 py-2 text-right">
                  <HrCell r={r} />
                </td>
                <td className="px-2 py-2">
                  <DeviceCell r={r} now={now} />
                </td>
              </tr>
            );
          })}
          {rows.length === 0 && (
            <tr>
              <td colSpan={12} className="muted px-4 py-8 text-center">
                Ningún participante coincide con los filtros.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
