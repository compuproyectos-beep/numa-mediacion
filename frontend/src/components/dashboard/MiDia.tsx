'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { CalendarDays, CheckCircle2, ChevronRight, ListChecks } from 'lucide-react';
import { getCitas, getProcesos } from '@/lib/services';
import { accionProceso, citaYaPaso, hoyEcuador, sumarDias } from '@/lib/accionProceso';

// Panel para el mediador: lo primero que ve al entrar. Responde "¿qué me toca
// hoy?" — las invitaciones del día con su hora y los procesos que esperan
// algo de él — en vez de solo cifras.

const hora5 = (h?: string) => String(h || '').slice(0, 5);

const etiquetaDia = (fecha: string, hoy: string) => {
  if (fecha === hoy) return 'Hoy';
  if (fecha === sumarDias(hoy, 1)) return 'Mañana';
  const [a, m, d] = fecha.split('-');
  return `${d}/${m}/${a}`;
};

export default function MiDia({ esAdmin = false, miId }: { esAdmin?: boolean; miId?: number }) {
  const [citas, setCitas] = useState<any[] | null>(null);
  const [procesos, setProcesos] = useState<any[] | null>(null);
  const hoy = hoyEcuador();
  // Solo el administrador: ver lo suyo o lo de los demás mediadores.
  const [vista, setVista] = useState<'mios' | 'otros'>('mios');

  useEffect(() => {
    getCitas({ fecha_desde: hoy, fecha_hasta: sumarDias(hoy, 14) })
      .then(setCitas)
      .catch(() => setCitas([]));

    getProcesos()
      .then(setProcesos)
      .catch(() => setProcesos([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Mientras carga no se muestra nada (evita que la página "salte").
  if (citas === null || procesos === null) return null;

  const esDeOtro = (x: any) => esAdmin && miId != null && x.usuario_id !== miId;
  const verOtros = esAdmin && vista === 'otros';
  // Para el administrador, "mío" o "de otros" según la pestaña; el mediador
  // normal ya recibe solo lo suyo.
  const enVista = (x: any) => (!esAdmin ? true : verOtros ? esDeOtro(x) : !esDeOtro(x));

  const pendientes = citas.filter(
    (c) => (c.estado === 'pendiente' || c.estado === 'reagendada') && enVista(c)
  );
  const pendientesOtros = citas.filter(
    (c) =>
      esAdmin &&
      esDeOtro(c) &&
      (c.estado === 'pendiente' || c.estado === 'reagendada') &&
      String(c.fecha).slice(0, 10) === hoy
  ).length;
  const citasHoy = pendientes.filter((c) => String(c.fecha).slice(0, 10) === hoy);
  const proxima = pendientes.find((c) => String(c.fecha).slice(0, 10) > hoy);

  const porHacerOtros = esAdmin
    ? procesos.filter((p) => esDeOtro(p) && accionProceso(p, true).urgente).length
    : 0;
  const totalOtros = pendientesOtros + porHacerOtros;

  const porHacer = procesos
    .filter(enVista)
    .map((p) => ({ p, accion: accionProceso(p, esAdmin) }))
    .filter((x) => x.accion.urgente)
    .sort((a, b) => a.accion.prioridad - b.accion.prioridad || b.p.id - a.p.id);

  // Procesos con acta pendiente que esperan su turno en la fila (primero se
  // termina el más antiguo). Se muestran al final, en gris.
  const esperando = procesos
    .filter(enVista)
    .map((p) => ({ p, accion: accionProceso(p, esAdmin) }))
    .filter((x) => !x.accion.urgente && x.accion.texto === 'Esperando turno')
    .sort((a, b) => a.p.id - b.p.id);
  const lista = [...porHacer, ...esperando];

  const textoDia = new Intl.DateTimeFormat('es-EC', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'America/Guayaquil'
  }).format(new Date());
  // Solo la primera letra en mayúscula: "Lunes, 12 de octubre".
  const nombreDia = textoDia.charAt(0).toUpperCase() + textoDia.slice(1);

  const todoAlDia = citasHoy.length === 0 && porHacer.length === 0;

  return (
    <section aria-label="Mi día" className="space-y-2">
      {esAdmin && (
        <div className="inline-flex rounded-md border border-numa-200 bg-white p-0.5 text-xs font-semibold">
          <button
            type="button"
            onClick={() => setVista('mios')}
            className={`px-3 py-1 rounded ${
              vista === 'mios' ? 'bg-numa-800 text-white' : 'text-numa-600 hover:bg-numa-50'
            }`}
          >
            Mis pendientes
          </button>
          <button
            type="button"
            onClick={() => setVista('otros')}
            className={`px-3 py-1 rounded flex items-center gap-1.5 ${
              vista === 'otros' ? 'bg-numa-800 text-white' : 'text-numa-600 hover:bg-numa-50'
            }`}
          >
            De otros mediadores
            <span
              className={`min-w-[20px] text-center rounded-full px-1.5 ${
                vista === 'otros'
                  ? 'bg-white/25 text-white'
                  : totalOtros > 0
                  ? 'bg-gold-400 text-numa-950'
                  : 'bg-numa-100 text-numa-400'
              }`}
            >
              {totalOtros}
            </span>
          </button>
        </div>
      )}
    <div className="grid gap-3 lg:grid-cols-2">
      {/* Invitaciones de hoy */}
      <div className="card p-4">
        <div className="flex items-baseline justify-between gap-3 mb-2">
          <h2 className="text-sm font-bold uppercase tracking-wider text-numa-800 flex items-center gap-2">
            <CalendarDays className="w-4 h-4 text-gold-600" aria-hidden="true" />
            Invitaciones de hoy
          </h2>
          <span className="text-xs text-numa-500">{nombreDia}</span>
        </div>

        {citasHoy.length === 0 ? (
          <p className="text-sm text-numa-600 py-2">
            No tienes invitaciones hoy.
            {proxima && (
              <>
                {' '}
                La próxima es{' '}
                <strong className="text-numa-800">
                  {etiquetaDia(String(proxima.fecha).slice(0, 10), hoy).toLowerCase()} a las{' '}
                  {hora5(proxima.hora)}
                </strong>
                .
              </>
            )}
          </p>
        ) : (
          <ul className="space-y-1.5">
            {citasHoy.map((c) => {
              const paso = citaYaPaso(c.fecha, c.hora);
              const destino = c.proceso_id ? `/procesos/${c.proceso_id}` : '/agenda';

              return (
                <li key={c.id}>
                  <Link
                    href={destino}
                    className="flex items-center gap-3 min-h-[46px] px-3 py-2 rounded-md border border-numa-200 bg-white hover:border-gold-400 hover:bg-gold-50/40 transition-colors"
                  >
                    <span className="text-lg font-semibold text-numa-900 tabular-nums w-14 shrink-0">
                      {hora5(c.hora)}
                    </span>

                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium text-numa-900 truncate">
                        {c.demandante} <span className="text-numa-400 font-normal">vs</span>{' '}
                        {c.demandado}
                      </span>
                      <span className="block text-xs text-numa-500 truncate">
                        {verOtros ? `${c.mediador} · ` : ''}
                        {c.sucursal || '—'}
                        {paso ? ' · ya pasó la hora' : ''}
                      </span>
                    </span>

                    <span
                      className={`shrink-0 text-xs font-semibold px-2.5 py-1 rounded-full ${
                        paso
                          ? 'bg-amber-100 text-amber-800'
                          : 'bg-sky-100 text-sky-800'
                      }`}
                    >
                      {paso ? 'Registrar resultado' : 'Pendiente'}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Lo que toca hacer */}
      <div className="card p-4">
        <div className="flex items-baseline justify-between gap-3 mb-2">
          <h2 className="text-sm font-bold uppercase tracking-wider text-numa-800 flex items-center gap-2">
            <ListChecks className="w-4 h-4 text-gold-600" aria-hidden="true" />
            Por hacer
          </h2>
          {lista.length > 0 && (
            <span className="text-xs text-numa-500">
              {lista.length} {lista.length === 1 ? 'proceso' : 'procesos'}
            </span>
          )}
        </div>

        {lista.length === 0 ? (
          <div className="flex items-center gap-3 py-2">
            <CheckCircle2 className="w-6 h-6 text-emerald-600 shrink-0" aria-hidden="true" />
            <p className="text-sm text-numa-600">
              {todoAlDia
                ? 'Estás al día: no tienes nada pendiente por ahora.'
                : 'No tienes procesos pendientes por hacer.'}
            </p>
          </div>
        ) : (
          <ul className="space-y-1.5">
            {lista.slice(0, 5).map(({ p, accion }) => (
              <li key={p.id}>
                <Link
                  href={`/procesos/${p.id}`}
                  className="flex items-center gap-3 min-h-[46px] px-3 py-2 rounded-md border border-numa-200 bg-white hover:border-gold-400 hover:bg-gold-50/40 transition-colors"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium text-numa-900 truncate">
                      {p.demandante} <span className="text-numa-400 font-normal">vs</span>{' '}
                      {p.demandado}
                    </span>
                    <span className="block text-xs text-numa-500 truncate">
                      <span className="code-text">{p.codigo_proceso}</span>
                      {verOtros && <> · {p.usuario}</>}
                    </span>
                  </span>

                  <span
                    className={`shrink-0 inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full ${
                      accion.urgente
                        ? 'bg-gold-400 text-numa-950'
                        : 'bg-numa-100 text-numa-600'
                    }`}
                  >
                    {accion.texto}
                    <ChevronRight className="w-3.5 h-3.5" aria-hidden="true" />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}

        {lista.length > 5 && (
          <Link
            href="/procesos"
            className="mt-3 inline-block text-sm font-medium text-gold-700 hover:text-gold-800"
          >
            Ver los {lista.length} procesos
          </Link>
        )}
      </div>
    </div>
    </section>
  );
}
