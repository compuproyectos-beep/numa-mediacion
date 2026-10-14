'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { Printer } from 'lucide-react';
import { getDatosActa } from '@/lib/services';

const fmtFecha = (v?: string) => {
  if (!v) return '—';
  // La fecha del acuerdo viene sin zona horaria (UTC): se marca como UTC y se
  // muestra en hora de Ecuador.
  const iso = v.replace(' ', 'T');
  const d = new Date(/(Z|[+-]\d\d:?\d\d)$/.test(iso) ? iso : `${iso}Z`);
  return isNaN(d.getTime())
    ? '—'
    : d.toLocaleDateString('es-EC', {
        day: '2-digit',
        month: 'long',
        year: 'numeric',
        timeZone: 'America/Guayaquil'
      });
};

const nombreCompleto = (p: any) => `${p.nombre} ${p.apellido || ''}`.trim();

// Quién firma por cada parte: la persona, o el representante legal si la
// parte es una empresa. Si una persona actúa en representación de una
// empresa, firma ella y se indica la empresa.
const datosFirma = (p: any) => {
  if (p.tipo === 'empresa') {
    return {
      nombre: p.representante_nombre || '—',
      cedula: p.representante_cedula,
      detalle: `Representante legal de ${p.nombre} (RUC ${p.ruc || '—'})`
    };
  }
  return {
    nombre: nombreCompleto(p),
    cedula: p.cedula,
    detalle: p.empresa_nombre
      ? `En representación de ${p.empresa_nombre}${p.empresa_ruc ? ` (RUC ${p.empresa_ruc})` : ''}`
      : ''
  };
};

