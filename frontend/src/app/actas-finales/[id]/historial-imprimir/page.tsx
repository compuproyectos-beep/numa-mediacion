'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { getHistorialActaFinal } from '@/lib/services';
import { Printer } from 'lucide-react';

const primerNombre = (valor?: string) => (valor ? valor.trim().split(/\s+/)[0] : '');

const nombreCorto = (nombre?: string, apellido?: string) => {
  const n = primerNombre(nombre);
  const a = primerNombre(apellido);
  return [n, a].filter(Boolean).join(' ');
};

export default function ImprimirHistorialActaPage() {
  const params = useParams();
  const actaId = Number(params.id);

  const [data, setData] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!actaId) return;

    getHistorialActaFinal(actaId)
      .then(setData)
      .finally(() => setLoading(false));
  }, [actaId]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-numa-50 text-numa-500 text-sm">
        Cargando historial...
      </div>
    );
  }

  if (!data) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-numa-50 text-numa-500 text-sm">
        No se pudo cargar el historial.
      </div>
    );
  }

  const { acta, historial } = data;

  return (
    <main className="min-h-screen bg-numa-100 print:bg-white py-10 print:py-0">
      <div className="max-w-3xl mx-auto bg-white shadow-md print:shadow-none border border-numa-200 print:border-0 rounded-sm">
        {/* Encabezado tipo membrete */}
        <div className="border-b-2 border-gold-500 px-10 pt-8 pb-6">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-[11px] tracking-[0.2em] text-gold-600 font-semibold uppercase mb-1">
                Centro de Mediación
              </p>
              <h1 className="font-display text-2xl font-bold text-numa-900">
                NUMA
              </h1>
            </div>

            <button
              onClick={() => window.print()}
              className="print:hidden inline-flex items-center gap-2 px-4 py-2 bg-numa-900 text-numa-50 rounded-sm text-sm font-medium hover:bg-numa-950 transition-colors"
            >
              <Printer className="w-4 h-4" />
              Imprimir
            </button>
          </div>

          <div className="mt-6">
            <h2 className="font-display text-xl font-bold text-numa-900">
              Historial del Acta Final
            </h2>
            <p className="text-sm text-numa-500 mt-1">
              Acta{' '}
              <span className="font-semibold text-numa-800 code-text">
                {acta.codigo_acta}
              </span>
            </p>
          </div>
        </div>

        {/* Datos generales del acta */}
        <div className="px-10 pt-6">
          <div className="border border-numa-200 rounded-sm">
            <div className="grid grid-cols-1 sm:grid-cols-2 divide-y sm:divide-y-0 sm:divide-x divide-numa-200">
              <div className="p-4 space-y-3">
                <div>
                  <p className="text-[11px] uppercase tracking-wide text-numa-400">
                    PDF original
                  </p>
                  <p className="text-sm text-numa-800">
                    {acta.nombre_original || '—'}
                  </p>
                </div>

                <div>
                  <p className="text-[11px] uppercase tracking-wide text-numa-400">
                    Subido por
                  </p>
                  <p className="text-sm text-numa-800">
                    {acta.subido_por || '—'}
                  </p>
                </div>

                <div>
                  <p className="text-[11px] uppercase tracking-wide text-numa-400">
                    Fecha oficial
                  </p>
                  <p className="text-sm text-numa-800">
                    {acta.fecha_subida
                      ? new Date(acta.fecha_subida).toLocaleString('es-EC')
                      : '—'}
                  </p>
                </div>
              </div>

              <div className="p-4 space-y-3">
                <div>
                  <p className="text-[11px] uppercase tracking-wide text-numa-400">
                    Proceso
                  </p>
                  <p className="text-sm text-numa-800 code-text">
                    {acta.codigo_proceso || '—'}
                  </p>
                </div>

                <div>
                  <p className="text-[11px] uppercase tracking-wide text-numa-400">
                    Partes
                  </p>
                  <p className="text-sm text-numa-800">
                    {acta.demandante || '—'} vs {acta.demandado || '—'}
                  </p>
                </div>

                <div>
                  <p className="text-[11px] uppercase tracking-wide text-numa-400">
                    Ciudad / Sucursal
                  </p>
                  <p className="text-sm text-numa-800">
                    {acta.ciudad || '—'} / {acta.sucursal || '—'}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Reemplazos registrados */}
        <div className="px-10 py-6">
          <h3 className="font-display text-base font-bold text-numa-900 mb-4 pb-2 border-b border-numa-200">
            Reemplazos registrados
          </h3>

          {!historial || historial.length === 0 ? (
            <p className="text-sm text-numa-400 italic">
              No existen reemplazos registrados.
            </p>
          ) : (
            <div className="space-y-4">
              {historial.map((h: any, index: number) => (
                <div
                  key={h.id}
                  className="border border-numa-200 rounded-sm p-4 break-inside-avoid"
                >
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-sm font-semibold text-numa-900">
                      Reemplazo #{index + 1}
                    </p>
                    <p className="text-xs text-numa-400">
                      {h.fecha_accion
                        ? new Date(h.fecha_accion).toLocaleString('es-EC')
                        : '—'}
                    </p>
                  </div>

                  <p className="text-sm text-numa-700 whitespace-pre-wrap">
                    <span className="text-numa-500">Motivo: </span>
                    {h.motivo}
                  </p>

                  <p className="text-xs text-numa-400 mt-2">
                    Registrado por: {h.usuario || '—'}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Firmas */}
        <div className="px-10 pb-8 pt-4 break-inside-avoid">
          <h3 className="font-display text-base font-bold text-numa-900 mb-6 pb-2 border-b border-numa-200">
            Firmas
          </h3>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-8">
            {[
              {
                rol: 'Mediador',
                nombre: nombreCorto(acta.mediador_nombre, acta.mediador_apellido),
                cedula: acta.mediador_cedula
              },
              {
                rol: 'Solicitante',
                nombre: nombreCorto(acta.demandante_nombre, acta.demandante_apellido),
                cedula: acta.demandante_cedula
              },
              {
                rol: 'Invitado',
                nombre: nombreCorto(acta.demandado_nombre, acta.demandado_apellido),
                cedula: acta.demandado_cedula
              }
            ].map((firmante) => (
              <div key={firmante.rol} className="text-center">
                <div className="h-16 border-b border-numa-400" />
                <p className="text-sm font-semibold text-numa-900 mt-2">
                  {firmante.nombre || '—'}
                </p>
                <p className="text-xs text-numa-500">
                  C.I. {firmante.cedula || '—'}
                </p>
                <p className="text-[11px] uppercase tracking-wide text-numa-400 mt-1">
                  {firmante.rol}
                </p>
              </div>
            ))}
          </div>
        </div>

        {/* Pie de página */}
        <div className="px-10 py-4 border-t border-numa-200 text-center">
          <p className="text-[11px] text-numa-400">
            NUMA · Sistema Integral de Gestión de Mediación · Documento generado el{' '}
            {new Date().toLocaleDateString('es-EC')}
          </p>
        </div>
      </div>
    </main>
  );
}
