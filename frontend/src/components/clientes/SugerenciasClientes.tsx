'use client';

import { useEffect, useState } from 'react';

const norm = (t: string) =>
  (t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

export const etiquetaSugerencia = (c: any) =>
  c.tipo === 'empresa'
    ? `${c.razon_social || c.nombre} · RUC ${c.ruc || '—'}${c.representante_nombre ? ` · Rep.: ${c.representante_nombre}` : ''}`
    : `${c.nombre} ${c.apellido || ''}`.trim() + ` · C.I. ${c.cedula || '—'}`;

// Busca clientes ya registrados mientras se escribe: por cédula o RUC (si son
// números) o por nombre, apellido, razón social o representante (si es texto).
export function buscarClientes(
  clientes: any[],
  texto: string,
  tipo?: 'persona' | 'empresa',
  max = 6
): any[] {
  const v = norm(texto);
  if (!v) return [];
  const soloNumeros = /^\d+$/.test(v);
  if (soloNumeros ? v.length < 3 : v.length < 2) return [];
  return clientes
    .filter((c) => !tipo || (c.tipo === 'empresa') === (tipo === 'empresa'))
    .filter((c) => {
      if (soloNumeros) {
        return [c.cedula, c.ruc, c.representante_cedula].some((x) => String(x || '').startsWith(v));
      }
      const t = norm(`${c.nombre || ''} ${c.apellido || ''} ${c.razon_social || ''} ${c.representante_nombre || ''}`);
      return v.split(/\s+/).every((p) => t.includes(p));
    })
    .slice(0, max);
}

// Lista flotante pegada a la casilla en la que se escribe: no mueve el
// formulario. Flechas arriba/abajo para moverse, Enter acepta (la primera si
// no se movió), Escape la cierra.
export function Sugerente({
  items,
  onElegir,
  etiqueta = etiquetaSugerencia,
  children,
}: {
  items: any[];
  onElegir: (c: any) => void;
  etiqueta?: (c: any) => string;
  children: React.ReactNode;
}) {
  const [idx, setIdx] = useState(-1);
  const [cerrado, setCerrado] = useState(false);
  const clave = items.map((c) => c.id).join(',');
  useEffect(() => {
    setIdx(-1);
    setCerrado(false);
  }, [clave]);
  const abierto = items.length > 0 && !cerrado;

  const teclas = (e: React.KeyboardEvent) => {
    if (!abierto) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setIdx((i) => (i + 1) % items.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setIdx((i) => (i <= 0 ? items.length - 1 : i - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      onElegir(items[idx >= 0 ? idx : 0]);
    } else if (e.key === 'Escape') {
      setCerrado(true);
    }
  };

  return (
    <div className="relative" onKeyDown={teclas}>
      {children}
      {abierto && (
        <div
          role="listbox"
          className="absolute left-0 top-full z-30 mt-1 w-max min-w-full max-w-[min(26rem,85vw)] rounded-xl border border-numa-200 bg-white shadow-lg overflow-hidden"
        >
          {items.map((c, n) => (
            <button
              key={c.id}
              type="button"
              role="option"
              aria-selected={n === idx}
              onMouseDown={(e) => {
                e.preventDefault();
                onElegir(c);
              }}
              onMouseEnter={() => setIdx(n)}
              className={`block w-full text-left px-3 py-2 text-sm text-numa-900 border-t first:border-t-0 border-numa-100 ${
                n === idx ? 'bg-gold-50' : 'hover:bg-gold-50'
              }`}
            >
              {etiqueta(c)}
            </button>
          ))}
          <p className="px-3 py-1 text-[11px] text-numa-500 bg-numa-50">
            Ya registrados · Enter para elegir · sigue escribiendo para filtrar
          </p>
        </div>
      )}
    </div>
  );
}

export function ListaSugerencias({
  items,
  onElegir,
  etiqueta = etiquetaSugerencia,
}: {
  items: any[];
  onElegir: (c: any) => void;
  etiqueta?: (c: any) => string;
}) {
  if (!items.length) return null;
  return (
    <div className="rounded-xl border border-numa-200 bg-white shadow-sm overflow-hidden">
      <p className="px-3 py-1.5 text-xs text-numa-500 bg-numa-50">
        Ya registrados en el sistema: toca uno para usarlo, o sigue escribiendo.
      </p>
      {items.map((c) => (
        <button
          key={c.id}
          type="button"
          onMouseDown={(e) => {
            e.preventDefault();
            onElegir(c);
          }}
          className="block w-full text-left px-3 py-2 text-sm text-numa-900 hover:bg-gold-50 border-t border-numa-100"
        >
          {etiqueta(c)}
        </button>
      ))}
    </div>
  );
}

// Reemplaza la lista desplegable larga de clientes: se escribe el nombre, la
// cédula o el RUC y salen las opciones para elegir.
export function BuscadorCliente({
  label,
  clientes,
  value,
  onChange,
  onNuevo,
  textoNuevo = '+ Cliente nuevo (persona)',
}: {
  label: string;
  clientes: any[];
  value: string;
  onChange: (id: string) => void;
  onNuevo: () => void;
  textoNuevo?: string;
}) {
  const elegido = value ? clientes.find((c) => String(c.id) === String(value)) : null;
  const [texto, setTexto] = useState('');
  const [abierto, setAbierto] = useState(false);

  useEffect(() => {
    setTexto(elegido ? etiquetaSugerencia(elegido) : value ? texto : '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, clientes.length]);

  const items = abierto && !elegido ? buscarClientes(clientes, texto) : [];
  const hayTexto = norm(texto).length >= 2;

  return (
    <div className="space-y-2">
      <Sugerente
        items={items}
        onElegir={(c) => {
          onChange(String(c.id));
          setTexto(etiquetaSugerencia(c));
          setAbierto(false);
        }}
      >
        <label className="label">{label}</label>
        <div className="flex gap-2">
          <input
            className="input-field"
            value={texto}
            placeholder="Escribe el nombre, la cédula o el RUC"
            autoComplete="off"
            onFocus={() => setAbierto(true)}
            onBlur={() => setAbierto(false)}
            onChange={(e) => {
              setTexto(e.target.value);
              setAbierto(true);
              if (value) onChange('');
            }}
          />
          {elegido && (
            <button
              type="button"
              className="btn-secondary btn-sm shrink-0"
              onClick={() => {
                onChange('');
                setTexto('');
              }}
            >
              Cambiar
            </button>
          )}
        </div>
      </Sugerente>
      {abierto && !elegido && hayTexto && items.length === 0 && (
        <p className="text-xs text-numa-600">No hay coincidencias. Puedes crear un cliente nuevo.</p>
      )}
      <button type="button" className="text-[13px] font-medium underline text-numa-800" onClick={onNuevo}>
        {textoNuevo}
      </button>
    </div>
  );
}
