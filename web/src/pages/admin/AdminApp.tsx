import { createContext, useContext, useEffect, useState, type FormEvent } from 'react';
import { NavLink, Route, Routes } from 'react-router';
import { Brand, ThemeToggle } from '../../components/Layout';
import { IconChip, IconFlag, IconSettings, IconUsers } from '../../components/icons';
import { ErrorBox, Spinner } from '../../components/ui';
import { api, errorMessage, post } from '../../lib/api';
import type { SessionUser } from '../../lib/types';
import { AdminDevices } from './AdminDevices';
import { AdminRaceDetail } from './AdminRaceDetail';
import { AdminRaces } from './AdminRaces';
import { AdminAudit, AdminUsers } from './AdminUsers';

const UserCtx = createContext<SessionUser | null>(null);
export const useUser = () => useContext(UserCtx)!;

function Login({ onLogin }: { onLogin: (u: SessionUser) => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await post<{ user: SessionUser }>('/api/v1/auth/login', { email, password });
      onLogin(r.user);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex min-h-full items-center justify-center p-4">
      <form onSubmit={submit} className="panel w-full max-w-sm space-y-4 p-6">
        <Brand />
        <h1 className="text-lg font-semibold">Acceso de organizadores</h1>
        {error && <ErrorBox>{error}</ErrorBox>}
        <div>
          <label className="label" htmlFor="email">
            Email
          </label>
          <input id="email" className="input" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor="pw">
            Contraseña
          </label>
          <input id="pw" className="input" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        <button className="btn-primary w-full" disabled={busy}>
          {busy ? 'Entrando…' : 'Entrar'}
        </button>
        <p className="muted text-xs">El administrador inicial se define con ADMIN_EMAIL y ADMIN_PASSWORD en el archivo .env del servidor.</p>
      </form>
    </div>
  );
}

export function AdminApp() {
  const [user, setUser] = useState<SessionUser | null | undefined>(undefined);
  useEffect(() => {
    api<{ user: SessionUser }>('/api/v1/auth/me')
      .then((r) => setUser(r.user))
      .catch(() => setUser(null));
  }, []);

  if (user === undefined) return <Spinner />;
  if (!user) return <Login onLogin={setUser} />;

  const link = ({ isActive }: { isActive: boolean }) =>
    `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium ${isActive ? 'bg-brand-500 text-white' : 'text-slate-700 hover:bg-slate-100 dark:text-ink-300 dark:hover:bg-ink-800'}`;
  const logout = async () => {
    await post('/api/v1/auth/logout');
    setUser(null);
  };

  return (
    <UserCtx.Provider value={user}>
      <div className="flex min-h-full flex-col lg:flex-row">
        <aside className="border-b border-slate-200 bg-white p-3 dark:border-ink-700 dark:bg-ink-950 lg:sticky lg:top-0 lg:h-screen lg:w-60 lg:shrink-0 lg:border-b-0 lg:border-r">
          <div className="flex items-center justify-between lg:block">
            <Brand />
            <div className="lg:hidden">
              <ThemeToggle />
            </div>
          </div>
          <nav className="mt-3 flex gap-1 overflow-x-auto lg:mt-6 lg:flex-col" aria-label="Panel">
            <NavLink to="/admin" end className={link}>
              <IconFlag className="size-4" /> Carreras
            </NavLink>
            <NavLink to="/admin/dispositivos" className={link}>
              <IconChip className="size-4" /> Dispositivos
            </NavLink>
            {user.role === 'admin' && (
              <>
                <NavLink to="/admin/usuarios" className={link}>
                  <IconUsers className="size-4" /> Usuarios
                </NavLink>
                <NavLink to="/admin/auditoria" className={link}>
                  <IconSettings className="size-4" /> Auditoría
                </NavLink>
              </>
            )}
            <NavLink to="/" className={link}>
              ↗ Web pública
            </NavLink>
          </nav>
          <div className="mt-6 hidden border-t border-slate-200 pt-4 text-sm dark:border-ink-700 lg:block">
            <div className="font-medium">{user.name}</div>
            <div className="muted truncate text-xs">{user.email}</div>
            <div className="muted text-xs">{user.role === 'admin' ? 'Administrador' : 'Organizador'}</div>
            <div className="mt-3 flex items-center gap-2">
              <button className="btn-secondary" onClick={logout}>
                Cerrar sesión
              </button>
              <ThemeToggle />
            </div>
          </div>
        </aside>
        <main className="min-w-0 flex-1 p-4 lg:p-6">
          <Routes>
            <Route index element={<AdminRaces />} />
            <Route path="carreras/:id" element={<AdminRaceDetail />} />
            <Route path="dispositivos" element={<AdminDevices />} />
            <Route path="usuarios" element={<AdminUsers />} />
            <Route path="auditoria" element={<AdminAudit />} />
          </Routes>
          <button className="btn-secondary mt-8 lg:hidden" onClick={logout}>
            Cerrar sesión
          </button>
        </main>
      </div>
    </UserCtx.Provider>
  );
}
