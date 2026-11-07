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
      <div>
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
      </div>
      <ListaSugerencias
        items={items}
        onElegir={(c) => {
          onChange(String(c.id));
          setTexto(etiquetaSugerencia(c));
          setAbierto(false);
        }}
      />
      {abierto && !elegido && hayTexto && items.length === 0 && (
        <p className="text-xs text-numa-600">No hay coincidencias. Puedes crear un cliente nuevo.</p>
      )}
      <button type="button" className="text-[13px] font-medium underline text-numa-800" onClick={onNuevo}>
        {textoNuevo}
      </button>
    </div>
  );
}
