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
  size?: 'sm' | 'md' | 'lg' | 'xl';
}

export function Modal({ open, onClose, title, children, size = 'md' }: ModalProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    if (open) document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;

  const widths = { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-6xl' };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-numa-950/55 backdrop-blur-sm" onClick={onClose} />
      <div
        ref={ref}
        className={clsx(
          'relative bg-white rounded-2xl overflow-hidden shadow-2xl w-full animate-slide-up flex flex-col max-h-[calc(85vh/var(--tz,1))]',
          widths[size]
        )}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-numa-100 shrink-0">
          <h2 className="text-base font-bold text-numa-900">{title}</h2>
          <button onClick={onClose} className="p-1 text-numa-600 hover:text-numa-700 rounded-sm">
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

export function EmptyState({ message, actionLabel, onAction, icon = '' }: EmptyStateProps) {
  return (
    <div className="text-center py-14 text-numa-600 text-sm">
      {icon && <div className="mb-2 text-3xl">{icon}</div>}
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
  /** 'peligro' (rojo, por defecto) para acciones destructivas; 'primario' (dorado) para acciones positivas. */
  variante?: 'peligro' | 'primario';
}

export function ConfirmDialog({ open, onClose, onConfirm, message, loading, confirmLabel, variante = 'peligro' }: ConfirmProps) {
  return (
    <Modal open={open} onClose={onClose} title="Confirmar acción" size="sm">
      <p className="text-sm text-numa-700 mb-6">{message}</p>
      <div className="flex gap-3 justify-end">
        <button onClick={onClose} className="btn-secondary text-sm">Cancelar</button>
        <button onClick={onConfirm} disabled={loading} className={`${variante === 'primario' ? 'btn-primary' : 'btn-danger'} text-sm`}>
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
          className="absolute right-3 top-1/2 -translate-y-1/2 text-numa-600 hover:text-numa-700"
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
    <div className="page-banner relative overflow-hidden rounded-2xl bg-gradient-to-br from-[#0A2A62] via-[#144193] to-[#2358C9] px-5 sm:px-7 py-5 mb-5 text-white shadow-[0_22px_40px_-26px_rgba(11,39,89,0.8)]">
      <div className="hero-float-a pointer-events-none absolute -top-24 -right-10 w-64 h-64 rounded-full border-[34px] border-white/10" />
      <div className="relative flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight leading-tight" style={{ fontFamily: '"Jost Variable", system-ui, sans-serif' }}>{title}</h1>
          {subtitle && <p className="text-sm text-blue-100 mt-1">{subtitle}</p>}
        </div>
        {action}
      </div>
    </div>
  );
}

// ── STAT CARD ─────────────────────────────────────────────────────────────────
export function StatCard({ label, value, icon: Icon, color, relleno, textoColor, onClick, active, compacto }: {
  label: string;
  value: number | string;
  icon: React.ComponentType<{ className?: string }>;
  color: string;
  // Si se pasa, toda la caja lleva ese fondo suave (y su borde).
  relleno?: string;
  // Color del número y del texto cuando la caja va con relleno.
  textoColor?: string;
  onClick?: () => void;
  active?: boolean;
  // Versión más pequeña para poder poner más cajas en una fila.
  compacto?: boolean;
}) {
  const contenido = (
    <>
      <div
        className={clsx(
          compacto ? 'w-8 h-8' : 'w-10 h-10',
          'rounded-md flex items-center justify-center shrink-0',
          color
        )}
      >
        <Icon className="w-5 h-5" />
      </div>
      <div>
        <p className={clsx(compacto ? 'text-lg leading-tight' : 'text-2xl', 'font-bold tabular-nums', textoColor || 'text-numa-900')}>{value}</p>
        <p className={clsx(compacto ? 'text-[11px] leading-tight' : 'text-xs', 'uppercase tracking-wide font-semibold opacity-80', textoColor || 'text-numa-600')}>{label}</p>
      </div>
    </>
  );

  const base = clsx(
    compacto ? 'px-3 py-2 flex items-center gap-2.5 rounded-md' : 'p-5 flex items-center gap-4 rounded-md',
    relleno ? clsx(relleno, 'border shadow-sm') : 'card'
  );

  if (!onClick) {
    return <div className={base}>{contenido}</div>;
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        base,
        'w-full text-left cursor-pointer card-lift hover:shadow-md',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-400 focus-visible:ring-offset-2',
        active && 'ring-4 ring-gold-400 ring-offset-2'
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

export function BarrasResumen({
  items,
  compacto = false
}: {
  items: BarraItem[];
  compacto?: boolean;
}) {
  const max = Math.max(...items.map((i) => i.valor), 1);
  // Los navegadores quitan los colores de fondo al imprimir; esto fuerza que
  // las barras sí salgan en el PDF / hoja impresa.
  const forzarColor = { WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' } as React.CSSProperties;

  return (
    <div className={compacto ? 'grid grid-cols-2 gap-x-8 gap-y-1' : 'space-y-1.5'}>
      {items.map((it) => (
        <div key={it.label} className="flex items-center gap-2">
          <span title={it.label} className={`${compacto ? 'w-40' : 'w-44'} shrink-0 text-xs text-numa-700 truncate`}>
            {it.label}
          </span>
          <div
            className={`flex-1 ${compacto ? 'h-1.5' : 'h-2'} bg-numa-100 rounded-full overflow-hidden`}
            style={forzarColor}
          >
            <div
              className="h-full rounded-full"
              style={{
                ...forzarColor,
                width: `${it.valor > 0 ? Math.max((it.valor / max) * 100, 3) : 0}%`,
                backgroundColor: it.color || '#E0B84A',
              }}
            />
          </div>
          <span className="w-6 shrink-0 text-xs font-semibold text-numa-800 text-right">
            {it.valor}
          </span>
        </div>
      ))}
    </div>
  );
}

// ── DONA ACUERDO / NO ACUERDO ───────────────────────────────────────────────
// Dona en SVG (sin librerías): verde = acuerdo, ámbar = no acuerdo, con el
// total al centro y la leyenda al lado. Sirve para mostrar de un vistazo la
// proporción entre actas de acuerdo y de no acuerdo.
export function DonaActas({ acuerdo, noAcuerdo }: { acuerdo: number; noAcuerdo: number }) {
  const total = acuerdo + noAcuerdo;
  const R = 42;
  const C = 2 * Math.PI * R;
  const largoA = total > 0 ? (acuerdo / total) * C : 0;
  const largoN = total > 0 ? (noAcuerdo / total) * C : 0;
  const pct = (v: number) => (total > 0 ? Math.round((v / total) * 100) : 0);
  const forzarColor = { WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' } as React.CSSProperties;
  return (
    <div className="flex items-center gap-5">
      <div className="relative w-28 h-28 shrink-0">
        <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90" style={forzarColor}>
          <circle cx="50" cy="50" r={R} fill="none" stroke="#E6ECF5" strokeWidth="12" />
          {total > 0 && (
            <>
              <circle cx="50" cy="50" r={R} fill="none" stroke="#10B981" strokeWidth="12" strokeDasharray={`${largoA} ${C}`} strokeLinecap="butt" />
              <circle cx="50" cy="50" r={R} fill="none" stroke="#F59E0B" strokeWidth="12" strokeDasharray={`${largoN} ${C}`} strokeDashoffset={-largoA} strokeLinecap="butt" />
            </>
          )}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-2xl font-extrabold text-numa-900 tabular-nums leading-none">{total}</span>
          <span className="text-[10px] uppercase tracking-wide text-numa-500 mt-0.5">actas</span>
        </div>
      </div>
      <ul className="space-y-2 text-sm">
        <li className="flex items-center gap-2">
          <span className="w-3 h-3 rounded-full bg-emerald-500" style={forzarColor} />
          <span className="text-numa-700">De acuerdo</span>
          <span className="font-bold text-numa-900 tabular-nums">{acuerdo}</span>
          <span className="text-xs text-numa-500">({pct(acuerdo)}%)</span>
        </li>
        <li className="flex items-center gap-2">
          <span className="w-3 h-3 rounded-full bg-amber-500" style={forzarColor} />
          <span className="text-numa-700">De no acuerdo</span>
          <span className="font-bold text-numa-900 tabular-nums">{noAcuerdo}</span>
          <span className="text-xs text-numa-500">({pct(noAcuerdo)}%)</span>
        </li>
      </ul>
    </div>
  );
}

// ── BARRAS EN PAR (acuerdo / no acuerdo por nombre) ─────────────────────────
// Cada fila lleva el nombre completo UNA sola vez (sin cortarse) y debajo dos
// barras finas: verde = de acuerdo, ámbar = de no acuerdo. Reemplaza a las
// etiquetas largas "Nombre · de acuerdo" que se cortaban con "…".
export function BarrasPares({ filas }: { filas: { label: string; a: number; n: number }[] }) {
  const max = Math.max(...filas.flatMap((f) => [f.a, f.n]), 1);
  const forzarColor = { WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' } as React.CSSProperties;
  const ancho = (v: number) => `${v > 0 ? Math.max((v / max) * 100, 3) : 0}%`;
  return (
    <div>
      <div className="flex items-center gap-4 mb-2.5 text-[11px] text-numa-600">
        <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-emerald-500" style={forzarColor} />De acuerdo</span>
        <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-amber-500" style={forzarColor} />De no acuerdo</span>
      </div>
      <ul className="space-y-3">
        {filas.map((f) => (
          <li key={f.label}>
            <div className="flex items-baseline justify-between gap-3 mb-1">
              <span className="text-[13px] font-semibold text-numa-800 leading-tight break-words">{f.label}</span>
              <span className="text-[11px] text-numa-500 tabular-nums shrink-0">{f.a + f.n} en total</span>
            </div>
            <div className="space-y-1">
              {[{ v: f.a, c: '#10B981' }, { v: f.n, c: '#F59E0B' }].map((b, i) => (
                <div key={i} className="flex items-center gap-2">
                  <div className="flex-1 h-2 bg-numa-100 rounded-full overflow-hidden" style={forzarColor}>
                    <div className="h-full rounded-full" style={{ ...forzarColor, width: ancho(b.v), backgroundColor: b.c }} />
                  </div>
                  <span className="w-6 shrink-0 text-xs font-semibold text-numa-800 text-right tabular-nums">{b.v}</span>
                </div>
              ))}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ── ETIQUETA DE ESTADO (punto + texto) ───────────────────────────────────────
export function Pill({ label, pill, dot }: { label: string; pill: string; dot: string }) {
  return (
    <span className={clsx('pill', pill)}>
      <span className={clsx('pill-dot', dot)} aria-hidden="true" />
      {label}
    </span>
  );
}
