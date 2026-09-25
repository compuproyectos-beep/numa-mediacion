'use client';

import { ReactNode, useEffect, useRef, useState } from 'react';
import { X, Eye, EyeOff } from 'lucide-react';
import clsx from 'clsx';

// ── BADGE ────────────────────────────────────────────────────────────────────
const badgeColors: Record<string, string> = {
  borrador: 'bg-numa-100 text-numa-700',
  enviado: 'bg-blue-50 text-blue-700',
  aprobado: 'bg-green-50 text-green-700',
  rechazado: 'bg-red-50 text-red-700',
  activo: 'bg-green-50 text-green-700',
  inactivo: 'bg-red-50 text-red-700',
};

export function Badge({ label, variant }: { label: string; variant?: string }) {
  const key = variant ?? label.toLowerCase();
  return (
    <span className={clsx('badge', badgeColors[key] ?? 'bg-numa-100 text-numa-700')}>
      {label}
    </span>
  );
}

// ── MODAL ─────────────────────────────────────────────────────────────────────
interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  size?: 'sm' | 'md' | 'lg';
}

export function Modal({ open, onClose, title, children, size = 'md' }: ModalProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    if (open) document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;

  const widths = { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-2xl' };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div
        ref={ref}
        className={clsx(
          'relative bg-white rounded-sm shadow-2xl w-full animate-slide-up flex flex-col max-h-[85vh]',
          widths[size]
        )}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-numa-100 shrink-0">
          <h2 className="text-base font-bold text-numa-900">{title}</h2>
          <button onClick={onClose} className="p-1 text-numa-400 hover:text-numa-700 rounded-sm">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="px-6 py-5 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}

// ── SPINNER ───────────────────────────────────────────────────────────────────
export function Spinner({ className }: { className?: string }) {
  return (
    <div className={clsx('flex items-center justify-center py-10', className)}>
      <div className="w-6 h-6 border-2 border-numa-200 border-t-numa-700 rounded-full animate-spin" />
    </div>
  );
}

// ── EMPTY STATE ───────────────────────────────────────────────────────────────
interface EmptyStateProps {
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  icon?: string;
}

export function EmptyState({ message, actionLabel, onAction, icon = '📂' }: EmptyStateProps) {
  return (
    <div className="text-center py-14 text-numa-400 text-sm">
      <div className="mb-2 text-3xl">{icon}</div>
      <p>{message}</p>

      {actionLabel && onAction && (
        <button type="button" onClick={onAction} className="btn-primary mt-4 inline-flex">
          {actionLabel}
        </button>
      )}
    </div>
  );
}

// ── CONFIRM DIALOG ────────────────────────────────────────────────────────────
interface ConfirmProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  message: string;
  loading?: boolean;
  confirmLabel?: string;
}

export function ConfirmDialog({ open, onClose, onConfirm, message, loading, confirmLabel }: ConfirmProps) {
  return (
    <Modal open={open} onClose={onClose} title="Confirmar acción" size="sm">
      <p className="text-sm text-numa-700 mb-6">{message}</p>
      <div className="flex gap-3 justify-end">
        <button onClick={onClose} className="btn-secondary text-sm">Cancelar</button>
        <button onClick={onConfirm} disabled={loading} className="btn-danger text-sm">
         {loading ? 'Procesando...' : confirmLabel || 'Confirmar'}
        </button>
      </div>
    </Modal>
  );
}

// ── INPUT FIELD ───────────────────────────────────────────────────────────────
interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string;
}

export function InputField({ label, error, ...props }: InputProps) {
  const isDateOrTime = props.type === 'date' || props.type === 'time';

  return (
    <div>
      <label className="label">{label}</label>
      <input
        {...props}
        className={clsx(
          'input-field',
          isDateOrTime && 'max-w-[220px] py-2',
          error && 'border-red-400'
        )}
      />
      {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
    </div>
  );
}

// ── PASSWORD FIELD ────────────────────────────────────────────────────────────
interface PasswordFieldProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label: string;
  error?: string;
}

