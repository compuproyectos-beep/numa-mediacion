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

// Controles "‹ Anterior  1–4 de 9  Siguiente ›". Si todo cabe en una página
// solo muestra el total.
function Paginador({
  total,
  pagina,
  porPagina,
  onCambiar,
  unidad,
  unidades
}: {
  total: number;
  pagina: number;
  porPagina: number;
  onCambiar: (p: number) => void;
  unidad: string;
  unidades: string;
}) {
  if (total === 0) return null;
  if (total <= porPagina) {
    return (
      <span className="text-xs text-numa-700">
        {total} {total === 1 ? unidad : unidades}
      </span>
    );
  }
  const ultima = Math.ceil(total / porPagina) - 1;
  const desde = pagina * porPagina;
  const boton =
    'px-1.5 py-0.5 rounded border border-numa-200 bg-white font-semibold hover:bg-numa-50 disabled:opacity-30 disabled:cursor-default';
  return (
    <span className="flex items-center gap-1.5 text-xs text-numa-700">
      <button type="button" onClick={() => onCambiar(pagina - 1)} disabled={pagina === 0} className={boton}>
        ‹ Anterior
      </button>
      <span className="tabular-nums">
        {desde + 1}–{Math.min(desde + porPagina, total)} de {total}
      </span>
      <button type="button" onClick={() => onCambiar(pagina + 1)} disabled={pagina >= ultima} className={boton}>
        Siguiente ›
      </button>
    </span>
  );
}

export default function MiDia({
  esAdmin = false,
  miId,
  vista = 'todos'
}: {
  esAdmin?: boolean;
  miId?: number;
  vista?: 'mios' | 'todos';
}) {
  const [citas, setCitas] = useState<any[] | null>(null);
  const [procesos, setProcesos] = useState<any[] | null>(null);
  const hoy = hoyEcuador();
  const [pagina, setPagina] = useState(0);
  const [paginaCitas, setPaginaCitas] = useState(0);
  const POR_PAGINA = 4;

  // Al cambiar entre "Mis cosas" y "Todos" se vuelve a la primera página.
  useEffect(() => {
    setPagina(0);
    setPaginaCitas(0);
  }, [vista]);

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
  // Administrador: "Mis cosas" muestra solo lo suyo; "Todos" muestra todo y
  // pone el nombre del mediador en cada fila. El mediador ya recibe solo lo suyo.
  const verOtros = esAdmin && vista === 'todos';
  const enVista = (x: any) => (!esAdmin || verOtros ? true : !esDeOtro(x));

  const pendientes = citas.filter(
    (c) => (c.estado === 'pendiente' || c.estado === 'reagendada') && enVista(c)
  );
  const citasHoy = pendientes.filter((c) => String(c.fecha).slice(0, 10) === hoy);
  const proxima = pendientes.find((c) => String(c.fecha).slice(0, 10) > hoy);

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

  // Invitaciones de hoy, también de 4 en 4.
  const paginaCitasAct = Math.min(paginaCitas, Math.max(0, Math.ceil(citasHoy.length / POR_PAGINA) - 1));
  const citasVisibles = citasHoy.slice(
    paginaCitasAct * POR_PAGINA,
    paginaCitasAct * POR_PAGINA + POR_PAGINA
  );

  // Se ven de 4 en 4, con flechas para pasar de página.
  const totalPaginas = Math.max(1, Math.ceil(lista.length / POR_PAGINA));
  const paginaActual = Math.min(pagina, totalPaginas - 1);
  const desde = paginaActual * POR_PAGINA;
  const visibles = lista.slice(desde, desde + POR_PAGINA);

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
    <div className="grid gap-3 lg:grid-cols-2">
      {/* Invitaciones de hoy */}
      <div className="card p-4">
        <div className="flex items-baseline justify-between gap-3 mb-2">
          <h2 className="text-sm font-bold uppercase tracking-wider text-numa-800 flex items-center gap-2">
            <CalendarDays className="w-4 h-4 text-gold-600" aria-hidden="true" />
            Invitaciones de hoy
          </h2>
          {citasHoy.length > POR_PAGINA ? (
            <Paginador
              total={citasHoy.length}
              pagina={paginaCitasAct}
              porPagina={POR_PAGINA}
              onCambiar={setPaginaCitas}
              unidad="invitación"
              unidades="invitaciones"
            />
          ) : (
            <span className="text-xs text-numa-700">{nombreDia}</span>
          )}
        </div>

        {citasHoy.length === 0 ? (
          <p className="text-sm text-numa-600 py-2">
            {verOtros ? 'No hay invitaciones hoy.' : 'No tienes invitaciones hoy.'}
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
            {citasVisibles.map((c) => {
              const paso = citaYaPaso(c.fecha, c.hora);
              // Una invitación rápida (sin proceso) abre directo su detalle en la Agenda.
              const destino = c.proceso_id
                ? `/procesos/${c.proceso_id}`
                : `/agenda?cita=${c.id}${c.usuario_id ? `&mediador=${c.usuario_id}` : ''}`;

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
                      <span className="block text-sm font-medium text-numa-900 break-words leading-snug">
                        {c.demandante} <span className="text-numa-600 font-normal">vs</span>{' '}
                        {c.demandado}
                      </span>
                      <span className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-0.5 text-xs text-numa-700">
                        {!c.proceso_id && (
                          <span className="shrink-0 font-bold text-gold-800 bg-gold-100 border border-gold-300 rounded px-1.5 py-0.5">
                            Invitación rápida
                          </span>
                        )}
                        <span className="break-words">
                          {verOtros ? `${c.mediador} · ${c.ciudad || '—'} · ` : ''}
                          {c.sucursal || '—'}
                          {paso ? ' · ya pasó la hora' : ''}
                        </span>
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
          <Paginador
            total={lista.length}
            pagina={paginaActual}
            porPagina={POR_PAGINA}
            onCambiar={setPagina}
            unidad="proceso"
            unidades="procesos"
          />
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
            {visibles.map(({ p, accion }) => (
              <li key={p.id}>
                <Link
                  href={`/procesos/${p.id}`}
                  className="flex items-center gap-3 min-h-[46px] px-3 py-2 rounded-md border border-numa-200 bg-white hover:border-gold-400 hover:bg-gold-50/40 transition-colors"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium text-numa-900 truncate">
                      {p.demandante} <span className="text-numa-600 font-normal">vs</span>{' '}
                      {p.demandado}
                    </span>
                    <span className="block text-xs text-numa-700 truncate">
                      <span className="code-text">{p.codigo_proceso}</span>
                      {verOtros && (
                        <>
                          {' '}· {p.usuario} · {p.ciudad || '—'} · {p.sucursal || '—'}
                        </>
                      )}
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

      </div>
    </div>
    </section>
  );
}
