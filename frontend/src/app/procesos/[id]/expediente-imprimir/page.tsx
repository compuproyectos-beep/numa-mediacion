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
    archivado: 'Archivado',
    anulado: 'Anulado'
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

  // Por lado: todos los responsables (con su empresa) y, si hay otras
  // partes que no son responsables, "y más".
  const partes: any[] = data.partes || [];
  const nombreParte = (p: any) => {
    // Cliente tipo empresa: el responsable es su representante.
    if (p.tipo === 'empresa') {
      const emp = (p.razon_social || p.nombre || '').trim();
      const rep = (p.representante_nombre || '').trim();
      return rep ? `${rep} — en representación de ${emp}` : emp;
    }
    return (
      `${p.nombre} ${p.apellido || ''}`.trim() +
      (p.empresa_nombre ? ` — en representación de ${p.empresa_nombre}` : '')
    );
  };
  const listaPartes = (rol: string, respaldo: string) => {
    const lado = partes.filter((p) => p.rol === rol);
    if (lado.length === 0) return [respaldo];
    let resp = lado.filter((p) => p.es_responsable);
    if (resp.length === 0) resp = [lado[0]];
    const hayMas = lado.length > resp.length;
    const nombres = resp.map(nombreParte);
    if (hayMas) nombres[nombres.length - 1] += ' y más';
    return nombres;
  };

  return (
    <main className="min-h-screen bg-numa-100 print:bg-white py-10 print:py-0">
      <div className="max-w-[760px] mx-auto bg-white shadow-md print:shadow-none border border-numa-200 print:border-0 rounded-sm">
        {/* Encabezado tipo membrete. El logo y el nombre van centrados en
            la hoja; el botón de Imprimir queda flotando aparte (y
            desaparece al imprimir). */}
        <div className="border-b-2 border-gold-500 px-8 pt-5 pb-3 relative">
          <button
            onClick={() => window.print()}
            className="print:hidden absolute top-5 right-8 inline-flex items-center gap-2 px-3 py-1.5 bg-numa-900 text-numa-50 rounded-sm text-sm font-medium hover:bg-numa-950 transition-colors"
          >
            <Printer className="w-4 h-4" />
            Imprimir
          </button>

          <div className="flex items-center justify-center gap-3 text-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/images/logo-numa-simbolo.png"
              alt="Logo NUMA"
              className="h-10 w-10 object-contain"
            />

            <div>
              <p className="text-[11px] tracking-[0.2em] text-gold-600 font-semibold uppercase mb-0.5">
                Centro de Mediación
              </p>
              <h1 className="font-display text-xl font-bold text-numa-900 leading-tight">
                NUMA
              </h1>
            </div>
          </div>

          <div className="mt-3 flex items-center justify-between flex-wrap gap-2">
            <div>
              <h2 className="font-display text-base font-bold text-numa-900">
                Expediente de Mediación
              </h2>
            </div>

            <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold bg-gold-500/10 text-gold-700 border border-gold-500/30">
              {getEstadoLabel(proceso.estado)}
            </span>
          </div>
        </div>

        {/* Datos generales del proceso */}
        <div className="px-8 pt-3">
          <div className="border border-numa-200 rounded-sm">
            <div className="grid grid-cols-1 sm:grid-cols-2 divide-y sm:divide-y-0 sm:divide-x divide-numa-200">
              <div className="px-3 py-2 space-y-1.5">
                <div>
                  <p className="text-[11px] uppercase tracking-wide text-numa-400">
                    Solicitante(s)
                  </p>
                  {listaPartes('solicitante', proceso.demandante).map((n, i) => (
                    <p key={i} className="text-sm text-numa-800">{n}</p>
                  ))}
                </div>

                <div>
                  <p className="text-[11px] uppercase tracking-wide text-numa-400">
                    Invitado(s)
                  </p>
                  {listaPartes('invitado', proceso.demandado).map((n, i) => (
                    <p key={i} className="text-sm text-numa-800">{n}</p>
                  ))}
                </div>

                <div>
                  <p className="text-[11px] uppercase tracking-wide text-numa-400">
                    Mediador
                  </p>
                  <p className="text-sm text-numa-800">{proceso.mediador}</p>
                </div>
              </div>

              <div className="px-3 py-2 space-y-1.5">
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
        <div className="px-8 py-3">
          <h3 className="font-display text-sm font-bold text-numa-900 mb-2 pb-1 border-b border-numa-200">
            Línea de tiempo
          </h3>

          <div className="space-y-2">
            {linea_tiempo?.map((item: any, index: number) => (
              <div
                key={item.id}
                className="border border-numa-200 rounded-sm px-3 py-2 break-inside-avoid"
              >
                <div className="flex items-center justify-between mb-1">
                  <p className="text-sm font-semibold text-numa-900">
                    Invitación #{index + 1}
                  </p>
                  <p className="text-xs text-numa-400">
                    {item.fecha} {item.hora?.slice(0, 5)} · {item.estado}
                  </p>
                </div>

                {item.observaciones && (
                  <p className="text-sm text-numa-700">
                    <span className="text-numa-500">Observación invitación: </span>
                    {item.observaciones}
                  </p>
                )}

                {item.creado_por && (
                  <p className="text-xs text-numa-400 mt-1">
                    Invitación creada por: {item.creado_por}
                  </p>
                )}

                {item.estado === 'cancelada' && item.motivo_cancelacion && (
                  <p className="text-sm text-red-700 mt-1">
                    <span className="text-numa-500">Motivo de cancelación: </span>
                    {item.motivo_cancelacion}
                  </p>
                )}

                {item.resultado && (
                  <div className="mt-2 pt-2 border-t border-numa-100">
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
          <div className="px-8 pb-3">
            <div className="border border-green-200 bg-green-50/50 rounded-sm px-3 py-2">
              <p className="text-sm font-semibold text-green-800 mb-1">
                Documentos del acta
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
                {new Date(acta_final.fecha_subida).toLocaleString('es-EC', {
                  day: '2-digit', month: '2-digit', year: 'numeric',
                  hour: 'numeric', minute: '2-digit'
                })}
              </p>

              {acta_final.nombre_comprobante_pago && (
                <p className="text-sm text-green-700 mt-1">
                  Comprobante de pago: {acta_final.nombre_comprobante_pago}
                </p>
              )}
            </div>
          </div>
        )}

        {/* Firma: solo la del mediador (las partes ya no firman el expediente) */}
        <div className="px-8 pb-4 pt-2 break-inside-avoid">
          <h3 className="font-display text-sm font-bold text-numa-900 mb-3 pb-1 border-b border-numa-200">
            Firma del mediador
          </h3>

          <div className="flex justify-center">
            <div className="w-full max-w-xs text-center">
              <div className="h-12 border-b border-numa-400" />
              <p className="text-sm font-semibold text-numa-900 mt-2">
                {nombreCorto(proceso.mediador_nombre, proceso.mediador_apellido) || '—'}
              </p>
              <p className="text-xs text-numa-500">
                C.I. {proceso.mediador_cedula || '—'}
              </p>
              <p className="text-[11px] uppercase tracking-wide text-numa-400 mt-1">
                Mediador
              </p>
            </div>
          </div>
        </div>

        {/* Pie de página */}
        <div className="px-8 py-2 border-t border-numa-200 text-center">
          <p className="text-[11px] text-numa-400">
            NUMA · Sistema Integral de Gestión de Mediación · Documento generado el{' '}
            {new Date().toLocaleDateString('es-EC')}
          </p>
        </div>
      </div>
    </main>
  );
}
