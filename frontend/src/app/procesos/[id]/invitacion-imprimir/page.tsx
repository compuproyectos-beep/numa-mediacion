'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { Printer } from 'lucide-react';
import { getDatosInvitacion } from '@/lib/services';
import { hoyEcuador } from '@/lib/accionProceso';

type Modelo = 'natural' | 'empresa';

const ORDINALES = ['Primera', 'Segunda', 'Tercera', 'Cuarta', 'Quinta', 'Sexta'];
const MESES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'
];
const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

const LUGAR_MATRIZ =
  'en las oficinas del Centro de Mediación “NUMA”, en la sala 1, ubicadas en las calles Tulcán y Babahoyo, Edificio Andrade, primer piso, oficinas 101 a la 107';
const PIE_MATRIZ =
  'Calles Tulcán y Babahoyo, Edif. Andrade,\nPrimer piso, Oficinas 101-107\nSanto Domingo, Ecuador';
const CORREO_DEFECTO = 'numacentromediacion@gmail.com';

// Medidas de la hoja (mm): el membrete ocupa la parte de arriba y el pie de abajo.
const ESPACIO_SUP = 50; // altura del membrete (logo y líneas doradas)
const ESPACIO_INF = 38; // altura del pie con la dirección y contactos
const MARGEN_LAT = 20;

const partes = (iso: string) => {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, 12));
  return { y, m, d, dia: DIAS[dt.getUTCDay()] };
};

const fechaLarga = (iso: string) => {
  const { y, m, d } = partes(iso);
  return `${String(d).padStart(2, '0')} de ${MESES[m - 1]} de ${y}`;
};

const horaTexto = (h: string) => {
  const [hh, mm] = (h || '').split(':');
  return `${hh || '00'}H${mm || '00'}`;
};

const nombreCompleto = (p: any) => `${p.nombre} ${p.apellido || ''}`.trim();

// Cómo se nombra a cada parte en la invitación.
const nombreParte = (p: any) => {
  if (p.tipo === 'empresa') {
    return {
      fuerte: p.representante_nombre
        ? `${p.representante_nombre}`
        : nombreCompleto(p),
      resto: p.representante_nombre
        ? `, representante legal de ${nombreCompleto(p)}`
        : ''
    };
  }
  return {
    fuerte: nombreCompleto(p),
    resto: p.empresa_nombre ? `, en representación de ${p.empresa_nombre}` : ''
  };
};

const unir = (items: any[]) => {
  const out: any[] = [];
  items.forEach((it, i) => {
    if (i > 0) out.push(i === items.length - 1 ? ' y ' : ', ');
    out.push(it);
  });
  return out;
};

const listaNombres = (lista: any[]) =>
  unir(
    lista.map((p) => {
      const n = nombreParte(p);
      return (
        <span key={p.id}>
          <b>{n.fuerte.toUpperCase()}</b>
          {n.resto}
        </span>
      );
    })
  );

const campo = 'w-full border border-numa-300 rounded-sm px-2 py-1.5 text-sm bg-white';
const etiqueta = 'block text-[11px] uppercase tracking-wide text-numa-500 mb-1';

