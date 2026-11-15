import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { RaceMap } from '../../components/RaceMap';
import { IconDownload } from '../../components/icons';
import { ConfirmDialog, DemoBadge, ErrorBox, Flag, FreshnessBadge, Modal, RaceStatusBadge, Spinner } from '../../components/ui';
import { api, del, errorMessage, patch, post, put } from '../../lib/api';
import { countryName, formatAge, formatClock, formatDuration, formatKm, STATUS_LABEL } from '../../lib/format';
import type { Checkpoint, LiveSnapshot, ParticipantStatus, RaceSummary } from '../../lib/types';
import { useUser } from './AdminApp';
import { RaceForm } from './AdminRaces';

type AdminRace = RaceSummary & { route: [number, number][] | null; allowEstimatedGaps: boolean; updatedAt: string };
interface Detail {
  race: AdminRace;
  checkpoints: (Checkpoint & { raceId: string })[];
  categories: { code: string; name: string }[];
}
interface AdminParticipant {
  id: string;
  bib: number;
  firstName: string;
  lastName: string;
  team: string;
  countryCode: string;
  categoryCode: string | null;
  status: ParticipantStatus;
  startTime: string | null;
  finishedAt: string | null;
  hasHrSensor: boolean;
  publicHr: boolean;
  email: string | null;
  phone: string | null;
  emergencyContact: string | null;
  notes: string | null;
  device: { id: string; serial: string; label: string; isSimulated: boolean } | null;
}

const TABS = [
  ['general', 'General'],
  ['recorrido', 'Recorrido'],
  ['participantes', 'Participantes'],
  ['dispositivos', 'Dispositivos'],
  ['monitor', 'Monitor'],
  ['exportar', 'Exportar'],
] as const;

