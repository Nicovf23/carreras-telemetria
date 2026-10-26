import { useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { IconBattery, IconClock, IconGauge, IconHeart, IconRoute, IconSearch, IconSignal, IconUsers } from '../components/icons';
import { PublicLayout } from '../components/Layout';
import { RaceMap } from '../components/RaceMap';
import { elapsedFor, StandingsTable } from '../components/StandingsTable';
import { DemoBadge, DemoBanner, ErrorBox, Flag, FreshnessBadge, RaceStatusBadge, Spinner, Stat } from '../components/ui';
import { useLiveRace, useRaceClock, type ConnState } from '../hooks/useLiveRace';
import { api, ApiError, errorMessage, post } from '../lib/api';
import { countryName, describeGap, formatAge, formatClock, formatDate, formatDuration, formatKm, formatMeters, riderColor, STATUS_LABEL } from '../lib/format';
import type { LiveRow, LiveSnapshot, RaceDetail } from '../lib/types';

/** Reinicia la simulación DEMO (borra los datos simulados y da una nueva salida). */
function RestartDemoButton({ slug }: { slug: string }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const restart = async () => {
    setBusy(true);
    setErr(null);
    try {
      await post(`/api/v1/races/${encodeURIComponent(slug)}/demo/restart`);
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-col items-end">
      <button className="btn-secondary border-amber-400/60 py-1.5" onClick={restart} disabled={busy} title="Borra los datos simulados y vuelve a dar la salida">
        {busy ? 'Reiniciando…' : '↻ Reiniciar DEMO'}
      </button>
      {err && <span className="mt-1 text-[11px] text-red-600 dark:text-red-400">{err}</span>}
    </div>
  );
}

function ConnIndicator({ conn, running }: { conn: ConnState; running: boolean }) {
  const map: Record<ConnState, [string, string]> = {
    connected: [running ? 'En vivo' : 'Conectado', 'bg-live/15 text-green-700 dark:text-green-300'],
    connecting: ['Conectando…', 'bg-slate-500/15 muted'],
    reconnecting: ['Reconectando…', 'bg-amber-400/20 text-amber-800 dark:text-amber-200'],
    offline: ['Sin conexión · actualizando cada 5 s', 'bg-red-500/15 text-red-700 dark:text-red-300'],
  };
  const [label, cls] = map[conn];
  return (
    <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold ${cls}`} role="status" aria-live="polite">
      <span className={`size-2 rounded-full ${conn === 'connected' ? 'bg-live' : conn === 'offline' ? 'bg-lost' : 'bg-delayed'} ${conn === 'connected' && running ? 'pulse-dot' : ''}`} />
      {label}
    </span>
  );
}

function SelectedRider({ r, now, slug, snapshot }: { r: LiveRow; now: number | null; slug: string; snapshot: LiveSnapshot }) {
  const gl = describeGap(r.gapLeader);
  const gp = describeGap(r.gapPrev);
  const age = r.lastFixAt && now !== null ? now - Date.parse(r.lastFixAt) : null;
  const total = snapshot.race.courseLengthM;
  return (
    <div className="panel p-4">
      <div className="flex items-start gap-3">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-full text-lg font-black text-white" style={{ background: riderColor(r.bib) }}>
          {r.bib}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="truncate text-lg font-bold">
              {r.firstName} {r.lastName}
            </h2>
            <Flag code={r.countryCode} className="text-lg" />
          </div>
          <div className="muted truncate text-sm">
            {r.team} · {countryName(r.countryCode)}
          </div>
        </div>
        <div className="text-right">
          <div className="text-2xl font-black tnum">{r.position ?? '—'}</div>
          <div className="muted text-[11px]">{r.position ? 'posición' : STATUS_LABEL[r.status]}</div>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-3 text-center">
        <div>
          <div className="tnum text-xl font-bold">{r.speedKmh !== null ? r.speedKmh.toFixed(1) : '—'}</div>
          <div className="muted text-[11px]">km/h{r.speedSource === 'estimated' ? ' (estim.)' : ''}</div>
        </div>
        <div>
          <div className="tnum text-xl font-bold text-rose-600 dark:text-rose-400">{r.hr ? r.hr.bpm : '—'}</div>
          <div className="muted flex items-center justify-center gap-1 text-[11px]">
            <IconHeart className="size-3" />
            {r.hr ? 'ppm' : { no_sensor: 'sin sensor', private: 'privada', no_data: 'sin datos', stale: 'sin señal', ok: '' }[r.hrState]}
          </div>
        </div>
        <div>
          <div className="tnum text-xl font-bold">{formatKm(r.progress)}</div>
          <div className="muted text-[11px]">{total ? `de ${formatKm(total)}` : 'recorridos'}</div>
        </div>
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
        <dt className="muted">Tiempo</dt>
        <dd className="tnum text-right font-semibold">{formatDuration(elapsedFor(r, now))}</dd>
        <dt className="muted">Dif. líder</dt>
        <dd className="tnum text-right" title={gl.title}>{gl.text}</dd>
        <dt className="muted">Dif. anterior</dt>
        <dd className="tnum text-right" title={gp.title}>{gp.text}</dd>
        <dt className="muted">Distancia al anterior</dt>
        <dd className="tnum text-right">
          {r.courseDistanceToPrevM !== null ? `${formatMeters(r.courseDistanceToPrevM)} por carretera` : r.distanceToPrevM !== null ? `${formatMeters(r.distanceToPrevM)} en línea recta` : '—'}
        </dd>
        <dt className="muted">Último punto</dt>
        <dd className="text-right">
          {r.lastCheckpoint ? (
            <>
              {r.lastCheckpoint.name} <span className="tnum muted">{formatDuration(r.lastCheckpoint.splitMs)}</span>
            </>
          ) : (
            '—'
          )}
        </dd>
        <dt className="muted">Última posición</dt>
        <dd className="text-right">{formatAge(age)}</dd>
      </dl>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-slate-200 pt-3 text-xs dark:border-ink-700">
        {r.status === 'finished' ? <span className="muted">En meta</span> : <FreshnessBadge f={r.freshness} />}
        {r.device?.battery !== null && r.device?.battery !== undefined && (
          <span className="muted flex items-center gap-1">
            <IconBattery className="size-3.5" /> {Math.round(r.device.battery)}%
          </span>
        )}
        {r.device?.rssi !== null && r.device?.rssi !== undefined && (
          <span className="muted flex items-center gap-1">
            <IconSignal className="size-3.5" /> {r.device.network} {r.device.rssi} dBm
          </span>
        )}
        {!r.device && <span className="muted">Sin dispositivo asignado</span>}
        <Link to={`/carreras/${slug}/participantes/${r.bib}`} className="ml-auto font-semibold text-brand-600 hover:underline dark:text-brand-400">
          Perfil completo →
        </Link>
      </div>
    </div>
  );
}

export function RacePage() {
  const { slug } = useParams();
  const [detail, setDetail] = useState<RaceDetail | null>(null);
  const [detailErr, setDetailErr] = useState<string | null>(null);
  const { snapshot, receivedAt, conn, error } = useLiveRace(slug);
  const now = useRaceClock(snapshot, receivedAt);
  const [params, setParams] = useSearchParams();
  const selectedId = params.get('sel');
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');
  const [team, setTeam] = useState('');
  const [country, setCountry] = useState('');

  useEffect(() => {
    if (!slug) return;
    let alive = true;
    let retry: ReturnType<typeof setTimeout>;
    const load = () =>
      api<RaceDetail>(`/api/v1/races/${encodeURIComponent(slug)}`)
        .then((d) => {
          if (!alive) return;
          setDetail(d);
          setDetailErr(null);
        })
        .catch((e) => {
          if (!alive) return;
          // 404 es definitivo; cualquier otro error (servidor reiniciando, red) se reintenta.
          if (e instanceof ApiError && e.status === 404) setDetailErr(e.message);
          else retry = setTimeout(load, 3000);
        });
    load();
    return () => {
      alive = false;
      clearTimeout(retry);
    };
  }, [slug, snapshot?.race.status]);

  const select = (id: string) => {
    const p = new URLSearchParams(params);
    if (p.get('sel') === id) p.delete('sel');
    else p.set('sel', id);
    setParams(p, { replace: true });
  };

  const rows = snapshot?.rows ?? [];
  const teams = useMemo(() => [...new Set(rows.map((r) => r.team).filter(Boolean))].sort(), [rows]);
  const countries = useMemo(() => [...new Set(rows.map((r) => r.countryCode))].sort((a, b) => countryName(a).localeCompare(countryName(b), 'es')), [rows]);
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return rows.filter(
      (r) =>
        (!cat || r.categoryCode === cat) &&
        (!team || r.team === team) &&
        (!country || r.countryCode === country) &&
        (!s || String(r.bib) === s || `${r.firstName} ${r.lastName}`.toLowerCase().includes(s)),
    );
  }, [rows, q, cat, team, country]);
  const selected = rows.find((r) => r.participantId === selectedId) ?? null;

  if (detailErr) {
    return (
      <PublicLayout>
        <div className="mx-auto max-w-3xl p-6">
          <ErrorBox>{detailErr ?? error}</ErrorBox>
          <Link to="/" className="btn-secondary mt-4">
            ← Volver a las carreras
          </Link>
        </div>
      </PublicLayout>
    );
  }
  if (!detail || !snapshot) {
    return (
      <PublicLayout>
        <Spinner label="Cargando carrera…" />
      </PublicLayout>
    );
  }

  const race = detail.race;
  const leader = snapshot.rows.find((r) => r.position === 1);
  const raceElapsed = snapshot.race.startedAt && now !== null ? now - Date.parse(snapshot.race.startedAt) : null;
  const leaderElapsed = leader ? elapsedFor(leader, now) : null;
  const avgKmh = leader?.progress && leaderElapsed ? leader.progress / 1000 / (leaderElapsed / 3_600_000) : null;
  const racing = snapshot.rows.filter((r) => r.status === 'racing').length;
  const total = snapshot.race.courseLengthM;
  const pct = total && leader?.progress ? Math.min(100, (leader.progress / total) * 100) : 0;

  return (
    <PublicLayout banner={race.mode === 'demo' ? <DemoBanner /> : undefined}>
      <div className="mx-auto max-w-[1600px] space-y-4 px-3 py-4 sm:px-4">
        {/* Cabecera */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-black tracking-tight">{race.name}</h1>
              <RaceStatusBadge status={snapshot.race.status} />
              <DemoBadge mode={race.mode} />
            </div>
            <p className="muted mt-0.5 text-sm">
              {formatDate(race.startedAt ?? race.scheduledStart, race.timezone)} · {race.location}
              {detail.categories.length > 0 && ` · ${detail.categories.map((c) => c.name).join(', ')}`}
            </p>
          </div>
          <div className="flex items-center gap-3">
            {race.mode === 'demo' && <RestartDemoButton slug={race.slug} />}
            <ConnIndicator conn={conn} running={snapshot.clock.running} />
            <div className="text-right">
              <div className="tnum text-lg font-bold leading-tight">{now !== null ? formatClock(now, race.timezone) : '—'}</div>
              <div className="muted text-[11px]">
                Hora de carrera{race.mode === 'demo' && snapshot.clock.rate !== 1 ? ` · simulación ×${snapshot.clock.rate}` : ''}
              </div>
            </div>
          </div>
        </div>

        {/* Indicadores */}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
          <Stat icon={<IconClock className="size-7" />} value={formatDuration(snapshot.race.status === 'live' ? raceElapsed : leaderElapsed)} label="Tiempo de carrera" />
          <Stat icon={<IconRoute className="size-7" />} value={formatKm(leader?.progress ?? null)} label="Distancia del líder" />
          <Stat icon={<IconGauge className="size-7" />} value={avgKmh ? `${avgKmh.toFixed(1)} km/h` : '—'} label="Velocidad media del líder" />
          <Stat icon={<IconUsers className="size-7" />} value={racing} label="Ciclistas en carrera" sub={`${snapshot.rows.length} inscritos`} />
          <div className="panel col-span-2 px-4 py-3 md:col-span-2 xl:col-span-1">
            <div className="flex items-center justify-between text-sm font-semibold">
              <span>Progreso de la carrera</span>
              <span className="tnum">{Math.round(pct)}%</span>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-ink-700" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
              <div className="h-full rounded-full bg-brand-500 transition-all" style={{ width: `${pct}%` }} />
            </div>
            <div className="muted tnum mt-1 text-xs">
              {formatKm(leader?.progress ?? 0)} / {formatKm(total)}
              {race.laps > 1 && ` · ${race.laps} vueltas`}
            </div>
          </div>
        </div>

        {/* Mapa + panel lateral */}
        <div className="grid gap-4 xl:grid-cols-12">
          <RaceMap
            className="h-[55vh] min-h-[340px] xl:col-span-8 xl:h-[600px]"
            route={race.route}
            checkpoints={snapshot.checkpoints}
            rows={filtered}
            selectedId={selectedId}
            onSelect={select}
          />
          <div className="space-y-4 xl:col-span-4">
            {selected ? (
              <SelectedRider r={selected} now={now} slug={race.slug} snapshot={snapshot} />
            ) : (
              <div className="panel muted p-4 text-sm">Selecciona un ciclista en el mapa o en la clasificación para ver sus datos.</div>
            )}
            <div className="panel p-4">
              <h2 className="mb-2 text-sm font-semibold">Puntos de control</h2>
              <ol className="space-y-1.5 text-sm">
                {snapshot.checkpoints.map((c) => {
                  const passed = snapshot.rows.filter((r) => r.progress !== null && r.progress >= c.distanceM && c.kind !== 'start').length;
                  return (
                    <li key={c.id} className="flex items-center gap-2">
                      <span className={`size-2.5 rounded-full ${c.kind === 'start' ? 'bg-green-500' : c.kind === 'finish' ? 'bg-red-500' : 'bg-amber-500'}`} />
                      <span className="flex-1 truncate">{c.name}</span>
                      <span className="muted tnum text-xs">km {(c.distanceM / 1000).toFixed(1)}</span>
                      {c.kind !== 'start' && <span className="muted tnum w-16 text-right text-xs">{passed} pasados</span>}
                    </li>
                  );
                })}
                {snapshot.checkpoints.length === 0 && <li className="muted">Esta carrera no tiene puntos de control: las diferencias pueden no estar disponibles.</li>}
              </ol>
            </div>
            <div className="panel muted space-y-1 p-4 text-xs">
              <p>
                <strong className="text-slate-700 dark:text-slate-200">Diferencias:</strong> medidas en el último punto de control común. «≈» indica una diferencia estimada (cuándo pasó
                el corredor de referencia por la posición actual). «Sin ref.» significa que no hay datos fiables para calcularla.
              </p>
              <p>Velocidad con * = estimada a partir de las dos últimas posiciones.</p>
            </div>
          </div>
        </div>

        {/* Clasificación */}
        <section className="panel overflow-hidden" aria-labelledby="clasif">
          <div className="flex flex-wrap items-end gap-3 border-b border-slate-200 p-3 dark:border-ink-700">
            <h2 id="clasif" className="mr-auto text-lg font-bold">
              Clasificación en vivo
            </h2>
            <div className="relative">
              <IconSearch className="muted pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2" />
              <input className="input w-48 pl-8" placeholder="Dorsal o nombre" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar por dorsal o nombre" />
            </div>
            {detail.categories.length > 0 && (
              <select className="input w-auto" value={cat} onChange={(e) => setCat(e.target.value)} aria-label="Categoría">
                <option value="">Todas las categorías</option>
                {detail.categories.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.name}
                  </option>
                ))}
              </select>
            )}
            <select className="input w-auto" value={team} onChange={(e) => setTeam(e.target.value)} aria-label="Equipo">
              <option value="">Todos los equipos</option>
              {teams.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
            <select className="input w-auto" value={country} onChange={(e) => setCountry(e.target.value)} aria-label="País">
              <option value="">Todos los países</option>
              {countries.map((c) => (
                <option key={c} value={c}>
                  {countryName(c)}
                </option>
              ))}
            </select>
            {(q || cat || team || country) && (
              <button
                className="btn-ghost"
                onClick={() => {
                  setQ('');
                  setCat('');
                  setTeam('');
                  setCountry('');
                }}
              >
                Limpiar
              </button>
            )}
          </div>
          <StandingsTable rows={filtered} now={now} selectedId={selectedId} onSelect={select} raceSlug={race.slug} />
          <div className="muted border-t border-slate-200 px-3 py-2 text-[11px] dark:border-ink-700">
            Actualizado {formatClock(snapshot.generatedAt)} (hora local) · {filtered.length} de {rows.length} participantes
          </div>
        </section>
      </div>
    </PublicLayout>
  );
}
