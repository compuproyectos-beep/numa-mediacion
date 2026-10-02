'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { getExpedienteProceso } from '@/lib/services';
import { Printer } from 'lucide-react';

const primerNombre = (valor?: string) => (valor ? valor.trim().split(/\s+/)[0] : '');

const nombreCorto = (nombre?: string, apellido?: string) => {
  const n = primerNombre(nombre);
  const a = primerNombre(apellido);
  return [n, a].filter(Boolean).join(' ');
};

const getEstadoLabel = (estado: string) => {
  const labels: any = {
    en_negociacion: 'En negociación',
    cerrado_con_acuerdo: 'Cerrado con acuerdo',
    cerrado_sin_acuerdo: 'Cerrado sin acuerdo',
    archivado: 'Archivado'
  };

  return labels[estado] || estado;
};

export default function ImprimirExpedientePage() {
  const params = useParams();
  const procesoId = Number(params.id);

  const [data, setData] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!procesoId) return;

    getExpedienteProceso(procesoId)
      .then(setData)
      .finally(() => setLoading(false));
  }, [procesoId]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-numa-50 text-numa-500 text-sm">
        Cargando expediente...
      </div>
    );
  }

  if (!data) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-numa-50 text-numa-500 text-sm">
        No se pudo cargar el expediente.
      </div>
    );
  }

  const { proceso, linea_tiempo, acta_final, historial_pdf } = data;

  return (
    <main className="min-h-screen bg-numa-100 print:bg-white py-10 print:py-0">
      <div className="max-w-3xl mx-auto bg-white shadow-md print:shadow-none border border-numa-200 print:border-0 rounded-sm">
        {/* Encabezado tipo membrete. El logo y el nombre van centrados en
            la hoja; el botón de Imprimir queda flotando aparte (y
            desaparece al imprimir). */}
        <div className="border-b-2 border-gold-500 px-10 pt-8 pb-6 relative">
          <button
            onClick={() => window.print()}
            className="print:hidden absolute top-8 right-10 inline-flex items-center gap-2 px-4 py-2 bg-numa-900 text-numa-50 rounded-sm text-sm font-medium hover:bg-numa-950 transition-colors"
          >
            <Printer className="w-4 h-4" />
            Imprimir
          </button>

          <div className="flex items-center justify-center gap-3 text-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/images/logo-numa-claro.jpg"
              alt="Centro de Mediación NUMA"
              className="h-20 w-auto object-contain"
            />

            <div>
              <p className="text-[11px] tracking-[0.2em] text-gold-600 font-semibold uppercase mb-1">
                Centro de Mediación
              </p>
              <h1 className="font-display text-2xl font-bold text-numa-900">
                NUMA
              </h1>
            </div>
          </div>

          <div className="mt-6 flex items-center justify-between flex-wrap gap-2">
            <div>
              <h2 className="font-display text-xl font-bold text-numa-900">
                Expediente de Mediación
              </h2>
              <p className="text-sm text-numa-500 mt-1">
                Proceso{' '}
                <span className="font-semibold text-numa-800 code-text">
                  {proceso.codigo_proceso}
                </span>
              </p>
            </div>

            <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold bg-gold-500/10 text-gold-700 border border-gold-500/30">
              {getEstadoLabel(proceso.estado)}
            </span>
          </div>
        </div>

        {/* Datos generales del proceso */}
        <div className="px-10 pt-6">
          <div className="border border-numa-200 rounded-sm">
            <div className="grid grid-cols-1 sm:grid-cols-2 divide-y sm:divide-y-0 sm:divide-x divide-numa-200">
              <div className="p-4 space-y-3">
                <div>
                  <p className="text-[11px] uppercase tracking-wide text-numa-400">
                    Solicitante
                  </p>
                  <p className="text-sm text-numa-800">{proceso.demandante}</p>
                </div>

                <div>
                  <p className="text-[11px] uppercase tracking-wide text-numa-400">
                    Invitado
                  </p>
                  <p className="text-sm text-numa-800">{proceso.demandado}</p>
                </div>

                <div>
                  <p className="text-[11px] uppercase tracking-wide text-numa-400">
                    Mediador
                  </p>
                  <p className="text-sm text-numa-800">{proceso.mediador}</p>
                </div>
              </div>

              <div className="p-4 space-y-3">
                <div>
                  <p className="text-[11px] uppercase tracking-wide text-numa-400">
                    Ciudad / Sucursal
                  </p>
                  <p className="text-sm text-numa-800">
                    {proceso.ciudad} / {proceso.sucursal}
                  </p>
                </div>

                <div>
                  <p className="text-[11px] uppercase tracking-wide text-numa-400">
                    Tema
                  </p>
                  <p className="text-sm text-numa-800">{proceso.tema}</p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Línea de tiempo */}
        <div className="px-10 py-6">
          <h3 className="font-display text-base font-bold text-numa-900 mb-4 pb-2 border-b border-numa-200">
            Línea de tiempo
          </h3>

          <div className="space-y-4">
            {linea_tiempo?.map((item: any, index: number) => (
              <div
                key={item.id}
                className="border border-numa-200 rounded-sm p-4 break-inside-avoid"
              >
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm font-semibold text-numa-900">
                    Invitación #{index + 1}
                  </p>
                  <p className="text-xs text-numa-400">
                    {item.fecha} {item.hora?.slice(0, 5)} · {item.estado}
                  </p>
                </div>

                {item.creado_por && (
                  <p className="text-xs text-numa-400">
                    Invitación creada por: {item.creado_por}
                  </p>
                )}

                {item.observaciones && (
                  <p className="text-sm text-numa-700">
                    <span className="text-numa-500">Observación invitación: </span>
                    {item.observaciones}
                  </p>
                )}

                {item.resultado && (
                  <div className="mt-3 pt-3 border-t border-numa-100">
                    <p className="text-sm font-medium text-numa-800">
                      {getEstadoLabel(item.resultado)}
                    </p>

                    <p className="text-sm text-numa-700 mt-1">
                      <span className="text-numa-500">Registro / observación: </span>
                      {item.avance_observacion}
                    </p>

                    <p className="text-xs text-numa-400 mt-2">
                      Registrado por: {item.usuario_avance || '—'}
                    </p>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Acta final */}
        {acta_final && (
          <div className="px-10 pb-6">
            <div className="border border-green-200 bg-green-50/50 rounded-sm p-4">
              <p className="text-sm font-semibold text-green-800 mb-2">
                Acta final
              </p>

              <p className="text-sm text-green-700">
                Código acta:{' '}
                <span className="font-semibold code-text">
                  {acta_final.codigo_acta}
                </span>
              </p>

              <p className="text-sm text-green-700 mt-1">
                Subido por: {acta_final.subido_por}
              </p>

              <p className="text-sm text-green-700 mt-1">
                Fecha oficial:{' '}
                {new Date(acta_final.fecha_subida).toLocaleString('es-EC')}
              </p>

              {acta_final.nombre_comprobante_pago && (
                <p className="text-sm text-green-700 mt-1">
                  Comprobante de pago: {acta_final.nombre_comprobante_pago}
                </p>
              )}
            </div>
          </div>
        )}

        {/* Firmas */}
        <div className="px-10 pb-8 pt-4 break-inside-avoid">
          <h3 className="font-display text-base font-bold text-numa-900 mb-6 pb-2 border-b border-numa-200">
            Firmas
          </h3>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-8">
            {[
              {
                rol: 'Mediador',
                nombre: nombreCorto(proceso.mediador_nombre, proceso.mediador_apellido),
                cedula: proceso.mediador_cedula
              },
              {
                rol: 'Solicitante',
                nombre: nombreCorto(proceso.demandante_nombre, proceso.demandante_apellido),
                cedula: proceso.demandante_cedula
              },
              {
                rol: 'Invitado',
                nombre: nombreCorto(proceso.demandado_nombre, proceso.demandado_apellido),
                cedula: proceso.demandado_cedula
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