function ImprimirInvitacion() {
  const params = useParams();
  const search = useSearchParams();
  const procesoId = Number(params.id);
  const citaParam = Number(search.get('cita') || 0);

  const [data, setData] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [modelo, setModelo] = useState<Modelo>('natural');
  const [citaId, setCitaId] = useState<number>(citaParam);
  const [titulo, setTitulo] = useState('Primera invitación');
  const [fechaEmision, setFechaEmision] = useState(hoyEcuador());
  const [asunto, setAsunto] = useState('');
  const [lugar, setLugar] = useState(LUGAR_MATRIZ);
  const [pie, setPie] = useState(PIE_MATRIZ);
  const [telefono, setTelefono] = useState('');
  const [correo, setCorreo] = useState(CORREO_DEFECTO);
  const [extras, setExtras] = useState('');

  useEffect(() => {
    if (!procesoId) return;
    getDatosInvitacion(procesoId)
      .then((d) => {
        setData(d);
        const citas = d.citas || [];
        const activa =
          citas.find((c: any) => c.id === citaParam) ||
          [...citas].reverse().find((c: any) => c.estado !== 'cancelada') ||
          citas[citas.length - 1];
        if (activa) {
          setCitaId(activa.id);
          const idx = citas.findIndex((c: any) => c.id === activa.id);
          setTitulo(`${ORDINALES[idx] || `Invitación ${idx + 1}`} invitación`);
        }
        setAsunto(d.proceso?.tema || '');
        const hayEmpresa = (d.partes || []).some((p: any) => p.tipo === 'empresa');
        setModelo(hayEmpresa ? 'empresa' : 'natural');

        // Si no es la matriz de Santo Domingo, el lugar cambia: se parte de la
        // dirección de la sucursal para que el mediador la corrija.
        const esMatriz = /santo domingo/i.test(d.proceso?.ciudad || '');
        if (!esMatriz) {
          const dir = d.proceso?.sucursal_direccion || '';
          setLugar(
            dir
              ? `en las oficinas del Centro de Mediación “NUMA”, ubicadas en ${dir}`
              : 'en las oficinas del Centro de Mediación “NUMA”, ubicadas en ...'
          );
          setPie(`${dir || ''}\n${d.proceso?.ciudad || ''}, Ecuador`.trim());
        }
        // Primero el teléfono guardado en el perfil del mediador; si no tiene,
        // el último que se escribió en este navegador; y si no, el de la sucursal.
        let tel = d.proceso?.mediador_telefono || '';
        if (!tel) {
          try {
            tel = window.localStorage.getItem('numa_tel_invitacion') || '';
          } catch {
            /* sin almacenamiento: se queda con el valor por defecto */
          }
        }
        if (!tel) tel = d.proceso?.sucursal_telefono || '';
        setTelefono(tel);
      })
      .catch((e) =>
        setError(e?.response?.data?.detail || 'No se pudo cargar la invitación.')
      )
      .finally(() => setLoading(false));
  }, [procesoId, citaParam]);

  const guardarTelefono = (v: string) => {
    setTelefono(v);
    try {
      window.localStorage.setItem('numa_tel_invitacion', v);
    } catch {
      /* no pasa nada */
    }
  };

  const cita = useMemo(
    () => (data?.citas || []).find((c: any) => c.id === citaId),
    [data, citaId]
  );

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-numa-50 text-numa-500 text-sm">
        Cargando invitación...
      </div>
    );
  }

  if (!data) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-numa-50 text-numa-500 text-sm px-6 text-center">
        {error || 'No se pudo cargar la invitación.'}
      </div>
    );
  }

  const { proceso } = data;
  const solicitantes = (data.partes || []).filter((p: any) => p.rol === 'solicitante');
  const invitados = (data.partes || []).filter((p: any) => p.rol === 'invitado');
  const mediador = `${proceso.mediador_nombre} ${proceso.mediador_apellido}`.trim();
  const plural = (l: any[], a: string, b: string) => (l.length > 1 ? b : a);

  const fechaCita = cita?.fecha
    ? (() => {
        const p = partes(cita.fecha);
        return `${p.dia} ${String(p.d).padStart(2, '0')} de ${MESES[p.m - 1]} del año ${p.y}, a las ${horaTexto(cita.hora)}`;
      })()
    : '__ de ______ del año ____, a las __H__';

  const ciudadEmision = proceso.ciudad || 'Santo Domingo';
  const lineaFecha = `${ciudadEmision}, ${fechaLarga(fechaEmision)}.`;

  const pDefault: React.CSSProperties = { margin: '0 0 3.2mm' };

  const firma = (
    <div style={{ marginTop: '14mm', breakInside: 'avoid' }}>
      <div style={{ width: '70mm', borderBottom: '1px solid #222', height: '16mm' }} />
      <p style={{ margin: '1.5mm 0 0', fontWeight: 700 }}>{mediador}</p>
      <p style={{ margin: 0 }}>
        MEDIADOR{proceso.mediador_cedula ? ` · C.I. ${proceso.mediador_cedula}` : ''}
      </p>
      <p style={{ margin: 0 }}>Centro de Mediación “NUMA”</p>
    </div>
  );

  const contacto = (
    <>
      Agradeceré confirmar su asistencia con el suscrito al teléfono{' '}
      <b>{telefono || '__________'}</b>
      {modelo === 'empresa' ? ' o al correo electrónico ' : ', email '}
      <b>{correo}</b>
      {modelo === 'empresa' ? '.' : ''}
    </>
  );

  const cuerpoNatural = (
    <>
      <div style={{ display: 'flex', gap: '8mm', ...pDefault }}>
        <div style={{ flex: 1 }}>
          <p style={{ margin: 0 }}>{plural(solicitantes, 'Señor(a):', 'Señores:')}</p>
          <p style={{ margin: '2mm 0 0' }}>{listaNombres(solicitantes)}</p>
          <p style={{ margin: '3mm 0 0', fontSize: '10pt' }}>
            {plural(solicitantes, 'Solicitante', 'Solicitantes')} de Mediación.
            <br />
            Ciudad. -
          </p>
        </div>
        <div style={{ flex: 1 }}>
          <p style={{ margin: 0 }}>{plural(invitados, 'Señor(a):', 'Señores:')}</p>
          <p style={{ margin: '2mm 0 0' }}>{listaNombres(invitados)}</p>
          <p style={{ margin: '3mm 0 0', fontSize: '10pt' }}>
            {plural(invitados, 'Invitado', 'Invitados')} a Mediación.
            <br />
            Ciudad.-
          </p>
        </div>
      </div>

      <p style={pDefault}>{titulo}.</p>
      <p style={pDefault}>De mi consideración:</p>

      <p style={pDefault}>
        {plural(solicitantes, 'La persona', 'Las personas')} {listaNombres(solicitantes)},{' '}
        {plural(solicitantes, 'ha solicitado', 'han solicitado')} una Audiencia de Mediación, con{' '}
        {listaNombres(invitados)}, y así poder solucionar, de manera extrajudicial, un conflicto de ámbito{' '}
        <b>{(asunto || '').toUpperCase()}</b>.
      </p>

      <p style={pDefault}>
        Este centro acepta prestar sus servicios, para cuyo efecto convoca a la Audiencia de
        Mediación que se efectuará el <b>{fechaCita}</b>, a realizarse {lugar}.
      </p>

      <p style={pDefault}>{contacto}</p>
      <p style={pDefault}>Atentamente,</p>
      {firma}
    </>
  );

  const cuerpoEmpresa = (
    <>
      <p style={pDefault}>
        <b>{plural(invitados, 'SEÑOR(A):', 'SEÑORES:')}</b>
      </p>
      <p style={pDefault}>{listaNombres(invitados)}.</p>
      {extras
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean)
        .map((l, i) => (
          <p key={i} style={pDefault}>
            {l}
          </p>
        ))}
      <p style={pDefault}>
        <b>ASUNTO:</b> {asunto}.
      </p>
      <p style={pDefault}>{titulo}.</p>
      <p style={pDefault}>
        <b>De mi consideración:</b>
      </p>

      <p style={pDefault}>
        Reciba un cordial saludo por parte del Centro de Mediación “NUMA”, quien suscribe lo hace
        en calidad de mediador autorizado debidamente registrado en el Consejo de la Judicatura,
        cumpliendo con los requisitos formales que exige la Ley de Arbitraje y Mediación en sus
        artículos 43, 44 y 45 de la ley ibídem; por consiguiente, manifiesto a continuación:
      </p>

      <p style={pDefault}>
        <b>1.- SOLICITUD DE MEDIACIÓN</b>
      </p>
      <p style={pDefault}>
        {listaNombres(solicitantes)}, {plural(solicitantes, 'ha solicitado', 'han solicitado')} que
        invite a {listaNombres(invitados)}, para llevar a cabo una audiencia en el Centro de
        Mediación “NUMA”, con el fin de resolver el conflicto mediante acuerdos voluntarios
        extrajudiciales, referente a: <b>{asunto}</b>.
      </p>

      <p style={pDefault}>
        <b>2.- INVITACIÓN</b>
      </p>
      <p style={pDefault}>
        Este centro acepta prestar sus servicios, para cuyo efecto convoca a la audiencia de
        mediación que se efectuará el <b>{fechaCita}</b>, {lugar}, lugar donde se procurará un
        acuerdo voluntario que verse sobre materia transigible, de carácter extrajudicial y
        definitivo, que ponga fin al conflicto.
      </p>

      <p style={pDefault}>
        Una vez que las partes han sido debidamente notificadas con la presente invitación, se les
        informa que podrán comparecer a la audiencia de mediación de manera personal o mediante
        conexión telemática.
      </p>

      <p style={pDefault}>
        Se deja expresa constancia de que la presente diligencia no requiere de patrocinio de
        abogado, por tratarse de un procedimiento de mediación en el cual las partes serán
        asistidas directamente por el mediador, conforme a la normativa vigente.
      </p>

      <p style={pDefault}>
        Se recuerda a los comparecientes que deberán presentarse portando su documento de
        identidad original. En caso de actuar en calidad de representantes legales de personas
        jurídicas, deberán exhibir en original los documentos habilitantes que acrediten dicha
        representación.
      </p>

      <p style={pDefault}>
        Con los antecedentes antes expuestos y, de acuerdo al Art. 51 de la Ley de Arbitraje y
        Mediación, a la que fuere convocada, el mediador expedirá la constancia de imposibilidad
        de mediación.
      </p>

      <p style={pDefault}>{contacto}</p>
      <p style={pDefault}>Atentamente,</p>
      {firma}
    </>
  );

  return (
    <main className="min-h-screen bg-numa-100 print:bg-white">
      <style>{`
        @page { size: A4; margin: 0; }
        .membrete { position: absolute; top: 0; left: 0; width: 210mm; height: 297mm; z-index: 0; }
        @media print {
          html, body { background: #fff !important; }
          .hoja { box-shadow: none !important; margin: 0 !important; min-height: 0 !important; }
          .membrete { position: fixed; }
        }
      `}</style>

      {/* Panel de datos: no se imprime */}
      <div className="print:hidden max-w-5xl mx-auto px-4 pt-6 pb-4">
        <div className="bg-white border border-numa-200 rounded-sm p-4">
          <div className="flex items-start justify-between gap-3 mb-3">
            <div>
              <h1 className="text-lg font-semibold text-numa-900">
                Invitación — {proceso.codigo_proceso}
              </h1>
              <p className="text-xs text-numa-500">
                Revisa los datos, corrige lo que haga falta y presiona Imprimir (o guarda como PDF).
                El documento no se guarda: se puede volver a generar cuando quieras.
              </p>
            </div>
            <button
              onClick={() => window.print()}
              className="inline-flex items-center gap-2 px-4 py-2 bg-numa-900 text-numa-50 rounded-sm text-sm font-medium hover:bg-numa-950 transition-colors shrink-0"
            >
              <Printer className="w-4 h-4" />
              Imprimir
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className={etiqueta}>Modelo</label>
              <select
                className={campo}
                value={modelo}
                onChange={(e) => setModelo(e.target.value as Modelo)}
              >
                <option value="natural">Persona natural</option>
                <option value="empresa">Empresa / institución</option>
              </select>
            </div>
            <div>
              <label className={etiqueta}>Invitación</label>
              <select
                className={campo}
                value={citaId}
                onChange={(e) => {
                  const id = Number(e.target.value);
                  setCitaId(id);
                  const idx = (data.citas || []).findIndex((c: any) => c.id === id);
                  if (idx >= 0)
                    setTitulo(`${ORDINALES[idx] || `Invitación ${idx + 1}`} invitación`);
                }}
              >
                {(data.citas || []).map((c: any, i: number) => (
                  <option key={c.id} value={c.id}>
                    #{i + 1} · {c.fecha ? fechaLarga(c.fecha) : ''} · {(c.hora || '').slice(0, 5)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={etiqueta}>Título (editable)</label>
              <input
                className={campo}
                value={titulo}
                onChange={(e) => setTitulo(e.target.value)}
                list="titulos-invitacion"
              />
              <datalist id="titulos-invitacion">
                <option value="Primera invitación" />
                <option value="Segunda invitación" />
                <option value="Tercera invitación" />
              </datalist>
            </div>
            <div>
              <label className={etiqueta}>Fecha del documento</label>
              <input
                type="date"
                className={campo}
                value={fechaEmision}
                onChange={(e) => setFechaEmision(e.target.value)}
              />
            </div>
            <div className="md:col-span-2">
              <label className={etiqueta}>
                {modelo === 'empresa' ? 'Asunto' : 'Ámbito del conflicto (familia, deuda, etc.)'}
              </label>
              <input
                className={campo}
                value={asunto}
                onChange={(e) => setAsunto(e.target.value)}
              />
            </div>
            <div className="md:col-span-3">
              <label className={etiqueta}>Lugar de la audiencia</label>
              <textarea
                className={campo}
                rows={2}
                value={lugar}
                onChange={(e) => setLugar(e.target.value)}
              />
            </div>
            <div>
              <label className={etiqueta}>Teléfono del mediador</label>
              <input
                className={campo}
                value={telefono}
                onChange={(e) => guardarTelefono(e.target.value)}
              />
            </div>
            <div>
              <label className={etiqueta}>Correo</label>
              <input
                className={campo}
                value={correo}
                onChange={(e) => setCorreo(e.target.value)}
              />
            </div>
            <div>
              <label className={etiqueta}>Dirección del pie de página</label>
              <textarea
                className={campo}
                rows={3}
                value={pie}
                onChange={(e) => setPie(e.target.value)}
              />
            </div>
            {modelo === 'empresa' && (
              <div className="md:col-span-3">
                <label className={etiqueta}>
                  Líneas adicionales bajo “Señores” (opcional, una por línea: delegados, cargos…)
                </label>
                <textarea
                  className={campo}
                  rows={2}
                  value={extras}
                  onChange={(e) => setExtras(e.target.value)}
                />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Hoja */}
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
        {/* Membrete: logo, líneas doradas, marca de agua y pie. En la
            impresión se repite en todas las hojas. */}
        <div className="membrete">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/images/membrete-numa.jpg"
            alt=""
            style={{ position: 'absolute', top: 0, left: 0, width: '210mm', height: '297mm' }}
          />
          <div
            style={{
              position: 'absolute',
              top: '278.5mm',
              left: '7.5mm',
              width: '95mm',
              fontFamily: "'Open Sans', Arial, sans-serif",
              fontWeight: 700,
              fontSize: '7.6pt',
              lineHeight: 1.45,
              color: '#1f2a7a',
              textAlign: 'left',
              whiteSpace: 'pre-line'
            }}
          >
            {pie}
          </div>
        </div>

        {/* La tabla repite el espacio de arriba y de abajo en cada hoja
            impresa, para que el texto nunca pise el membrete ni el pie. */}
        <table
          style={{ width: '100%', borderCollapse: 'collapse', position: 'relative', zIndex: 2 }}
        >
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
                  <p style={{ margin: 0, fontSize: '13pt' }}>CENTRO DE MEDIACIÓN “NUMA”</p>
                  <p style={{ margin: 0 }}>REGISTRO No.231</p>
                </div>

                <p style={pDefault}>{lineaFecha}</p>

                {modelo === 'natural' ? cuerpoNatural : cuerpoEmpresa}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div className="print:hidden h-10" />
    </main>
  );
}

export default function ImprimirInvitacionPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-numa-50 text-numa-500 text-sm">
          Cargando invitación...
        </div>
      }
    >
      <ImprimirInvitacion />
    </Suspense>
  );
}