export function PasswordField({ label, error, ...props }: PasswordFieldProps) {
  const [visible, setVisible] = useState(false);

  return (
    <div>
      <label className="label">{label}</label>
      <div className="relative">
        <input
          {...props}
          type={visible ? 'text' : 'password'}
          className={clsx('input-field pr-10', error && 'border-red-400')}
        />
        <button
          type="button"
          tabIndex={-1}
          onClick={() => setVisible((v) => !v)}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-numa-400 hover:text-numa-700"
        >
          {visible ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
        </button>
      </div>
      {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
    </div>
  );
}

// ── SELECT FIELD ──────────────────────────────────────────────────────────────
interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label: string;
  children: ReactNode;
}

export function SelectField({ label, children, ...props }: SelectProps) {
  return (
    <div>
      <label className="label">{label}</label>
      <select {...props} className="input-field">
        {children}
      </select>
    </div>
  );
}

// ── TEXTAREA FIELD ────────────────────────────────────────────────────────────
interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label: string;
}

export function TextareaField({ label, ...props }: TextareaProps) {
  return (
    <div>
      <label className="label">{label}</label>
      <textarea {...props} className="input-field resize-none" />
    </div>
  );
}

// ── PAGE HEADER ───────────────────────────────────────────────────────────────
export function PageHeader({ title, subtitle, action }: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <div className="page-header">
      <div>
        <h1 className="section-title">{title}</h1>
        {subtitle && <p className="text-sm text-numa-500 mt-0.5">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

// ── STAT CARD ─────────────────────────────────────────────────────────────────
export function StatCard({ label, value, icon: Icon, color, onClick, active }: {
  label: string;
  value: number | string;
  icon: React.ComponentType<{ className?: string }>;
  color: string;
  onClick?: () => void;
  active?: boolean;
}) {
  const contenido = (
    <>
      <div className={clsx('w-10 h-10 rounded-sm flex items-center justify-center', color)}>
        <Icon className="w-5 h-5 text-white" />
      </div>
      <div>
        <p className="text-2xl font-bold text-numa-900">{value}</p>
        <p className="text-xs text-numa-500 uppercase tracking-wide">{label}</p>
      </div>
    </>
  );

  if (!onClick) {
    return <div className="card p-5 flex items-center gap-4">{contenido}</div>;
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        'card p-5 flex items-center gap-4 w-full text-left transition-shadow hover:shadow-lg cursor-pointer',
        active && 'ring-2 ring-gold-400'
      )}
    >
      {contenido}
    </button>
  );
}

// ── ERROR ALERT ───────────────────────────────────────────────────────────────
export function ErrorAlert({ message }: { message: string }) {
  return (
    <div className="bg-red-50 border border-red-200 rounded-sm p-3 text-sm text-red-700">
      {message}
    </div>
  );
}

export function SuccessAlert({ message }: { message: string }) {
  return (
    <div className="bg-green-50 border border-green-200 rounded-sm p-3 text-sm text-green-700">
      {message}
    </div>
  );
}

// ── BARRAS RESUMEN ──────────────────────────────────────────────────────────
// Mini gráfica de barras horizontales, sin ninguna librería, para que los
// reportes no sean solo tablas de números. Se usa tanto en pantalla como en
// la versión impresa/PDF (es solo CSS, así que imprime bien).
export interface BarraItem {
  label: string;
  valor: number;
  color?: string;
}

export function BarrasResumen({ items }: { items: BarraItem[] }) {
  const max = Math.max(...items.map((i) => i.valor), 1);

  return (
    <div className="space-y-2">
      {items.map((it) => (
        <div key={it.label} className="flex items-center gap-3">
          <span className="w-36 shrink-0 text-xs text-numa-600 truncate">{it.label}</span>
          <div className="flex-1 h-2.5 bg-numa-100 rounded-full overflow-hidden">
            <div
              className="h-full rounded-full"
              style={{
                width: `${it.valor > 0 ? Math.max((it.valor / max) * 100, 3) : 0}%`,
                backgroundColor: it.color || '#E0B84A',
              }}
            />
          </div>
          <span className="w-8 shrink-0 text-xs font-semibold text-numa-800 text-right">
            {it.valor}
          </span>
        </div>
      ))}
    </div>
  );
}
