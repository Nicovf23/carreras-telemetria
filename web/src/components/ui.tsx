import { useEffect, useRef, type ReactNode } from 'react';
import { countryName, FRESHNESS_LABEL, RACE_STATUS_LABEL } from '../lib/format';
import type { Freshness, RaceMode, RaceStatus } from '../lib/types';

/** Bandera SVG (biblioteca flag-icons) con nombre del país accesible. */
export function Flag({ code, className = '' }: { code: string; className?: string }) {
  const c = code.toLowerCase();
  if (!/^[a-z]{2}$/.test(c)) return null;
  return <span className={`fi fi-${c} rounded-[2px] shadow-[0_0_0_1px_rgba(0,0,0,0.15)] ${className}`} role="img" aria-label={countryName(code)} title={countryName(code)} />;
}

const FRESH_COLOR: Record<Freshness, string> = {
  live: 'bg-live',
  delayed: 'bg-delayed',
  stale: 'bg-stale',
  lost: 'bg-lost',
  none: 'bg-slate-400 dark:bg-ink-600',
};

export function FreshnessDot({ f, className = '' }: { f: Freshness; className?: string }) {
  return <span className={`inline-block size-2.5 shrink-0 rounded-full ${FRESH_COLOR[f]} ${f === 'live' ? 'pulse-dot' : ''} ${className}`} aria-hidden />;
}

export function FreshnessBadge({ f, detail }: { f: Freshness; detail?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs" title={detail}>
      <FreshnessDot f={f} />
      <span>{FRESHNESS_LABEL[f]}</span>
    </span>
  );
}

export function RaceStatusBadge({ status }: { status: RaceStatus }) {
  const cls: Record<RaceStatus, string> = {
    live: 'bg-live/15 text-green-700 dark:text-green-300 ring-live/40',
    scheduled: 'bg-brand-500/10 text-brand-600 dark:text-brand-400 ring-brand-500/30',
    finished: 'bg-slate-500/10 text-slate-600 dark:text-ink-300 ring-slate-400/30',
    draft: 'bg-slate-500/10 text-slate-600 dark:text-ink-300 ring-slate-400/30',
    cancelled: 'bg-red-500/10 text-red-700 dark:text-red-300 ring-red-500/30',
  };
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ${cls[status]}`}>
      {status === 'live' && <FreshnessDot f="live" />}
      {RACE_STATUS_LABEL[status]}
    </span>
  );
}

export function DemoBadge({ mode }: { mode: RaceMode }) {
  if (mode !== 'demo') return null;
  return (
    <span
      className="inline-flex items-center rounded-md bg-amber-400 px-2 py-0.5 text-xs font-black tracking-widest text-amber-950"
      title="Carrera de demostración: participantes y telemetría simulados"
    >
      DEMO
    </span>
  );
}

export function DemoBanner() {
  return (
    <div role="note" className="border-b border-amber-500/40 bg-amber-400/15 px-4 py-2 text-center text-sm text-amber-900 dark:text-amber-200">
      <strong className="font-bold">MODO DEMO</strong> · Participantes ficticios y telemetría simulada. Ningún dato de esta carrera es real ni
      oficial.
    </div>
  );
}

export function Stat({ label, value, sub, icon }: { label: string; value: ReactNode; sub?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="panel flex items-center gap-3 px-4 py-3">
      {icon && <div className="hidden text-brand-500 sm:block dark:text-brand-400">{icon}</div>}
      <div className="min-w-0">
        <div className="tnum truncate text-lg font-bold leading-tight sm:text-xl">{value}</div>
        <div className="muted truncate text-xs">{label}</div>
        {sub && <div className="muted truncate text-[11px]">{sub}</div>}
      </div>
    </div>
  );
}

export function Spinner({ label = 'Cargando…' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-3 p-8 text-sm muted" role="status">
      <span className="size-5 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" />
      {label}
    </div>
  );
}

export function ErrorBox({ children }: { children: ReactNode }) {
  return (
    <div role="alert" className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-800 dark:text-red-200">
      {children}
    </div>
  );
}

/** Diálogo modal accesible (usa <dialog> nativo). */
export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      className={`m-auto w-[calc(100%-2rem)] ${wide ? 'max-w-3xl' : 'max-w-lg'} rounded-xl border border-slate-200 bg-white p-0 text-slate-900 shadow-2xl backdrop:bg-black/60 dark:border-ink-700 dark:bg-ink-850 dark:text-slate-100`}
    >
      {open && (
        <div className="p-5">
          <div className="mb-4 flex items-start justify-between gap-4">
            <h2 className="text-lg font-semibold">{title}</h2>
            <button className="btn-ghost -mr-2 -mt-1 px-2 py-1" onClick={onClose} aria-label="Cerrar">
              ✕
            </button>
          </div>
          {children}
        </div>
      )}
    </dialog>
  );
}

/** Confirmación obligatoria antes de acciones destructivas. */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirmar',
  danger = true,
  requireText,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  /** Si se indica, el usuario debe escribir este texto para habilitar el botón. */
  requireText?: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <Modal open={open} onClose={onCancel} title={title}>
      <div className="space-y-4 text-sm">
        <div>{message}</div>
        {requireText && (
          <div>
            <label className="label" htmlFor="confirm-text">
              Escribe «{requireText}» para confirmar
            </label>
            <input id="confirm-text" ref={inputRef} className="input" autoComplete="off" onChange={(e) => (e.target.dataset.ok = String(e.target.value === requireText))} />
          </div>
        )}
        <div className="flex justify-end gap-2">
          <button className="btn-secondary" onClick={onCancel}>
            Cancelar
          </button>
          <button
            className={danger ? 'btn-danger' : 'btn-primary'}
            onClick={() => {
              if (requireText && inputRef.current?.value !== requireText) {
                inputRef.current?.focus();
                return;
              }
              onConfirm();
            }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </Modal>
  );
}
