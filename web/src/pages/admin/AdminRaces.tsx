import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { DemoBadge, ErrorBox, Modal, RaceStatusBadge, Spinner } from '../../components/ui';
import { api, errorMessage, post } from '../../lib/api';
import { formatDate, formatKm } from '../../lib/format';
import type { RaceSummary } from '../../lib/types';

export function RaceForm({
  initial,
  onSubmit,
  submitLabel,
}: {
  initial?: Partial<RaceSummary> & { allowEstimatedGaps?: boolean };
  onSubmit: (body: Record<string, unknown>) => Promise<void>;
  submitLabel: string;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [location, setLocation] = useState(initial?.location ?? '');
  const [discipline, setDiscipline] = useState(initial?.discipline ?? 'cycling_road');
  const [mode, setMode] = useState(initial?.mode ?? 'official');
  const [status, setStatus] = useState(initial?.status && ['draft', 'scheduled', 'cancelled'].includes(initial.status) ? initial.status : 'draft');
  const [start, setStart] = useState(initial?.scheduledStart ? toLocalInput(initial.scheduledStart) : '');
  const [laps, setLaps] = useState(initial?.laps ?? 1);
  const [est, setEst] = useState(initial?.allowEstimatedGaps ?? true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const lifecycleLocked = initial?.status === 'live' || initial?.status === 'finished';

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {
        name,
        description,
        location,
        discipline,
        laps: Number(laps),
        allowEstimatedGaps: est,
        scheduledStart: start ? new Date(start).toISOString() : null,
      };
      if (!initial?.startedAt) body.mode = mode;
      if (!lifecycleLocked) body.status = status;
      await onSubmit(body);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      {error && <ErrorBox>{error}</ErrorBox>}
      <div>
        <label className="label" htmlFor="rf-name">Nombre</label>
        <input id="rf-name" className="input" required minLength={3} maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="rf-start">Fecha y hora de salida</label>
          <input id="rf-start" className="input" type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor="rf-loc">Lugar</label>
          <input id="rf-loc" className="input" value={location} onChange={(e) => setLocation(e.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor="rf-disc">Modalidad</label>
          <select id="rf-disc" className="input" value={discipline} onChange={(e) => setDiscipline(e.target.value)}>
            <option value="cycling_road">Ciclismo en ruta</option>
            <option value="cycling_circuit">Ciclismo en circuito (vueltas)</option>
            <option value="cycling_tt">Contrarreloj (salidas individuales)</option>
            <option value="triathlon" disabled>
              Triatlón (próximamente)
            </option>
          </select>
        </div>
        <div>
          <label className="label" htmlFor="rf-laps">Vueltas</label>
          <input id="rf-laps" className="input" type="number" min={1} max={200} value={laps} onChange={(e) => setLaps(Number(e.target.value))} disabled={initial?.status === 'live'} />
        </div>
        <div>
          <label className="label" htmlFor="rf-mode">Tipo de datos</label>
          <select id="rf-mode" className="input" value={mode} onChange={(e) => setMode(e.target.value as 'official' | 'demo')} disabled={!!initial?.startedAt}>
            <option value="official">Oficial (dispositivos reales)</option>
            <option value="demo">DEMO (datos simulados)</option>
          </select>
        </div>
        <div>
          <label className="label" htmlFor="rf-status">Publicación</label>
          <select id="rf-status" className="input" value={status} onChange={(e) => setStatus(e.target.value as 'draft')} disabled={lifecycleLocked}>
            <option value="draft">Borrador (no visible)</option>
            <option value="scheduled">Publicada como próxima</option>
            <option value="cancelled">Cancelada</option>
          </select>
        </div>
      </div>
      <div>
        <label className="label" htmlFor="rf-desc">Descripción</label>
        <textarea id="rf-desc" className="input min-h-20" maxLength={2000} value={description} onChange={(e) => setDescription(e.target.value)} />
      </div>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" className="mt-1" checked={est} onChange={(e) => setEst(e.target.checked)} />
        <span>
          Mostrar diferencias <strong>estimadas</strong> entre puntos de control (marcadas con «≈»). Si se desactiva, solo se muestran diferencias medidas en
          puntos de control.
        </span>
      </label>
      <div className="flex justify-end">
        <button className="btn-primary" disabled={busy}>
          {busy ? 'Guardando…' : submitLabel}
        </button>
      </div>
    </form>
  );
}

function toLocalInput(iso: string) {
  const d = new Date(iso);
  const off = d.getTimezoneOffset() * 60_000;
  return new Date(d.getTime() - off).toISOString().slice(0, 16);
}

export function AdminRaces() {
  const [races, setRaces] = useState<(RaceSummary & { participantCount: number })[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const navigate = useNavigate();

  const load = () =>
    api<{ races: (RaceSummary & { participantCount: number })[] }>('/api/v1/admin/races')
      .then((r) => setRaces(r.races))
      .catch((e) => setError(errorMessage(e)));
  useEffect(() => {
    load();
  }, []);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Carreras</h1>
        <button className="btn-primary" onClick={() => setCreating(true)}>
          + Nueva carrera
        </button>
      </div>
      {error && <ErrorBox>{error}</ErrorBox>}
      {!races ? (
        <Spinner />
      ) : (
        <div className="panel overflow-x-auto">
          <table className="w-full min-w-[700px] text-sm">
            <thead className="muted text-left text-[11px] uppercase">
              <tr className="border-b border-slate-200 dark:border-ink-700">
                <th className="px-4 py-2">Carrera</th>
                <th className="px-4 py-2">Estado</th>
                <th className="px-4 py-2">Fecha</th>
                <th className="px-4 py-2 text-right">Recorrido</th>
                <th className="px-4 py-2 text-right">Participantes</th>
              </tr>
            </thead>
            <tbody>
              {races.map((r) => (
                <tr key={r.id} className="border-b border-slate-100 hover:bg-slate-50 dark:border-ink-800 dark:hover:bg-ink-800">
                  <td className="px-4 py-3">
                    <Link to={`/admin/carreras/${r.id}`} className="font-semibold hover:text-brand-500 hover:underline">
                      {r.name}
                    </Link>{' '}
                    <DemoBadge mode={r.mode} />
                    <div className="muted text-xs">{r.location}</div>
                  </td>
                  <td className="px-4 py-3">
                    <RaceStatusBadge status={r.status} />
                  </td>
                  <td className="muted px-4 py-3">{formatDate(r.startedAt ?? r.scheduledStart, r.timezone)}</td>
                  <td className="tnum px-4 py-3 text-right">{r.routeLengthM ? formatKm(r.routeLengthM * r.laps) : <span className="muted">Sin recorrido</span>}</td>
                  <td className="tnum px-4 py-3 text-right">{r.participantCount}</td>
                </tr>
              ))}
              {races.length === 0 && (
                <tr>
                  <td colSpan={5} className="muted px-4 py-8 text-center">
                    No hay carreras. Crea la primera.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
      <Modal open={creating} onClose={() => setCreating(false)} title="Nueva carrera" wide>
        <RaceForm
          submitLabel="Crear carrera"
          onSubmit={async (body) => {
            const r = await post<{ race: RaceSummary }>('/api/v1/admin/races', body);
            setCreating(false);
            navigate(`/admin/carreras/${r.race.id}`);
          }}
        />
      </Modal>
    </div>
  );
}
