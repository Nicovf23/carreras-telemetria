import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ConfirmDialog, ErrorBox, Modal, Spinner } from '../../components/ui';
import { api, del, errorMessage, patch, post } from '../../lib/api';
import { formatAge } from '../../lib/format';
import { useUser } from './AdminApp';

interface Device {
  id: string;
  serial: string;
  label: string;
  hardware: string;
  firmware: string | null;
  keyHint: string;
  isSimulated: boolean;
  active: boolean;
  lastSeenAt: string | null;
  battery: number | null;
  rssi: number | null;
  network: string | null;
  assignment: { raceId: string; raceName: string; raceMode: string; bib: number; name: string } | null;
}

/** Muestra el token una única vez, con aviso y botón de copiar. */
function TokenModal({ token, onClose }: { token: string | null; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <Modal open={!!token} onClose={onClose} title="Credencial del dispositivo">
      <div className="space-y-3 text-sm">
        <div className="rounded-lg border border-amber-500/40 bg-amber-400/15 px-3 py-2 text-amber-900 dark:text-amber-200">
          Guarda este token ahora: <strong>no se volverá a mostrar</strong>. El servidor solo almacena su huella (hash). Grábalo en el firmware o en la
          configuración segura del dispositivo; no lo incluyas en el código fuente ni en repositorios.
        </div>
        <code className="block break-all rounded-lg bg-slate-100 p-3 font-mono text-xs dark:bg-ink-900">{token}</code>
        <p className="muted text-xs">
          Uso: cabecera <code>Authorization: Bearer &lt;token&gt;</code> en <code>POST /api/v1/telemetry</code>.
        </p>
        <div className="flex justify-end gap-2">
          <button
            className="btn-secondary"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(token ?? '');
                setCopied(true);
              } catch {
                setCopied(false);
              }
            }}
          >
            {copied ? 'Copiado ✓' : 'Copiar'}
          </button>
          <button className="btn-primary" onClick={onClose}>
            Ya lo he guardado
          </button>
        </div>
      </div>
    </Modal>
  );
}

