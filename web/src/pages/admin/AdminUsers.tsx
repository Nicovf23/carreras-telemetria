import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ErrorBox, Modal, Spinner } from '../../components/ui';
import { api, errorMessage, patch, post } from '../../lib/api';
import { useUser } from './AdminApp';

interface User {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'organizer';
  disabled: boolean;
  created_at: string;
}

export function AdminUsers() {
  const me = useUser();
  const [list, setList] = useState<User[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ email: '', name: '', role: 'organizer', password: '' });
  const load = useCallback(
    () =>
      api<{ users: User[] }>('/api/v1/admin/users')
        .then((r) => setList(r.users))
        .catch((e) => setErr(errorMessage(e))),
    [],
  );
  useEffect(() => {
    load();
  }, [load]);

  const create = async (e: FormEvent) => {
    e.preventDefault();
    setErr(null);
    try {
      await post('/api/v1/admin/users', f);
      setOpen(false);
      setF({ email: '', name: '', role: 'organizer', password: '' });
      load();
    } catch (e2) {
      setErr(errorMessage(e2));
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Usuarios</h1>
        <button className="btn-primary" onClick={() => setOpen(true)}>
          + Usuario
        </button>
      </div>
      {err && <ErrorBox>{err}</ErrorBox>}
      {!list ? (
        <Spinner />
      ) : (
        <div className="panel overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="muted text-left text-[11px] uppercase">
              <tr className="border-b border-slate-200 dark:border-ink-700">
                <th className="px-3 py-2">Nombre</th>
                <th className="px-3 py-2">Email</th>
                <th className="px-3 py-2">Rol</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {list.map((u) => (
                <tr key={u.id} className={`border-b border-slate-100 dark:border-ink-800 ${u.disabled ? 'opacity-50' : ''}`}>
                  <td className="px-3 py-2">{u.name}</td>
                  <td className="px-3 py-2">{u.email}</td>
                  <td className="px-3 py-2">
                    <select
                      className="input w-auto py-1 text-xs"
                      value={u.role}
                      disabled={u.id === me.id}
                      onChange={async (e) => {
                        try {
                          await patch(`/api/v1/admin/users/${u.id}`, { role: e.target.value });
                          load();
                        } catch (e2) {
                          setErr(errorMessage(e2));
                        }
                      }}
                    >
                      <option value="organizer">Organizador</option>
                      <option value="admin">Administrador</option>
                    </select>
                  </td>
                  <td className="px-3 py-2 text-right">
                    {u.id !== me.id && (
                      <button
                        className="btn-ghost px-2 py-1 text-xs"
                        onClick={async () => {
                          try {
                            await patch(`/api/v1/admin/users/${u.id}`, { disabled: !u.disabled });
                            load();
                          } catch (e2) {
                            setErr(errorMessage(e2));
                          }
                        }}
                      >
                        {u.disabled ? 'Reactivar' : 'Desactivar'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Modal open={open} onClose={() => setOpen(false)} title="Nuevo usuario">
        <form onSubmit={create} className="space-y-3">
          <input className="input" placeholder="Nombre" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          <input className="input" type="email" placeholder="Email" required value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
          <select className="input" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}>
            <option value="organizer">Organizador</option>
            <option value="admin">Administrador</option>
          </select>
          <input
            className="input"
            type="password"
            placeholder="Contraseña inicial (mín. 10 caracteres)"
            minLength={10}
            required
            autoComplete="new-password"
            value={f.password}
            onChange={(e) => setF({ ...f, password: e.target.value })}
          />
          <div className="flex justify-end">
            <button className="btn-primary">Crear</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

export function AdminAudit() {
  const [entries, setEntries] = useState<{ id: number; at: string; action: string; entity: string; entity_id: string | null; details: unknown; email: string | null }[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    api<{ entries: NonNullable<typeof entries> }>('/api/v1/admin/audit?limit=200')
      .then((r) => setEntries(r.entries))
      .catch((e) => setErr(errorMessage(e)));
  }, []);
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Registro de auditoría</h1>
      {err && <ErrorBox>{err}</ErrorBox>}
      {!entries ? (
        <Spinner />
      ) : (
        <div className="panel overflow-x-auto">
          <table className="w-full min-w-[700px] text-xs">
            <thead className="muted text-left uppercase">
              <tr className="border-b border-slate-200 dark:border-ink-700">
                <th className="px-3 py-2">Fecha</th>
                <th className="px-3 py-2">Usuario</th>
                <th className="px-3 py-2">Acción</th>
                <th className="px-3 py-2">Detalles</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id} className="border-b border-slate-100 align-top dark:border-ink-800">
                  <td className="tnum whitespace-nowrap px-3 py-2">{new Date(e.at).toLocaleString('es')}</td>
                  <td className="px-3 py-2">{e.email ?? 'sistema'}</td>
                  <td className="px-3 py-2 font-mono">{e.action}</td>
                  <td className="muted max-w-md truncate px-3 py-2 font-mono" title={JSON.stringify(e.details)}>
                    {JSON.stringify(e.details)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
