import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { IconCalendar, IconMapPin, IconRoute, IconUsers } from '../components/icons';
import { PublicLayout } from '../components/Layout';
import { DemoBadge, ErrorBox, RaceStatusBadge, Spinner } from '../components/ui';
import { api } from '../lib/api';
import { formatDate, formatKm } from '../lib/format';
import type { RaceSummary } from '../lib/types';

function RaceCard({ r }: { r: RaceSummary }) {
  return (
    <Link
      to={`/carreras/${r.slug}`}
      className="panel group flex flex-col gap-3 p-5 transition hover:-translate-y-0.5 hover:border-brand-500/60 hover:shadow-lg focus-visible:outline-2 focus-visible:outline-brand-500"
    >
      <div className="flex items-center gap-2">
        <RaceStatusBadge status={r.status} />
        <DemoBadge mode={r.mode} />
      </div>
      <h3 className="text-lg font-bold leading-snug group-hover:text-brand-500">{r.name}</h3>
      <dl className="muted grid gap-1.5 text-sm">
        <div className="flex items-center gap-2">
          <IconCalendar className="size-4 shrink-0" />
          <dt className="sr-only">Fecha</dt>
          <dd>{formatDate(r.startedAt ?? r.scheduledStart, r.timezone)}</dd>
        </div>
        {r.location && (
          <div className="flex items-center gap-2">
            <IconMapPin className="size-4 shrink-0" />
            <dt className="sr-only">Lugar</dt>
            <dd className="truncate">{r.location}</dd>
          </div>
        )}
        <div className="flex items-center gap-4">
          <span className="flex items-center gap-2">
            <IconRoute className="size-4" />
            {r.routeLengthM ? formatKm(r.routeLengthM * r.laps) : 'Recorrido por definir'}
            {r.laps > 1 && ` · ${r.laps} vueltas`}
          </span>
          <span className="flex items-center gap-2">
            <IconUsers className="size-4" />
            {r.participantCount ?? 0}
          </span>
        </div>
      </dl>
      <span className="mt-auto text-sm font-semibold text-brand-600 dark:text-brand-400">
        {r.status === 'live' ? 'Seguir en directo →' : r.status === 'finished' ? 'Ver resultados →' : 'Ver carrera →'}
      </span>
    </Link>
  );
}

function Section({ title, races, empty }: { title: string; races: RaceSummary[]; empty: string }) {
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-500 dark:text-ink-300">{title}</h2>
      {races.length ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{races.map((r) => <RaceCard key={r.id} r={r} />)}</div>
      ) : (
        <p className="muted text-sm">{empty}</p>
      )}
    </section>
  );
}

export function HomePage() {
  const [races, setRaces] = useState<RaceSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const load = () =>
      api<{ races: RaceSummary[] }>('/api/v1/races')
        .then((r) => setRaces(r.races))
        .catch((e) => setError(e.message));
    load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, []);

  return (
    <PublicLayout>
      <div className="bg-gradient-to-b from-brand-500/10 to-transparent">
        <div className="mx-auto max-w-6xl px-4 py-10">
          <h1 className="text-3xl font-black tracking-tight sm:text-4xl">Sigue cada carrera en tiempo real</h1>
          <p className="muted mt-2 max-w-2xl">
            Posición GPS de cada ciclista, clasificación en vivo con diferencias medidas en los puntos de control, velocidad y estado de los
            dispositivos de seguimiento.
          </p>
        </div>
      </div>
      <div className="mx-auto max-w-6xl space-y-10 px-4 pb-12">
        {error && <ErrorBox>No se pudieron cargar las carreras: {error}</ErrorBox>}
        {!races && !error && <Spinner />}
        {races && (
          <>
            <Section title="En directo" races={races.filter((r) => r.status === 'live')} empty="No hay carreras en directo ahora mismo." />
            <Section title="Próximas competiciones" races={races.filter((r) => r.status === 'scheduled')} empty="No hay carreras programadas." />
            <Section title="Finalizadas" races={races.filter((r) => r.status === 'finished')} empty="Todavía no hay carreras finalizadas." />
          </>
        )}
      </div>
    </PublicLayout>
  );
}
