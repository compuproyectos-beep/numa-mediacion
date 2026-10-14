'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { Printer, ArrowLeft } from 'lucide-react';
import Link from 'next/link';
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

const PIE_MATRIZ =
  'Calles Tulcán y Babahoyo, Edif. Andrade,\nPrimer piso, Oficinas 101-107\nSanto Domingo, Ecuador';
const CORREO_DEFECTO = 'numacentromediacion@gmail.com';
// Medidas de la hoja (mm), iguales a las de la invitación.
const ESPACIO_SUP = 50;
const ESPACIO_INF = 38;
const MARGEN_LAT = 20;

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

  // El nombre del archivo al guardar como PDF sale del título de la página.
  useEffect(() => {
    if (data?.proceso?.codigo_acta) {
      document.title = `${data.proceso.estado === 'cerrado_sin_acuerdo' ? 'Acta de no acuerdo' : 'Acta de mediación'} ${data.proceso.codigo_acta}`;
    }
  }, [data]);

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
  // Acta de no acuerdo: firman todas las partes y el mediador, y el
  // mediador certifica que las partes no llegaron a un acuerdo.
  const noAcuerdo = proceso.estado === 'cerrado_sin_acuerdo';
  const fechaActa = noAcuerdo
    ? proceso.fecha_cierre_sin_acuerdo || proceso.fecha_acta
    : proceso.fecha_acuerdo;

  const esMatriz = /santo domingo/i.test(proceso.ciudad || '');
  const pie = esMatriz
    ? PIE_MATRIZ
    : `${proceso.sucursal_direccion || ''}\n${proceso.ciudad || ''}, Ecuador`.trim();
  const telefono = proceso.mediador_telefono || proceso.sucursal_telefono || '';
  const correo = proceso.mediador_email || CORREO_DEFECTO;

  const estiloPie: React.CSSProperties = {
    position: 'absolute',
    fontFamily: "'Open Sans', Arial, sans-serif",
    fontWeight: 700,
    fontSize: '7.6pt',
    lineHeight: 1.45,
    color: '#1f2a7a',
    textAlign: 'left'
  };

  const pDefault: React.CSSProperties = { margin: '0 0 3.2mm' };
  const etiqueta: React.CSSProperties = {
    margin: '0 0 1mm',
    fontSize: '8.5pt',
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    color: '#555'
  };

  const bloquePartes = (titulo: string, lista: any[]) => (
    <div style={{ marginBottom: '4mm' }}>
      <p style={etiqueta}>{titulo}</p>
      <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
        {lista.map((p: any) => (
          <li key={p.id} style={{ marginBottom: '1.5mm' }}>
            <strong>{nombreCompleto(p)}</strong>
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
    <div key={key} style={{ breakInside: 'avoid', pageBreakInside: 'avoid', textAlign: 'center' }}>
      <div style={{ height: '16mm', borderBottom: '1px solid #444' }} />
      <p style={{ margin: '2mm 0 0', fontWeight: 700 }}>{nombre}</p>
      <p style={{ margin: 0, fontSize: '9.5pt' }}>C.I. {cedula || '—'}</p>
      {detalle && <p style={{ margin: 0, fontSize: '9pt' }}>{detalle}</p>}
      <p style={{ margin: '1mm 0 0', fontSize: '8.5pt', letterSpacing: '0.06em', textTransform: 'uppercase', color: '#555' }}>
        {rol}
      </p>
    </div>
  );

  // En ambas actas (con acuerdo y de no acuerdo) firman todas las partes.
  const textoCierre =
    'Leída el acta, las partes se ratifican en su contenido y la firman junto con el mediador.';

  return (
    <main className="min-h-screen bg-numa-100 print:bg-white">
      <style>{`
        @page { size: A4; margin: 0; }
        .membrete { position: absolute; top: 0; left: 0; width: 210mm; height: 297mm; z-index: 0; clip-path: inset(0 0 42mm 0); }
        .membrete-pie { position: absolute; left: 0; bottom: 0; width: 210mm; height: 297mm; z-index: 0; clip-path: inset(255mm 0 0 0); pointer-events: none; }
        .pie-capa { position: absolute; bottom: 0; left: 0; width: 210mm; height: 297mm; z-index: 5; pointer-events: none; }
        @media print {
          .pie-capa { position: fixed; top: 0; bottom: auto; }
          html, body { background: #fff !important; }
          .hoja { box-shadow: none !important; margin: 0 !important; min-height: 0 !important; }
          .membrete { position: fixed; clip-path: none; }
          .membrete-pie { display: none; }
        }
      `}</style>

      {/* Barra superior: no se imprime */}
      <div className="print:hidden max-w-5xl mx-auto px-4 pt-6 pb-4">
        <div className="bg-white border border-numa-200 rounded-sm p-4 flex items-center justify-between gap-3">
          <Link
            href={`/procesos/${procesoId}`}
            className="inline-flex items-center gap-1.5 text-sm text-numa-600 hover:text-numa-900"
          >
            <ArrowLeft className="w-4 h-4" />
            Volver al proceso
          </Link>
          <p className="hidden md:block text-xs text-numa-500 flex-1 text-center">
            Para guardarla en tu computador o en una memoria USB, en la ventana de impresión elige
            &quot;Guardar como PDF&quot;.
          </p>
          <button
            onClick={() => window.print()}
            className="inline-flex items-center gap-2 px-4 py-2 bg-numa-900 text-numa-50 rounded-sm text-sm font-medium hover:bg-numa-950 transition-colors"
          >
            <Printer className="w-4 h-4" />
            Descargar o imprimir
          </button>
        </div>
      </div>

      <div
        className="hoja relative mx-auto bg-white shadow-md"
        style={{
          width: '210mm',
          minHeight: '297mm',
          boxSizing: 'border-box',
          fontFamily: 'Arial, Helvetica, sans-serif',
          fontSize: '11pt',
          lineHeight: 1.35,
          color: '#111',
          textAlign: 'justify'
        }}
      >
        <div className="membrete">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/images/membrete-numa.jpg"
            alt=""
            style={{ position: 'absolute', top: 0, left: 0, width: '210mm', height: '297mm' }}
          />
        </div>
        <div className="membrete-pie">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/images/membrete-numa.jpg"
            alt=""
            style={{ position: 'absolute', top: 0, left: 0, width: '210mm', height: '297mm' }}
          />
        </div>

        <div className="pie-capa">
          <div style={{ ...estiloPie, top: '278.5mm', left: '7.5mm', width: '95mm', whiteSpace: 'pre-line' }}>
            {pie}
          </div>
          <div style={{ ...estiloPie, top: '281mm', right: '4mm', width: '85mm', textAlign: 'right' }}>
            {telefono && (
              <>
                Celular: {telefono}
                <br />
              </>
            )}
            Correo: {correo}
          </div>
        </div>

        <table style={{ width: '100%', borderCollapse: 'collapse', position: 'relative', zIndex: 2 }}>
          <thead>
            <tr>
              <td style={{ padding: 0 }}>
                <div style={{ height: `${ESPACIO_SUP}mm` }} />
              </td>
            </tr>
          </thead>
          <tfoot>
            <tr>
              <td style={{ padding: 0 }}>
                <div style={{ height: `${ESPACIO_INF}mm` }} />
              </td>
            </tr>
          </tfoot>
          <tbody>
            <tr>
              <td style={{ padding: `0 ${MARGEN_LAT}mm`, verticalAlign: 'top' }}>
                <div style={{ textAlign: 'center', marginBottom: '6mm' }}>
                  <p style={{ margin: 0, fontSize: '13pt', fontWeight: 700 }}>
                    {noAcuerdo ? 'ACTA DE NO ACUERDO' : 'ACTA DE MEDIACIÓN'}
                  </p>
                  <p style={{ margin: 0 }}>CENTRO DE MEDIACIÓN “NUMA” · REGISTRO No.231</p>
                  <p style={{ margin: 0 }}>Código: <strong>{proceso.codigo_acta || '—'}</strong></p>
                </div>

                <p style={pDefault}>
                  En la ciudad de {proceso.ciudad}, sucursal {proceso.sucursal}, con fecha{' '}
                  {fmtFecha(fechaActa)}, ante el mediador <strong>{mediador}</strong>, comparecen las
                  siguientes partes:
                </p>

                {bloquePartes('Solicitante(s)', solicitantes)}
                {bloquePartes('Invitado(s)', invitados)}

                <div style={{ marginBottom: '4mm' }}>
                  <p style={etiqueta}>Tema</p>
                  <p style={{ margin: 0, whiteSpace: 'pre-line' }}>{proceso.tema}</p>
                </div>

                <div style={{ marginBottom: '5mm' }}>
                  <p style={etiqueta}>{noAcuerdo ? 'Resultado: no acuerdo' : 'Resultado: acuerdo'}</p>
                  <div style={{ whiteSpace: 'pre-line' }}>
                    {noAcuerdo
                      ? 'El mediador certifica que, habiéndose llevado a cabo el proceso de mediación, las partes no llegaron a un acuerdo.' +
                        (proceso.observacion_cierre ? `\n\n${proceso.observacion_cierre}` : '')
                      : proceso.acuerdo_texto || '—'}
                  </div>
                </div>

                <p style={pDefault}>{textoCierre}</p>

                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr',
                    columnGap: '12mm',
                    rowGap: '14mm',
                    marginTop: '16mm'
                  }}
                >
                  {[...solicitantes, ...invitados].map((p: any) => {
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
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div className="print:hidden h-10" />
    </main>
  );
}