export function AdminRaceDetail() {
  const { id } = useParams();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') ?? 'general';
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    () =>
      api<Detail>(`/api/v1/admin/races/${id}`)
        .then(setDetail)
        .catch((e) => setError(errorMessage(e))),
    [id],
  );
  useEffect(() => {
    load();
  }, [load]);

  if (error) return <ErrorBox>{error}</ErrorBox>;
  if (!detail) return <Spinner />;
  const race = detail.race;

  return (
    <div className="space-y-4">
      <Link to="/admin" className="text-sm text-brand-600 hover:underline dark:text-brand-400">
        ← Carreras
      </Link>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold">{race.name}</h1>
        <RaceStatusBadge status={race.status} />
        <DemoBadge mode={race.mode} />
        {race.status !== 'draft' && (
          <Link to={`/carreras/${race.slug}`} className="btn-secondary ml-auto" target="_blank">
            Ver página pública ↗
          </Link>
        )}
      </div>
      <div className="flex gap-1 overflow-x-auto border-b border-slate-200 dark:border-ink-700" role="tablist">
        {TABS.map(([k, label]) => (
          <button
            key={k}
            role="tab"
            aria-selected={tab === k}
            onClick={() => setParams({ tab: k }, { replace: true })}
            className={`whitespace-nowrap border-b-2 px-4 py-2 text-sm font-medium ${tab === k ? 'border-brand-500 text-brand-600 dark:text-brand-400' : 'border-transparent muted hover:text-slate-900 dark:hover:text-white'}`}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === 'general' && <GeneralTab detail={detail} reload={load} />}
      {tab === 'recorrido' && <RouteTab detail={detail} reload={load} />}
      {tab === 'participantes' && <ParticipantsTab detail={detail} />}
      {tab === 'dispositivos' && <DevicesTab detail={detail} />}
      {tab === 'monitor' && <MonitorTab detail={detail} />}
      {tab === 'exportar' && <ExportTab detail={detail} />}
    </div>
  );
}

// ---------------------------------------------------------------- General
function GeneralTab({ detail, reload }: { detail: Detail; reload: () => void }) {
  const race = detail.race;
  const user = useUser();
  const navigate = useNavigate();
  const [confirm, setConfirm] = useState<null | 'start' | 'finish' | 'reopen' | 'restart' | 'delete'>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    setConfirm(null);
    try {
      await fn();
      setMsg({ ok: true, text: ok });
      reload();
    } catch (e) {
      setMsg({ ok: false, text: errorMessage(e) });
    }
  };

  return (
    <div className="grid gap-4 xl:grid-cols-3">
      <div className="panel p-5 xl:col-span-2">
        <h2 className="mb-4 font-semibold">Datos de la carrera</h2>
        <RaceForm
          key={race.updatedAt}
          initial={race}
          submitLabel="Guardar cambios"
          onSubmit={async (b) => {
            await patch(`/api/v1/admin/races/${race.id}`, b);
            setMsg({ ok: true, text: 'Cambios guardados' });
            reload();
          }}
        />
      </div>
      <div className="space-y-4">
        {msg && (msg.ok ? <div className="rounded-lg bg-live/15 px-4 py-2 text-sm text-green-800 dark:text-green-200">{msg.text}</div> : <ErrorBox>{msg.text}</ErrorBox>)}
        {race.mode === 'demo' ? (
          <DemoControls raceId={race.id} onChange={reload} />
        ) : (
          <div className="panel space-y-3 p-5">
            <h2 className="font-semibold">Cronometraje</h2>
            <dl className="grid grid-cols-2 gap-1 text-sm">
              <dt className="muted">Salida</dt>
              <dd className="text-right">{race.startedAt ? formatClock(race.startedAt, race.timezone) : '—'}</dd>
              <dt className="muted">Cierre</dt>
              <dd className="text-right">{race.finishedAt ? formatClock(race.finishedAt, race.timezone) : '—'}</dd>
            </dl>
            {(race.status === 'draft' || race.status === 'scheduled') && (
              <button className="btn-primary w-full" onClick={() => setConfirm('start')} disabled={!race.route}>
                Dar la salida
              </button>
            )}
            {!race.route && <p className="muted text-xs">Define el recorrido antes de iniciar.</p>}
            {race.status === 'live' && (
              <button className="btn-danger w-full" onClick={() => setConfirm('finish')}>
                Finalizar carrera y publicar resultados
              </button>
            )}
            {race.status === 'finished' && user.role === 'admin' && (
              <button className="btn-secondary w-full" onClick={() => setConfirm('reopen')}>
                Reabrir carrera
              </button>
            )}
            {(race.status === 'live' || (race.status === 'finished' && user.role === 'admin')) && (
              <button className="btn-secondary w-full" onClick={() => setConfirm('restart')}>
                Reiniciar salida (cronómetro a 0)
              </button>
            )}
          </div>
        )}
        <div className="panel space-y-2 p-5">
          <h2 className="font-semibold text-red-600 dark:text-red-400">Zona de peligro</h2>
          <p className="muted text-xs">Borrar la carrera elimina participantes, posiciones, pasos y resultados de forma permanente.</p>
          <button className="btn-danger w-full" onClick={() => setConfirm('delete')}>
            Borrar carrera
          </button>
        </div>
      </div>

      <ConfirmDialog
        open={confirm === 'start'}
        title="Dar la salida"
        danger={false}
        confirmLabel="Iniciar ahora"
        message="El cronómetro empieza en 0 en este instante, aunque la carrera estuviera programada para otra hora. Los participantes inscritos pasarán a «en carrera»."
        onCancel={() => setConfirm(null)}
        onConfirm={() => act(() => post(`/api/v1/admin/races/${race.id}/start`), 'Carrera iniciada')}
      />
      <ConfirmDialog
        open={confirm === 'finish'}
        title="Finalizar carrera"
        confirmLabel="Finalizar y publicar"
        requireText="FINALIZAR"
        message={
          <>
            Se publicarán los resultados oficiales. Los participantes que no hayan llegado a meta se marcarán como <strong>abandono (DNF)</strong> y
            dejará de aceptarse telemetría.
          </>
        }
        onCancel={() => setConfirm(null)}
        onConfirm={() => act(() => post(`/api/v1/admin/races/${race.id}/finish`), 'Carrera finalizada')}
      />
      <ConfirmDialog
        open={confirm === 'reopen'}
        title="Reabrir carrera"
        confirmLabel="Reabrir"
        message="Se retirarán los resultados publicados. La acción queda registrada en la auditoría."
        onCancel={() => setConfirm(null)}
        onConfirm={() => act(() => post(`/api/v1/admin/races/${race.id}/reopen`), 'Carrera reabierta')}
      />
      <ConfirmDialog
        open={confirm === 'restart'}
        title="Reiniciar salida"
        confirmLabel="Reiniciar ahora"
        requireText="REINICIAR"
        message={
          <>
            El cronómetro de todos los participantes vuelve a <strong>0 en este instante</strong>, sin importar la hora programada ni la
            salida anterior. Se borran los pasos por puntos de control y los resultados; quienes estaban en meta o retirados vuelven a
            «en carrera». Las posiciones GPS anteriores se conservan como historial, pero no cuentan para el nuevo tiempo.
          </>
        }
        onCancel={() => setConfirm(null)}
        onConfirm={() => act(() => post(`/api/v1/admin/races/${race.id}/restart`), 'Salida reiniciada: el cronómetro empieza en 0')}
      />
      <ConfirmDialog
        open={confirm === 'delete'}
        title="Borrar carrera"
        confirmLabel="Borrar definitivamente"
        requireText={race.name}
        message="Esta acción no se puede deshacer."
        onCancel={() => setConfirm(null)}
        onConfirm={() =>
          act(async () => {
            await del(`/api/v1/admin/races/${race.id}`);
            navigate('/admin');
          }, 'Carrera borrada')
        }
      />
    </div>
  );
}

