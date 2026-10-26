import { useEffect, useState, type ReactNode } from 'react';
import { Link, NavLink } from 'react-router';
import { IconBike, IconMoon, IconSun } from './icons';

export function ThemeToggle() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'));
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    try {
      localStorage.setItem('theme', dark ? 'dark' : 'light');
    } catch {
      /* almacenamiento no disponible: el tema solo dura esta visita */
    }
  }, [dark]);
  return (
    <button className="btn-ghost px-2" onClick={() => setDark((d) => !d)} aria-label={dark ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'} title={dark ? 'Modo claro' : 'Modo oscuro'}>
      {dark ? <IconSun className="size-5" /> : <IconMoon className="size-5" />}
    </button>
  );
}

export function Brand() {
  return (
    <Link to="/" className="flex items-center gap-2.5" aria-label="Inicio">
      <span className="flex size-9 items-center justify-center rounded-lg bg-brand-500 text-white">
        <IconBike className="size-6" />
      </span>
      <span className="leading-tight">
        <span className="block whitespace-nowrap text-sm font-bold tracking-tight sm:text-base">Carreras Telemetría</span>
        <span className="muted hidden text-[11px] sm:block">Seguimiento en tiempo real</span>
      </span>
    </Link>
  );
}

export function PublicLayout({ children, banner }: { children: ReactNode; banner?: ReactNode }) {
  const nav = ({ isActive }: { isActive: boolean }) =>
    `rounded-lg px-3 py-2 text-sm font-medium ${isActive ? 'bg-brand-500 text-white' : 'text-slate-600 hover:bg-slate-100 dark:text-ink-300 dark:hover:bg-ink-800'}`;
  return (
    <div className="flex min-h-full flex-col">
      <header className="sticky top-0 z-[1100] border-b border-slate-200 bg-white/90 backdrop-blur dark:border-ink-700 dark:bg-ink-950/90">
        <div className="mx-auto flex max-w-[1600px] items-center justify-between gap-4 px-4 py-2.5">
          <Brand />
          <nav className="flex items-center gap-1" aria-label="Principal">
            <NavLink to="/" end className={nav}>
              Carreras
            </NavLink>
            <NavLink to="/admin" className={nav}>
              <span className="hidden sm:inline">Organizadores</span>
              <span className="sm:hidden">Panel</span>
            </NavLink>
            <ThemeToggle />
          </nav>
        </div>
      </header>
      {banner}
      <main className="flex-1">{children}</main>
      <footer className="muted border-t border-slate-200 px-4 py-4 text-center text-xs dark:border-ink-800">
        Plataforma de seguimiento y cronometraje · Proyecto Final de Carrera de Telecomunicaciones · Mapas © colaboradores de OpenStreetMap
      </footer>
    </div>
  );
}