export function AdminDevices() {
  const user = useUser();
  const [list, setList] = useState<Device[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [rotate, setRotate] = useState<Device | null>(null);
  const [remove, setRemove] = useState<Device | null>(null);
  const [form, setForm] = useState({ serial: '', label: '', hardware: 'XIAO nRF52840 + SIMCom A7670SA', firmware: '' });
  const [showSim, setShowSim] = useState(false);

  const load = useCallback(
    () =>
      api<{ devices: Device[] }>('/api/v1/admin/devices')
        .then((r) => setList(r.devices))
        .catch((e) => setErr(errorMessage(e))),
    [],
  );
  useEffect(() => {
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [load]);

  const create = async (e: FormEvent) => {
    e.preventDefault();
    setErr(null);
    try {
      const r = await post<{ token: string }>('/api/v1/admin/devices', { ...form, firmware: form.firmware || null });
      setCreating(false);
      setForm({ ...form, serial: '', label: '' });
      setToken(r.token);
      load();
    } catch (e2) {
      setErr(errorMessage(e2));
    }
  };

  const shown = list?.filter((d) => showSim || !d.isSimulated) ?? [];
  const now = Date.now();
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold">Dispositivos</h1>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={showSim} onChange={(e) => setShowSim(e.target.checked)} /> Mostrar virtuales (DEMO)
          </label>
          <button className="btn-primary" onClick={() => setCreating(true)}>
            + Registrar dispositivo
          </button>
        </div>
      </div>
      {err && <ErrorBox>{err}</ErrorBox>}
      {!list ? (
        <Spinner />
      ) : (
        <div className="panel overflow-x-auto">
          <table className="w-full min-w-[900px] text-sm">
            <thead className="muted text-left text-[11px] uppercase">
              <tr className="border-b border-slate-200 dark:border-ink-700">
                <th className="px-3 py-2">Serie</th>
                <th className="px-3 py-2">Hardware</th>
                <th className="px-3 py-2">Asignado a</th>
                <th className="px-3 py-2">Último contacto</th>
                <th className="px-3 py-2 text-right">Batería</th>
                <th className="px-3 py-2 text-right">Señal</th>
                <th className="px-3 py-2">Clave</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {shown.map((d) => (
                <tr key={d.id} className={`border-b border-slate-100 dark:border-ink-800 ${d.active ? '' : 'opacity-50'}`}>
                  <td className="px-3 py-2">
                    <span className="font-mono font-semibold">{d.serial}</span>
                    {d.isSimulated && <span className="ml-2 rounded bg-amber-400 px-1.5 text-[10px] font-black text-amber-950">DEMO</span>}
                    {!d.active && <span className="muted ml-2 text-xs">(desactivado)</span>}
                    {d.label && d.label !== d.serial && <div className="muted text-xs">{d.label}</div>}
                  </td>
                  <td className="muted px-3 py-2 text-xs">
                    {d.hardware || '—'}
                    {d.firmware && ` · fw ${d.firmware}`}
                  </td>
                  <td className="px-3 py-2 text-xs">{d.assignment ? `Dorsal ${d.assignment.bib} · ${d.assignment.name} · ${d.assignment.raceName}` : <span className="muted">—</span>}</td>
                  <td className="px-3 py-2 text-xs">{d.lastSeenAt ? (d.isSimulated ? 'reloj simulado' : formatAge(now - Date.parse(d.lastSeenAt))) : 'Nunca'}</td>
                  <td className="tnum px-3 py-2 text-right">{d.battery !== null ? `${Math.round(d.battery)}%` : '—'}</td>
                  <td className="tnum px-3 py-2 text-right text-xs">{d.rssi !== null ? `${d.network ?? ''} ${d.rssi} dBm` : '—'}</td>
                  <td className="muted px-3 py-2 font-mono text-xs">{d.isSimulated ? 'interna' : d.keyHint}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right">
                    {!d.isSimulated && (
                      <>
                        <button className="btn-ghost px-2 py-1 text-xs" onClick={() => setRotate(d)}>
                          Nueva clave
                        </button>
                        <button
                          className="btn-ghost px-2 py-1 text-xs"
                          onClick={async () => {
                            try {
                              await patch(`/api/v1/admin/devices/${d.id}`, { active: !d.active });
                              load();
                            } catch (e) {
                              setErr(errorMessage(e));
                            }
                          }}
                        >
                          {d.active ? 'Desactivar' : 'Activar'}
                        </button>
                        {user.role === 'admin' && (
                          <button className="btn-ghost px-2 py-1 text-xs text-red-600" onClick={() => setRemove(d)}>
                            Borrar
                          </button>
                        )}
                      </>
                    )}
                  </td>
                </tr>
              ))}
              {shown.length === 0 && (
                <tr>
                  <td colSpan={8} className="muted px-4 py-8 text-center">
                    No hay dispositivos físicos registrados.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <Modal open={creating} onClose={() => setCreating(false)} title="Registrar dispositivo">
        <form onSubmit={create} className="space-y-3">
          <div>
            <label className="label" htmlFor="d-serial">Número de serie / identificador</label>
            <input id="d-serial" className="input font-mono" required pattern="[A-Za-z0-9_\-]{3,64}" placeholder="TRK-001" value={form.serial} onChange={(e) => setForm({ ...form, serial: e.target.value })} />
          </div>
          <div>
            <label className="label" htmlFor="d-label">Etiqueta</label>
            <input id="d-label" className="input" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} />
          </div>
          <div>
            <label className="label" htmlFor="d-hw">Hardware</label>
            <input id="d-hw" className="input" value={form.hardware} onChange={(e) => setForm({ ...form, hardware: e.target.value })} />
          </div>
          <div>
            <label className="label" htmlFor="d-fw">Versión de firmware</label>
            <input id="d-fw" className="input" value={form.firmware} onChange={(e) => setForm({ ...form, firmware: e.target.value })} />
          </div>
          <div className="flex justify-end">
            <button className="btn-primary">Registrar y generar clave</button>
          </div>
        </form>
      </Modal>
      <TokenModal token={token} onClose={() => setToken(null)} />
      <ConfirmDialog
        open={!!rotate}
        title="Generar nueva clave"
        message={`La clave actual de ${rotate?.serial} dejará de funcionar inmediatamente. El dispositivo no podrá enviar datos hasta que grabes la nueva.`}
        confirmLabel="Generar"
        onCancel={() => setRotate(null)}
        onConfirm={async () => {
          const d = rotate!;
          setRotate(null);
          try {
            const r = await post<{ token: string }>(`/api/v1/admin/devices/${d.id}/rotate-key`);
            setToken(r.token);
          } catch (e) {
            setErr(errorMessage(e));
          }
        }}
      />
      <ConfirmDialog
        open={!!remove}
        title="Borrar dispositivo"
        message={`Se borrará ${remove?.serial}. Solo es posible si no tiene telemetría registrada; en otro caso, desactívalo.`}
        confirmLabel="Borrar"
        onCancel={() => setRemove(null)}
        onConfirm={async () => {
          const d = remove!;
          setRemove(null);
          try {
            await del(`/api/v1/admin/devices/${d.id}`);
            load();
          } catch (e) {
            setErr(errorMessage(e));
          }
        }}
      />
    </div>
  );
}
