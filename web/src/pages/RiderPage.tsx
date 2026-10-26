import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { LineChart } from '../components/LineChart';
import { PublicLayout } from '../components/Layout';
import { RaceMap } from '../components/RaceMap';
import { elapsedFor } from '../components/StandingsTable';
import { DemoBadge, DemoBanner, ErrorBox, Flag, FreshnessBadge, Spinner, Stat } from '../components/ui';
import { IconClock, IconGauge, IconHeart, IconRoute } from '../components/icons';
import { useLiveRace, useRaceClock } from '../hooks/useLiveRace';
import { api } from '../lib/api';
import { countryName, describeGap, formatAge, formatClock, formatDuration, formatKm, riderColor, STATUS_LABEL } from '../lib/format';
import type { Checkpoint, LiveRow, LiveSnapshot, RaceSummary } from '../lib/types';

interface Profile {
  race: RaceSummary;
  clock: LiveSnapshot['clock'];
  participant: LiveRow;
  splits: { checkpoint: string; lap: number; distanceM: number; passedAt: string; elapsedMs: number | null; source: string }[];
  track: { t: string; lat: number; lon: number; speedKmh: number | null; altM: number | null }[];
  heartRate: { t: string; bpm: number }[] | null;
}

const SOURCE_LABEL: Record<string, string> = { gps: 'GPS (interpolado)', manual: 'Juez (manual)', mat: 'Alfombra' };