function DemoControls({ raceId, onChange }: { raceId: string; onChange: () => void }) {
  const [st, setSt] = useState<{ raceId: string | null; state: string; speed: number; simTime: string | null; autoLoop: boolean } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const refresh = useCallback(() => api<typeof st>('/api/v1/admin/demo/status').then(setSt), []);
  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 2000);
    return () => clearInterval(t);
  }, [refresh]);
  const run = async (path: string, body?: unknown) => {
    setErr(null);
    try {
      setSt(await post(`/api/v1/admin/demo/${path}`, body ?? { raceId }));
      onChange();
    } catch (e) {
      setErr(errorMessage(e));
    }
  };
  const mine = st?.raceId === raceId;
  const label: Record<string, string> = { idle: 'Preparada', running: 'En marcha', paused: 'En pausa', finished: 'Terminada' };
  return (
    <div className="panel space-y-3 border-amber-400/50 p-5">
      <div className="flex items-center gap-2">
        <h2 className="font-semibold">Simulador DEMO</h2>
        <DemoBadge mode="demo" />
      </div>
      <p className="muted text-xs">
        Genera telemetría ficticia para los dispositivos virtuales de esta carrera, con el mismo flujo de validación que un dispositivo real. Los datos
        quedan marcados como simulados y nunca pueden entrar en una carrera oficial.
      </p>
      {err && <ErrorBox>{err}</ErrorBox>}
      {st && (
        <dl className="grid grid-cols-2 gap-1 text-sm">
          <dt className="muted">Estado</dt>
          <dd className="text-right font-semibold">{mine ? label[st.state] : 'Inactivo'}</dd>
          <dt className="muted">Reloj simulado</dt>
          <dd className="tnum text-right">{mine && st.simTime ? formatClock(st.simTime) : '—'}</dd>
        </dl>
      )}
      <div className="flex flex-wrap gap-2">
        <button className="btn-primary" onClick={() => run('start')}>
          {mine && st?.state !== 'idle' ? 'Reiniciar simulación' : 'Iniciar simulación'}
        </button>
        {mine && st?.state === 'running' && (
          <button className="btn-secondary" onClick={() => run('pause', {})}>
            Pausar
          </button>
        )}
        {mine && st?.state === 'paused' && (
          <button className="btn-secondary" onClick={() => run('resume', {})}>
            Reanudar
          </button>
        )}
        <button className="btn-secondary" onClick={() => setConfirmReset(true)}>
          Borrar datos
        </button>
      </div>
      <div className="flex items-center gap-2">
        <label className="label mb-0" htmlFor="speed">
          Velocidad
        </label>
        <select id="speed" className="input w-auto" value={st?.speed ?? 10} onChange={(e) => run('speed', { speed: Number(e.target.value) })}>
          {[1, 2, 5, 10, 20, 30, 60].map((s) => (
            <option key={s} value={s}>
              ×{s}
            </option>
          ))}
        </select>
        <label className="ml-auto flex items-center gap-2 text-sm">
          <input type="checkbox" checked={st?.autoLoop ?? false} onChange={(e) => run('loop', { enabled: e.target.checked })} /> Repetir
        </label>
      </div>
      <ConfirmDialog
        open={confirmReset}
        title="Borrar datos simulados"
        confirmLabel="Borrar"
        message="Se eliminarán todas las posiciones, pasos y frecuencias simuladas de esta carrera DEMO."
        onCancel={() => setConfirmReset(false)}
        onConfirm={() => {
          setConfirmReset(false);
          run('reset');
        }}
      />
    </div>
  );
}