export default function ImprimirActaPage() {
  const params = useParams();
  const procesoId = Number(params.id);

  const [data, setData] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!procesoId) return;

    getDatosActa(procesoId)
      .then(setData)
      .catch((e) => setError(e?.response?.data?.detail || 'No se pudo cargar el acta.'))
      .finally(() => setLoading(false));
  }, [procesoId]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-numa-50 text-numa-500 text-sm">
        Cargando acta...
      </div>
    );
  }

  if (!data) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-numa-50 text-numa-500 text-sm px-6 text-center">
        {error || 'No se pudo cargar el acta.'}
      </div>
    );
  }

  const { proceso, partes } = data;
  const solicitantes = partes.filter((p: any) => p.rol === 'solicitante');
  const invitados = partes.filter((p: any) => p.rol === 'invitado');
  const mediador = `${proceso.mediador_nombre} ${proceso.mediador_apellido}`.trim();
  // Acta de no acuerdo: firman solo el solicitante y el mediador, y el
  // mediador certifica que las partes no llegaron a un acuerdo.
  const noAcuerdo = proceso.estado === 'cerrado_sin_acuerdo';
  const fechaActa = noAcuerdo
    ? proceso.fecha_cierre_sin_acuerdo || proceso.fecha_acta
    : proceso.fecha_acuerdo;

  const bloquePartes = (titulo: string, lista: any[]) => (
    <div className="mb-4">
      <p className="text-[11px] uppercase tracking-wide text-numa-400 mb-1">{titulo}</p>
      <ul className="space-y-1">
        {lista.map((p: any) => (
          <li key={p.id} className="text-sm text-numa-800">
            <span className="font-medium">{nombreCompleto(p)}</span>
            {p.es_responsable && lista.length > 1 ? ' (responsable)' : ''}
            {p.tipo === 'empresa'
              ? ` — RUC ${p.ruc || '—'}; representante legal: ${p.representante_nombre || '—'}${
                  p.representante_cedula ? ` (C.I. ${p.representante_cedula})` : ''
                }`
              : ` — C.I. ${p.cedula || '—'}`}
            {p.empresa_nombre ? `, en representación de ${p.empresa_nombre}` : ''}
          </li>
        ))}
      </ul>
    </div>
  );

  const firma = (key: string, nombre: string, cedula: string | null, detalle: string, rol: string) => (
    <div key={key} className="break-inside-avoid text-center">
      <div className="h-16 border-b border-numa-400" />
      <p className="text-sm font-semibold text-numa-900 mt-2">{nombre}</p>
      <p className="text-xs text-numa-500">C.I. {cedula || '—'}</p>
      {detalle && <p className="text-[11px] text-numa-500">{detalle}</p>}
      <p className="text-[11px] uppercase tracking-wide text-numa-400 mt-1">{rol}</p>
    </div>
  );

  return (
    <main className="min-h-screen bg-numa-100 print:bg-white py-10 print:py-0">
      <div className="max-w-3xl mx-auto bg-white shadow-md print:shadow-none border border-numa-200 print:border-0 rounded-sm">
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
              src="/images/logo-numa-simbolo.png"
              alt="Logo NUMA"
              className="h-14 w-14 object-contain"
            />
            <div>
              <p className="text-[11px] tracking-[0.2em] text-gold-600 font-semibold uppercase mb-1">
                Centro de Mediación
              </p>
              <h1 className="font-display text-2xl font-bold text-numa-900">NUMA</h1>
            </div>
          </div>

          <div className="mt-6 text-center">
            <h2 className="font-display text-xl font-bold text-numa-900">
              {noAcuerdo ? 'Acta de No Acuerdo' : 'Acta de Mediación'}
            </h2>
            <p className="text-sm text-numa-600 mt-1">
              Código: <span className="font-semibold code-text">{proceso.codigo_acta || '—'}</span>
            </p>
          </div>
        </div>

        <div className="px-10 pt-6 pb-2">
          <p className="text-sm text-numa-700 mb-5">
            En la ciudad de {proceso.ciudad}, sucursal {proceso.sucursal}, con fecha{' '}
            {fmtFecha(fechaActa)}, ante el mediador{' '}
            <strong>{mediador}</strong>, comparecen las siguientes partes:
          </p>

          {bloquePartes('Solicitante(s)', solicitantes)}
          {bloquePartes('Invitado(s)', invitados)}

          <div className="mb-4">
            <p className="text-[11px] uppercase tracking-wide text-numa-400 mb-1">Tema</p>
            <p className="text-sm text-numa-800 whitespace-pre-line">{proceso.tema}</p>
          </div>

          <div className="mb-6">
            <p className="text-[11px] uppercase tracking-wide text-numa-400 mb-1">
              {noAcuerdo ? 'Resultado: no acuerdo' : 'Resultado: acuerdo'}
            </p>
            <div className="border border-numa-200 rounded-sm p-4 text-sm text-numa-800 whitespace-pre-line">
              {noAcuerdo
                ? 'El mediador certifica que, habiéndose llevado a cabo el proceso de mediación, las partes no llegaron a un acuerdo.' +
                  (proceso.observacion_cierre ? `\n\n${proceso.observacion_cierre}` : '')
                : proceso.acuerdo_texto || '—'}
            </div>
          </div>

          <p className="text-sm text-numa-700 mb-2">
            {noAcuerdo
              ? solicitantes.length > 1
                ? 'Leída el acta, los solicitantes se ratifican en su contenido y la firman junto con el mediador.'
                : 'Leída el acta, el solicitante se ratifica en su contenido y la firma junto con el mediador.'
              : 'Leída el acta, las partes se ratifican en su contenido y la firman junto con el mediador.'}
          </p>
        </div>

        <div className="px-10 pb-8 pt-4">
          <h3 className="font-display text-base font-bold text-numa-900 mb-6 pb-2 border-b border-numa-200">
            Firmas
          </h3>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-10 gap-y-12">
            {(noAcuerdo ? solicitantes : [...solicitantes, ...invitados]).map((p: any) => {
              const f = datosFirma(p);
              return firma(
                `p-${p.id}`,
                f.nombre,
                f.cedula,
                f.detalle,
                p.rol === 'solicitante' ? 'Solicitante' : 'Invitado'
              );
            })}
            {firma('mediador', mediador, proceso.mediador_cedula, '', 'Mediador')}
          </div>
        </div>

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