export function RiderPage() {
  const { slug, bib } = useParams();
  const [data, setData] = useState<Profile | null>(null);
  const [route, setRoute] = useState<{ route: [number, number][] | null; checkpoints: Checkpoint[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Fila en vivo por Socket.IO; el historial (recorrido, gráficas) se refresca con menos frecuencia.
  const { snapshot, receivedAt } = useLiveRace(slug);
  const liveNow = useRaceClock(snapshot, receivedAt);

  useEffect(() => {
    if (!slug || !bib) return;
    let alive = true;
    const load = () =>
      api<Profile>(`/api/v1/races/${encodeURIComponent(slug)}/participants/${encodeURIComponent(bib)}`)
        .then((d) => alive && setData(d))
        .catch((e) => alive && setError(e.message));
    load();
    api<{ race: { route: [number, number][] | null }; checkpoints: Checkpoint[] }>(`/api/v1/races/${encodeURIComponent(slug)}`).then(
      (d) => alive && setRoute({ route: d.race.route, checkpoints: d.checkpoints }),
    );
    const t = setInterval(load, 15_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [slug, bib]);

  if (error)
    return (
      <PublicLayout>
        <div className="mx-auto max-w-3xl p-6">
          <ErrorBox>{error}</ErrorBox>
        </div>
      </PublicLayout>
    );
  if (!data || !route)
    return (
      <PublicLayout>
        <Spinner />
      </PublicLayout>
    );

  const p = snapshot?.rows.find((r) => r.participantId === data.participant.participantId) ?? data.participant;
  const now = liveNow ?? Date.parse(data.clock.now);
  const start = p.startTime ? Date.parse(p.startTime) : null;
  const xMin = (x: number) => (start !== null ? formatDuration(x - start) : formatClock(x));
  const speed = data.track.filter((t) => t.speedKmh !== null).map((t) => ({ x: Date.parse(t.t), y: t.speedKmh! }));
  const hr = (data.heartRate ?? []).map((h) => ({ x: Date.parse(h.t), y: h.bpm }));
  const avgSpeed = speed.length ? speed.reduce((a, b) => a + b.y, 0) / speed.length : null;
  const maxSpeed = speed.length ? Math.max(...speed.map((s) => s.y)) : null;
  const avgHr = hr.length ? hr.reduce((a, b) => a + b.y, 0) / hr.length : null;
  const gl = describeGap(p.gapLeader);

  return (
    <PublicLayout banner={data.race.mode === 'demo' ? <DemoBanner /> : undefined}>
      <div className="mx-auto max-w-6xl space-y-4 px-3 py-4 sm:px-4">
        <Link to={`/carreras/${data.race.slug}?sel=${p.participantId}`} className="text-sm font-medium text-brand-600 hover:underline dark:text-brand-400">
          ← {data.race.name}
        </Link>
        <div className="panel flex flex-wrap items-center gap-4 p-5">
          <span className="flex size-16 items-center justify-center rounded-full text-2xl font-black text-white" style={{ background: riderColor(p.bib) }}>
            {p.bib}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-black">
                {p.firstName} {p.lastName}
              </h1>
              <Flag code={p.countryCode} className="text-2xl" />
              <DemoBadge mode={data.race.mode} />
            </div>
            <p className="muted">
              {p.team} · {countryName(p.countryCode)}
              {p.categoryCode && ` · ${p.categoryCode}`}
            </p>
          </div>
          <div className="text-right">
            <div className="text-3xl font-black tnum">{p.position ?? '—'}</div>
            <div className="muted text-xs">{STATUS_LABEL[p.status]}</div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat icon={<IconClock className="size-7" />} value={formatDuration(elapsedFor(p, now))} label="Tiempo" sub={<span title={gl.title}>Dif. líder {gl.text}</span>} />
          <Stat icon={<IconRoute className="size-7" />} value={formatKm(p.progress)} label="Distancia recorrida" />
          <Stat
            icon={<IconGauge className="size-7" />}
            value={p.speedKmh !== null ? `${p.speedKmh.toFixed(1)} km/h` : '—'}
            label="Velocidad actual"
            sub={avgSpeed !== null ? `media ${avgSpeed.toFixed(1)} · máx ${maxSpeed!.toFixed(1)}` : undefined}
          />
          <Stat
            icon={<IconHeart className="size-7 text-rose-500" />}
            value={p.hr ? `${p.hr.bpm} ppm` : '—'}
            label="Frecuencia cardíaca"
            sub={p.hrState === 'no_sensor' ? 'Sin sensor' : p.hrState === 'private' ? 'No pública' : avgHr !== null ? `media ${Math.round(avgHr)} ppm` : 'Sin datos recientes'}
          />
        </div>

        <div className="grid gap-4 lg:grid-cols-5">
          <RaceMap
            className="h-[420px] lg:col-span-3"
            route={route.route}
            checkpoints={route.checkpoints}
            rows={[p]}
            selectedId={p.participantId}
            track={{ points: data.track.map((t) => [t.lat, t.lon]), color: riderColor(p.bib) }}
          />
          <div className="panel p-4 lg:col-span-2">
            <h2 className="mb-3 font-semibold">Parciales</h2>
            {data.splits.length ? (
              <table className="w-full text-sm">
                <thead className="muted text-left text-[11px] uppercase">
                  <tr>
                    <th className="py-1">Punto</th>
                    <th className="py-1 text-right">Km</th>
                    <th className="py-1 text-right">Tiempo</th>
                    <th className="py-1 text-right">Hora</th>
                  </tr>
                </thead>
                <tbody>
                  {data.splits.map((s) => (
                    <tr key={`${s.checkpoint}-${s.lap}`} className="border-t border-slate-100 dark:border-ink-800" title={`Fuente: ${SOURCE_LABEL[s.source] ?? s.source}`}>
                      <td className="py-1.5">{s.checkpoint}</td>
                      <td className="tnum py-1.5 text-right">{(s.distanceM / 1000).toFixed(1)}</td>
                      <td className="tnum py-1.5 text-right font-semibold">{formatDuration(s.elapsedMs)}</td>
                      <td className="tnum muted py-1.5 text-right">{formatClock(s.passedAt, data.race.timezone)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="muted text-sm">Todavía no ha pasado por ningún punto de control.</p>
            )}
            <div className="mt-4 space-y-1 border-t border-slate-200 pt-3 text-xs dark:border-ink-700">
              <FreshnessBadge f={p.freshness} />
              <p className="muted">Última posición: {p.lastFixAt ? formatAge(now - Date.parse(p.lastFixAt)) : 'sin datos'}</p>
              <p className="muted">Posiciones registradas: {data.track.length}</p>
            </div>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <div className="panel p-4">
            <h2 className="mb-2 font-semibold">Velocidad</h2>
            <LineChart data={speed} xFormat={xMin} yFormat={(v) => v.toFixed(0)} yLabel="km/h" emptyText="Sin datos de velocidad" />
          </div>
          <div className="panel p-4">
            <h2 className="mb-2 font-semibold">Frecuencia cardíaca</h2>
            <LineChart
              data={hr}
              color="#e11d48"
              xFormat={xMin}
              yLabel="ppm"
              emptyText={p.hrState === 'no_sensor' ? 'Este participante no lleva sensor de frecuencia cardíaca' : p.hrState === 'private' ? 'El participante no ha autorizado publicar su frecuencia cardíaca' : 'Sin datos'}
            />
          </div>
        </div>
      </div>
    </PublicLayout>
  );
}