// -------------------------------------------------------------- Recorrido
function RouteTab({ detail, reload }: { detail: Detail; reload: () => void }) {
  const race = detail.race;
  const [err, setErr] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [cpName, setCpName] = useState('');
  const [cpKm, setCpKm] = useState('');
  const [cpToDelete, setCpToDelete] = useState<Checkpoint | null>(null);
  const [cats, setCats] = useState(detail.categories.map((c) => `${c.code}=${c.name}`).join('\n'));
  const locked = race.status === 'live';

  const uploadGpx = async (file: File) => {
    setErr(null);
    try {
      const gpx = await file.text();
      const r = await put<{ lengthM: number; points: number; isLoop: boolean }>(`/api/v1/admin/races/${race.id}/route`, { gpx });
      setInfo(`Recorrido cargado: ${r.points} puntos, ${formatKm(r.lengthM, 2)}${r.isLoop ? ' (circuito cerrado)' : ''}`);
      reload();
    } catch (e) {
      setErr(errorMessage(e));
    }
  };

  const addCp = async (e: FormEvent) => {
    e.preventDefault();
    setErr(null);
    try {
      await post(`/api/v1/admin/races/${race.id}/checkpoints`, { name: cpName, kind: 'split', distanceM: Math.round(Number(cpKm.replace(',', '.')) * 1000) });
      setCpName('');
      setCpKm('');
      reload();
    } catch (e2) {
      setErr(errorMessage(e2));
    }
  };

  const saveCats = async () => {
    setErr(null);
    try {
      const list = cats
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean)
        .map((l) => {
          const [code, ...rest] = l.split('=');
          return { code: code.trim(), name: (rest.join('=') || code).trim() };
        });
      await put(`/api/v1/admin/races/${race.id}/categories`, list);
      setInfo('Categorías guardadas');
      reload();
    } catch (e) {
      setErr(errorMessage(e));
    }
  };

  return (
    <div className="grid gap-4 xl:grid-cols-5">
      <div className="space-y-4 xl:col-span-3">
        <RaceMap className="h-[460px]" route={race.route} checkpoints={detail.checkpoints} rows={[]} />
        {err && <ErrorBox>{err}</ErrorBox>}
        {info && <div className="rounded-lg bg-live/15 px-4 py-2 text-sm text-green-800 dark:text-green-200">{info}</div>}
      </div>
      <div className="space-y-4 xl:col-span-2">
        <div className="panel space-y-2 p-5">
          <h2 className="font-semibold">Trazado</h2>
          <p className="muted text-sm">
            {race.routeLengthM ? `Longitud por vuelta: ${formatKm(race.routeLengthM, 2)} · ${race.laps} vuelta(s) · total ${formatKm(race.routeLengthM * race.laps, 2)}` : 'Sin recorrido definido.'}
          </p>
          <label className={`btn-secondary w-full ${locked ? 'pointer-events-none opacity-50' : 'cursor-pointer'}`}>
            Cargar archivo GPX
            <input type="file" accept=".gpx,application/gpx+xml" className="sr-only" disabled={locked} onChange={(e) => e.target.files?.[0] && uploadGpx(e.target.files[0])} />
          </label>
          <p className="muted text-xs">Se crean automáticamente la salida y la meta en los extremos. Para circuitos, el trazado de una vuelta debe terminar donde empieza.</p>
        </div>
        <div className="panel p-5">
          <h2 className="mb-2 font-semibold">Puntos de control</h2>
          <ul className="divide-y divide-slate-100 text-sm dark:divide-ink-800">
            {detail.checkpoints.map((c) => (
              <li key={c.id} className="flex items-center gap-2 py-2">
                <span className={`size-2.5 rounded-full ${c.kind === 'start' ? 'bg-green-500' : c.kind === 'finish' ? 'bg-red-500' : 'bg-amber-500'}`} />
                <span className="flex-1">{c.name}</span>
                <span className="tnum muted">km {(c.distanceM / 1000).toFixed(2)}</span>
                {c.kind === 'split' && (
                  <button className="btn-ghost px-2 py-1 text-xs text-red-600" onClick={() => setCpToDelete(c)} aria-label={`Borrar ${c.name}`}>
                    Borrar
                  </button>
                )}
              </li>
            ))}
          </ul>
          {race.route && (
            <form onSubmit={addCp} className="mt-3 flex gap-2">
              <input className="input" placeholder="Nombre" required value={cpName} onChange={(e) => setCpName(e.target.value)} aria-label="Nombre del punto" />
              <input className="input w-24" placeholder="Km" required inputMode="decimal" pattern="[0-9]+([.,][0-9]+)?" value={cpKm} onChange={(e) => setCpKm(e.target.value)} aria-label="Kilómetro" />
              <button className="btn-primary">Añadir</button>
            </form>
          )}
        </div>
        <div className="panel space-y-2 p-5">
          <h2 className="font-semibold">Categorías</h2>
          <textarea className="input min-h-24 font-mono text-xs" value={cats} onChange={(e) => setCats(e.target.value)} aria-label="Categorías, una por línea: CODIGO=Nombre" />
          <p className="muted text-xs">Una por línea con el formato CÓDIGO=Nombre (por ejemplo ELITE=Élite).</p>
          <button className="btn-secondary" onClick={saveCats}>
            Guardar categorías
          </button>
        </div>
      </div>
      <ConfirmDialog
        open={!!cpToDelete}
        title="Borrar punto de control"
        message={`Se borrará «${cpToDelete?.name}» y todos los pasos registrados en él.`}
        confirmLabel="Borrar"
        onCancel={() => setCpToDelete(null)}
        onConfirm={async () => {
          const c = cpToDelete!;
          setCpToDelete(null);
          try {
            await del(`/api/v1/admin/races/${race.id}/checkpoints/${c.id}`);
            reload();
          } catch (e) {
            setErr(errorMessage(e));
          }
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------- Participantes
function ParticipantForm({ initial, categories, onSubmit }: { initial?: AdminParticipant; categories: Detail['categories']; onSubmit: (b: Record<string, unknown>) => Promise<void> }) {
  const [f, setF] = useState({
    bib: initial?.bib ?? '',
    firstName: initial?.firstName ?? '',
    lastName: initial?.lastName ?? '',
    team: initial?.team ?? '',
    countryCode: initial?.countryCode ?? '',
    categoryCode: initial?.categoryCode ?? '',
    hasHrSensor: initial?.hasHrSensor ?? false,
    publicHr: initial?.publicHr ?? false,
    email: initial?.email ?? '',
    phone: initial?.phone ?? '',
    emergencyContact: initial?.emergencyContact ?? '',
  });
  const [err, setErr] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: { target: { value: string; checked?: boolean; type?: string } }) =>
    setF((x) => ({ ...x, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setErr(null);
    try {
      await onSubmit({ ...f, bib: Number(f.bib), categoryCode: f.categoryCode || null, countryCode: f.countryCode.toUpperCase() });
    } catch (e2) {
      setErr(errorMessage(e2));
    }
  };
  return (
    <form onSubmit={submit} className="space-y-3">
      {err && <ErrorBox>{err}</ErrorBox>}
      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <label className="label">Dorsal</label>
          <input className="input" type="number" min={1} required value={f.bib} onChange={set('bib')} />
        </div>
        <div>
          <label className="label">Nombre</label>
          <input className="input" required value={f.firstName} onChange={set('firstName')} />
        </div>
        <div>
          <label className="label">Apellidos</label>
          <input className="input" required value={f.lastName} onChange={set('lastName')} />
        </div>
        <div>
          <label className="label">País (ISO, p. ej. DO)</label>
          <div className="flex items-center gap-2">
            <input className="input uppercase" required maxLength={3} value={f.countryCode} onChange={set('countryCode')} />
            {/^[A-Za-z]{2}$/.test(f.countryCode) && <Flag code={f.countryCode} className="text-xl" />}
          </div>
        </div>
        <div>
          <label className="label">Equipo</label>
          <input className="input" value={f.team} onChange={set('team')} />
        </div>
        <div>
          <label className="label">Categoría</label>
          <select className="input" value={f.categoryCode} onChange={set('categoryCode')}>
            <option value="">—</option>
            {categories.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
      </div>
      <fieldset className="rounded-lg border border-slate-200 p-3 dark:border-ink-700">
        <legend className="label px-1">Datos privados (no se publican)</legend>
        <div className="grid gap-3 sm:grid-cols-3">
          <input className="input" type="email" placeholder="Email" value={f.email} onChange={set('email')} />
          <input className="input" placeholder="Teléfono" value={f.phone} onChange={set('phone')} />
          <input className="input" placeholder="Contacto de emergencia" value={f.emergencyContact} onChange={set('emergencyContact')} />
        </div>
      </fieldset>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={f.hasHrSensor} onChange={set('hasHrSensor')} /> Lleva sensor de frecuencia cardíaca
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={f.publicHr} onChange={set('publicHr')} disabled={!f.hasHrSensor} /> Consiente publicar su frecuencia cardíaca
      </label>
      <div className="flex justify-end">
        <button className="btn-primary">Guardar</button>
      </div>
    </form>
  );
}

function ParticipantsTab({ detail }: { detail: Detail }) {
  const race = detail.race;
  const [list, setList] = useState<AdminParticipant[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [editing, setEditing] = useState<AdminParticipant | 'new' | null>(null);
  const [importing, setImporting] = useState(false);
  const [toDelete, setToDelete] = useState<AdminParticipant | null>(null);
  const [passing, setPassing] = useState<AdminParticipant | null>(null);
  const load = useCallback(
    () =>
      api<{ participants: AdminParticipant[] }>(`/api/v1/admin/races/${race.id}/participants`)
        .then((r) => setList(r.participants))
        .catch((e) => setErr(errorMessage(e))),
    [race.id],
  );
  useEffect(() => {
    load();
  }, [load]);

  const setStatus = async (p: AdminParticipant, status: string) => {
    try {
      await patch(`/api/v1/admin/participants/${p.id}`, { status });
      load();
    } catch (e) {
      setErr(errorMessage(e));
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <button className="btn-primary" onClick={() => setEditing('new')}>
          + Participante
        </button>
        <button className="btn-secondary" onClick={() => setImporting(true)}>
          Importar CSV
        </button>
      </div>
      {err && <ErrorBox>{err}</ErrorBox>}
      {!list ? (
        <Spinner />
      ) : (
        <div className="panel overflow-x-auto">
          <table className="w-full min-w-[900px] text-sm">
            <thead className="muted text-left text-[11px] uppercase">
              <tr className="border-b border-slate-200 dark:border-ink-700">
                <th className="px-3 py-2">Dorsal</th>
                <th className="px-3 py-2">Nombre</th>
                <th className="px-3 py-2">País</th>
                <th className="px-3 py-2">Equipo</th>
                <th className="px-3 py-2">Cat.</th>
                <th className="px-3 py-2">FC</th>
                <th className="px-3 py-2">Dispositivo</th>
                <th className="px-3 py-2">Estado</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {list.map((p) => (
                <tr key={p.id} className="border-b border-slate-100 dark:border-ink-800">
                  <td className="tnum px-3 py-2 font-semibold">{p.bib}</td>
                  <td className="px-3 py-2">
                    {p.firstName} {p.lastName}
                    {p.email && <div className="muted text-xs">{p.email}</div>}
                  </td>
                  <td className="px-3 py-2">
                    <span className="flex items-center gap-2">
                      <Flag code={p.countryCode} /> <span className="muted text-xs">{countryName(p.countryCode)}</span>
                    </span>
                  </td>
                  <td className="muted px-3 py-2 text-xs">{p.team}</td>
                  <td className="px-3 py-2 text-xs">{p.categoryCode ?? '—'}</td>
                  <td className="px-3 py-2 text-xs">{p.hasHrSensor ? (p.publicHr ? 'Sensor · pública' : 'Sensor · privada') : '—'}</td>
                  <td className="px-3 py-2 font-mono text-xs">{p.device?.serial ?? <span className="muted font-sans">Sin asignar</span>}</td>
                  <td className="px-3 py-2">
                    <select className="input w-auto py-1 text-xs" value={p.status} onChange={(e) => setStatus(p, e.target.value)} aria-label={`Estado de ${p.bib}`}>
                      {(['registered', 'dns', 'racing', 'finished', 'dnf', 'dsq'] as ParticipantStatus[]).map((s) => (
                        <option key={s} value={s} disabled={s === 'finished' && !p.finishedAt}>
                          {STATUS_LABEL[s]}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right">
                    {race.startedAt && (
                      <button className="btn-ghost px-2 py-1 text-xs" onClick={() => setPassing(p)}>
                        Paso manual
                      </button>
                    )}
                    <button className="btn-ghost px-2 py-1 text-xs" onClick={() => setEditing(p)}>
                      Editar
                    </button>
                    <button className="btn-ghost px-2 py-1 text-xs text-red-600" onClick={() => setToDelete(p)}>
                      Borrar
                    </button>
                  </td>
                </tr>
              ))}
              {list.length === 0 && (
                <tr>
                  <td colSpan={9} className="muted px-4 py-8 text-center">
                    Sin participantes. Añádelos uno a uno o importa un CSV.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <Modal open={editing !== null} onClose={() => setEditing(null)} title={editing === 'new' ? 'Nuevo participante' : 'Editar participante'} wide>
        {editing !== null && (
          <ParticipantForm
            initial={editing === 'new' ? undefined : editing}
            categories={detail.categories}
            onSubmit={async (b) => {
              if (editing === 'new') await post(`/api/v1/admin/races/${race.id}/participants`, b);
              else await patch(`/api/v1/admin/participants/${editing.id}`, b);
              setEditing(null);
              load();
            }}
          />
        )}
      </Modal>
      <ImportModal open={importing} raceId={race.id} onClose={() => setImporting(false)} onDone={load} />
      <PassingModal p={passing} detail={detail} onClose={() => setPassing(null)} />
      <ConfirmDialog
        open={!!toDelete}
        title="Borrar participante"
        message={`Se borrará el dorsal ${toDelete?.bib} (${toDelete?.firstName} ${toDelete?.lastName}) y toda su telemetría.`}
        confirmLabel="Borrar"
        onCancel={() => setToDelete(null)}
        onConfirm={async () => {
          const p = toDelete!;
          setToDelete(null);
          try {
            await del(`/api/v1/admin/participants/${p.id}`);
            load();
          } catch (e) {
            setErr(errorMessage(e));
          }
        }}
      />
    </div>
  );
}

function ImportModal({ open, raceId, onClose, onDone }: { open: boolean; raceId: string; onClose: () => void; onDone: () => void }) {
  const [csv, setCsv] = useState('');
  const [res, setRes] = useState<{ total: number; valid: number; errors: { line: number; message: string }[]; imported: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const run = async (dryRun: boolean) => {
    setErr(null);
    try {
      const r = await post<NonNullable<typeof res>>(`/api/v1/admin/races/${raceId}/participants/import`, { csv, dryRun });
      setRes(r);
      if (!dryRun && r.imported) onDone();
    } catch (e) {
      setErr(errorMessage(e));
    }
  };
  return (
    <Modal
      open={open}
      onClose={() => {
        setRes(null);
        setCsv('');
        onClose();
      }}
      title="Importar participantes (CSV)"
      wide
    >
      <div className="space-y-3 text-sm">
        <p className="muted">
          Columnas obligatorias: <code>dorsal, nombre, apellidos, pais</code>. Opcionales: <code>equipo, categoria, email, telefono, sensor_fc, fc_publica</code> (sí/no). Se
          admite coma o punto y coma. Los dorsales existentes se actualizan.
        </p>
        <input
          type="file"
          accept=".csv,text/csv"
          className="block text-sm"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (f) {
              setCsv(await f.text());
              setRes(null);
            }
          }}
        />
        <textarea className="input min-h-32 font-mono text-xs" value={csv} onChange={(e) => setCsv(e.target.value)} placeholder={'dorsal;nombre;apellidos;equipo;pais\n1;Ana;Pérez;Club Ciclista;DO'} />
        {err && <ErrorBox>{err}</ErrorBox>}
        {res && (
          <div className={`rounded-lg px-3 py-2 ${res.errors.length ? 'bg-red-500/10' : 'bg-live/15'}`}>
            {res.total} filas · {res.valid} válidas · {res.errors.length} con errores{res.imported ? ` · ${res.imported} importadas` : ''}
            {res.errors.length > 0 && (
              <ul className="mt-2 max-h-40 list-disc overflow-auto pl-5 text-xs">
                {res.errors.map((e) => (
                  <li key={e.line}>
                    Línea {e.line}: {e.message}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        <div className="flex justify-end gap-2">
          <button className="btn-secondary" disabled={!csv} onClick={() => run(true)}>
            Validar
          </button>
          <button className="btn-primary" disabled={!csv || !res || res.errors.length > 0 || res.imported > 0} onClick={() => run(false)}>
            Importar
          </button>
        </div>
      </div>
    </Modal>
  );
}

function PassingModal({ p, detail, onClose }: { p: AdminParticipant | null; detail: Detail; onClose: () => void }) {
  const [cp, setCp] = useState('');
  const [lap, setLap] = useState(1);
  const [time, setTime] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setErr(null);
    try {
      await post(`/api/v1/admin/participants/${p!.id}/passings`, { checkpointId: cp, lap, passedAt: new Date(time).toISOString() });
      setOk(true);
    } catch (e2) {
      setErr(errorMessage(e2));
    }
  };
  return (
    <Modal open={!!p} onClose={() => (setOk(false), onClose())} title={`Paso manual · dorsal ${p?.bib ?? ''}`}>
      <form onSubmit={submit} className="space-y-3 text-sm">
        <p className="muted">Un paso manual (juez) prevalece sobre el calculado por GPS. Registrar el paso por meta da la llegada al participante.</p>
        {err && <ErrorBox>{err}</ErrorBox>}
        {ok && <div className="rounded-lg bg-live/15 px-3 py-2">Paso registrado.</div>}
        <select className="input" required value={cp} onChange={(e) => setCp(e.target.value)}>
          <option value="">Punto de control…</option>
          {detail.checkpoints
            .filter((c) => c.kind !== 'start')
            .map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} (km {(c.distanceM / 1000).toFixed(1)})
              </option>
            ))}
        </select>
        {detail.race.laps > 1 && <input className="input" type="number" min={1} max={detail.race.laps} value={lap} onChange={(e) => setLap(Number(e.target.value))} aria-label="Vuelta" />}
        <input className="input" type="datetime-local" step={1} required value={time} onChange={(e) => setTime(e.target.value)} aria-label="Hora de paso" />
        <div className="flex justify-end">
          <button className="btn-primary">Registrar</button>
        </div>
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------- Dispositivos
interface DeviceRow {
  id: string;
  serial: string;
  label: string;
  isSimulated: boolean;
  active: boolean;
  assignment: { raceId: string; participantId: string; bib: number; raceName: string } | null;
}

function DevicesTab({ detail }: { detail: Detail }) {
  const race = detail.race;
  const [participants, setParticipants] = useState<AdminParticipant[] | null>(null);
  const [devices, setDevices] = useState<DeviceRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      const [p, d] = await Promise.all([
        api<{ participants: AdminParticipant[] }>(`/api/v1/admin/races/${race.id}/participants`),
        api<{ devices: DeviceRow[] }>('/api/v1/admin/devices'),
      ]);
      setParticipants(p.participants);
      setDevices(d.devices);
    } catch (e) {
      setErr(errorMessage(e));
    }
  }, [race.id]);
  useEffect(() => {
    load();
  }, [load]);

  const assign = async (p: AdminParticipant, deviceId: string) => {
    setErr(null);
    try {
      if (!deviceId && p.device) await post(`/api/v1/admin/devices/${p.device.id}/unassign`);
      else if (deviceId) await post(`/api/v1/admin/devices/${deviceId}/assign`, { participantId: p.id });
      load();
    } catch (e) {
      setErr(errorMessage(e));
    }
  };

  if (!participants || !devices) return err ? <ErrorBox>{err}</ErrorBox> : <Spinner />;
  const usable = devices.filter((d) => d.active && (race.mode === 'demo' || !d.isSimulated));
  return (
    <div className="space-y-3">
      <p className="muted text-sm">
        Asocia un dispositivo de telemetría a cada participante. Un dispositivo solo puede estar asignado a un participante a la vez; al reasignarlo se libera
        el anterior. Registra dispositivos nuevos en <Link to="/admin/dispositivos" className="text-brand-600 underline dark:text-brand-400">Dispositivos</Link>.
      </p>
      {err && <ErrorBox>{err}</ErrorBox>}
      <div className="panel overflow-x-auto">
        <table className="w-full min-w-[600px] text-sm">
          <thead className="muted text-left text-[11px] uppercase">
            <tr className="border-b border-slate-200 dark:border-ink-700">
              <th className="px-3 py-2">Dorsal</th>
              <th className="px-3 py-2">Participante</th>
              <th className="px-3 py-2">Dispositivo</th>
            </tr>
          </thead>
          <tbody>
            {participants.map((p) => (
              <tr key={p.id} className="border-b border-slate-100 dark:border-ink-800">
                <td className="tnum px-3 py-2 font-semibold">{p.bib}</td>
                <td className="px-3 py-2">
                  {p.firstName} {p.lastName}
                </td>
                <td className="px-3 py-2">
                  <select className="input max-w-sm py-1" value={p.device?.id ?? ''} onChange={(e) => assign(p, e.target.value)} aria-label={`Dispositivo del dorsal ${p.bib}`}>
                    <option value="">Sin dispositivo</option>
                    {usable.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.serial}
                        {d.label && d.label !== d.serial ? ` · ${d.label}` : ''}
                        {d.assignment && d.assignment.participantId !== p.id ? ` (en uso: dorsal ${d.assignment.bib}${d.assignment.raceId !== race.id ? `, ${d.assignment.raceName}` : ''})` : ''}
                      </option>
                    ))}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// --------------------------------------------------------------- Monitor
function MonitorTab({ detail }: { detail: Detail }) {
  const race = detail.race;
  const [snap, setSnap] = useState<LiveSnapshot | null>(null);
  const [stats, setStats] = useState<{ totals: { positions: number; late: number; hr: number }; participants: { bib: number; positions: number; late: number; hr_samples: number }[] } | null>(null);
  const [flagged, setFlagged] = useState<{ id: number; bib: number; serial: string; recorded_at: string; received_at: string; flags: string[] }[]>([]);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const [s, st, f] = await Promise.all([
          api<LiveSnapshot>(`/api/v1/admin/races/${race.id}/live`),
          api<NonNullable<typeof stats>>(`/api/v1/admin/races/${race.id}/stats`),
          api<{ positions: typeof flagged }>(`/api/v1/admin/races/${race.id}/positions?flagged=true&limit=30`),
        ]);
        if (!alive) return;
        setSnap(s);
        setStats(st);
        setFlagged(f.positions);
      } catch (e) {
        if (alive) setErr(errorMessage(e));
      }
    };
    load();
    const t = setInterval(load, 3000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [race.id]);

  if (!snap) return err ? <ErrorBox>{err}</ErrorBox> : <Spinner />;
  const now = Date.parse(snap.clock.now);
  const byBib = new Map(stats?.participants.map((p) => [p.bib, p]) ?? []);
  const counts = snap.rows.reduce<Record<string, number>>((a, r) => ((a[r.freshness] = (a[r.freshness] ?? 0) + 1), a), {});
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {(['live', 'delayed', 'stale', 'lost', 'none'] as const).map((f) => (
          <div key={f} className="panel p-3">
            <FreshnessBadge f={f} />
            <div className="tnum mt-1 text-2xl font-bold">{counts[f] ?? 0}</div>
          </div>
        ))}
      </div>
      {stats && (
        <p className="muted text-sm">
          {stats.totals.positions.toLocaleString('es')} posiciones · {stats.totals.late.toLocaleString('es')} recibidas con retraso · {stats.totals.hr.toLocaleString('es')} muestras de FC ·
          reloj de carrera {formatClock(now, race.timezone)}
        </p>
      )}
      <div className="panel overflow-x-auto">
        <table className="w-full min-w-[960px] text-sm">
          <thead className="muted text-left text-[11px] uppercase">
            <tr className="border-b border-slate-200 dark:border-ink-700">
              <th className="px-3 py-2">Pos</th>
              <th className="px-3 py-2">Dorsal</th>
              <th className="px-3 py-2">Participante</th>
              <th className="px-3 py-2">Dispositivo</th>
              <th className="px-3 py-2">Conexión</th>
              <th className="px-3 py-2">Último contacto</th>
              <th className="px-3 py-2 text-right">Batería</th>
              <th className="px-3 py-2 text-right">Señal</th>
              <th className="px-3 py-2 text-right">Posiciones</th>
              <th className="px-3 py-2 text-right">Con retraso</th>
              <th className="px-3 py-2 text-right">FC</th>
              <th className="px-3 py-2 text-right">Tiempo</th>
            </tr>
          </thead>
          <tbody>
            {snap.rows.map((r) => {
              const st = byBib.get(r.bib);
              return (
                <tr key={r.participantId} className="border-b border-slate-100 dark:border-ink-800">
                  <td className="tnum px-3 py-2">{r.position ?? '—'}</td>
                  <td className="tnum px-3 py-2 font-semibold">{r.bib}</td>
                  <td className="px-3 py-2">
                    {r.firstName} {r.lastName}
                    <div className="muted text-xs">{STATUS_LABEL[r.status]}</div>
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">{r.device?.serial ?? <span className="muted font-sans">—</span>}</td>
                  <td className="px-3 py-2">
                    <FreshnessBadge f={r.freshness} />
                  </td>
                  <td className="px-3 py-2 text-xs">{r.device?.lastSeenAt ? formatAge(now - Date.parse(r.device.lastSeenAt)) : '—'}</td>
                  <td className={`tnum px-3 py-2 text-right ${r.device?.battery != null && r.device.battery < 15 ? 'font-semibold text-red-600' : ''}`}>
                    {r.device?.battery != null ? `${Math.round(r.device.battery)}%` : '—'}
                  </td>
                  <td className="tnum px-3 py-2 text-right text-xs">{r.device?.rssi != null ? `${r.device.network ?? ''} ${r.device.rssi} dBm` : '—'}</td>
                  <td className="tnum px-3 py-2 text-right">{st?.positions ?? 0}</td>
                  <td className="tnum px-3 py-2 text-right">{st?.late ?? 0}</td>
                  <td className="tnum px-3 py-2 text-right">{r.hr ? `${r.hr.bpm}` : '—'}</td>
                  <td className="tnum px-3 py-2 text-right">{formatDuration(r.elapsedMs)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="panel p-4">
        <h2 className="mb-2 font-semibold">Posiciones con incidencias (últimas 30)</h2>
        {flagged.length ? (
          <table className="w-full text-xs">
            <thead className="muted text-left uppercase">
              <tr>
                <th className="py-1">Dorsal</th>
                <th className="py-1">Dispositivo</th>
                <th className="py-1">Medida (UTC)</th>
                <th className="py-1">Recibida (UTC)</th>
                <th className="py-1">Marcas</th>
              </tr>
            </thead>
            <tbody>
              {flagged.map((f) => (
                <tr key={f.id} className="border-t border-slate-100 dark:border-ink-800">
                  <td className="py-1">{f.bib}</td>
                  <td className="py-1 font-mono">{f.serial}</td>
                  <td className="tnum py-1">{new Date(f.recorded_at).toISOString().slice(11, 19)}</td>
                  <td className="tnum py-1">{new Date(f.received_at).toISOString().slice(11, 19)}</td>
                  <td className="py-1">{f.flags.map((x) => ({ late: 'atrasada' } as Record<string, string>)[x] ?? x).join(', ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="muted text-sm">Sin incidencias.</p>
        )}
      </div>
    </div>
  );
}

// --------------------------------------------------------------- Exportar
function ExportTab({ detail }: { detail: Detail }) {
  const race = detail.race;
  const items: [string, string, string][] = [
    ['results', 'Resultados oficiales', 'Publicados al finalizar la carrera'],
    ['standings', 'Clasificación actual', 'Instantánea en vivo con diferencias y su método de cálculo'],
    ['passings', 'Pasos por puntos de control', 'Incluye la fuente (GPS, manual, alfombra)'],
    ['positions', 'Posiciones GPS', 'Telemetría completa con marcas de calidad'],
  ];
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {items.map(([type, title, desc]) => (
        <div key={type} className="panel flex items-center gap-4 p-4">
          <div className="flex-1">
            <div className="font-semibold">{title}</div>
            <div className="muted text-xs">{desc}</div>
          </div>
          <a className="btn-secondary" href={`/api/v1/admin/races/${race.id}/export?type=${type}&format=csv`} download>
            <IconDownload className="size-4" /> CSV
          </a>
          <a className="btn-secondary" href={`/api/v1/admin/races/${race.id}/export?type=${type}&format=json`} download>
            JSON
          </a>
        </div>
      ))}
      {race.mode === 'demo' && <p className="muted text-xs md:col-span-2">Los archivos de una carrera DEMO llevan el sufijo «-DEMO» en el nombre.</p>}
    </div>
  );
}
