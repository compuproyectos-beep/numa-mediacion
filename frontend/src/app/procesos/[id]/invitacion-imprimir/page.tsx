'use client';

import { Suspense, createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Printer, Save } from 'lucide-react';
import {
  getDatosInvitacion,
  getDatosInvitacionRapida,
  crearInvitacionProceso,
  guardarDocumentoInvitacion,
  guardarDocumentoInvitacionRapida
} from '@/lib/services';
import { hoyEcuador } from '@/lib/accionProceso';
import { useAuth } from '@/hooks/useAuth';

type Modelo = 'natural' | 'empresa';

const ORDINALES = [
  'Primera', 'Segunda', 'Tercera', 'Cuarta', 'Quinta', 'Sexta',
  'Séptima', 'Octava', 'Novena', 'Décima'
];
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
const ESPACIO_SUP = 50; // altura del membrete (logo y líneas doradas), solo en la primera hoja
const ESPACIO_SUP_SIGUIENTES = 15; // margen superior de las hojas siguientes (en blanco)
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

// Las fechas vienen del servidor en UTC: se muestran en hora de Ecuador.
const fechaCreacionEC = (v: any) => {
  if (!v) return '';
  const iso = String(v).replace(' ', 'T');
  const d = new Date(/(Z|[+-]\d\d:?\d\d)$/.test(iso) ? iso : `${iso}Z`);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleString('es-EC', {
    timeZone: 'America/Guayaquil',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
};

const nombreCompleto = (p: any) => `${p.nombre} ${p.apellido || ''}`.trim();

// Cómo se nombra a cada parte en la invitación.
const nombreParte = (p: any) => {
  if (p.tipo === 'empresa') {
    return {
      fuerte: p.representante_nombre
        ? `${p.representante_nombre}`
        : nombreCompleto(p),
      cedula: p.representante_nombre ? p.representante_cedula || '' : '',
      resto: p.representante_nombre
        ? `, representante legal de ${nombreCompleto(p)}${p.ruc ? ` (RUC ${p.ruc})` : ''}`
        : p.ruc
        ? ` (RUC ${p.ruc})`
        : ''
    };
  }
  return {
    fuerte: nombreCompleto(p),
    cedula: p.cedula || '',
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

// conCedula: en la primera vez que se nombra a cada parte (encabezado) se
// agrega su cédula; el representante legal de una empresa lleva la suya.
const listaNombres = (lista: any[], conCedula = false) =>
  unir(
    lista.map((p) => {
      const n = nombreParte(p);
      return (
        <span key={p.id}>
          <b>{n.fuerte.toUpperCase()}</b>
          {conCedula && n.cedula ? `, C.I. ${n.cedula}` : ''}
          {n.resto}
        </span>
      );
    })
  );

const campo = 'w-full border border-numa-300 rounded-sm px-2 py-1.5 text-sm bg-white';
const etiqueta = 'block text-[11px] uppercase tracking-wide text-numa-500 mb-1';

// Texto que se escribe directamente sobre la hoja. Es un span editable que no
// se vuelve a pintar mientras se escribe (así el cursor no salta); solo se
// reescribe cuando el valor cambia desde otro lado (por ejemplo el mismo dato
// que aparece dos veces en el documento).
// Cuando la invitación ya no está pendiente (realizada, cancelada, etc.) el
// documento queda de solo lectura: solo se puede imprimir.
const SoloLecturaCtx = createContext(false);

function Editable({
  value,
  onChange,
  placeholder,
  multi = false,
  upper = false
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  multi?: boolean;
  upper?: boolean;
}) {
  const soloLectura = useContext(SoloLecturaCtx);
  const ref = useRef<HTMLSpanElement>(null);
  const leer = (el: HTMLElement) =>
    (multi ? el.innerText : el.textContent || '').replace(/\u00a0/g, ' ');
  const norm = (t: string) => t.replace(/\s+$/, '');
  useEffect(() => {
    const el = ref.current;
    if (el && norm(leer(el)) !== norm(value || '')) el.textContent = value || '';
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <span
      ref={ref}
      contentEditable={!soloLectura}
      suppressContentEditableWarning
      spellCheck={false}
      data-ph={placeholder}
      className={soloLectura ? undefined : 'campo-edit'}
      style={{
        textTransform: upper ? 'uppercase' : undefined,
        whiteSpace: multi ? 'pre-line' : 'pre-wrap'
      }}
      onInput={(e) => onChange(leer(e.currentTarget))}
      onKeyDown={(e) => {
        if (!multi && e.key === 'Enter') e.preventDefault();
      }}
      onPaste={(e) => {
        e.preventDefault();
        let t = e.clipboardData.getData('text/plain');
        if (!multi) t = t.replace(/\s*\n+\s*/g, ' ');
        document.execCommand('insertText', false, t);
      }}
    />
  );
}

function ImprimirInvitacion() {
  const params = useParams();
  const search = useSearchParams();
  const router = useRouter();
  // /procesos/rapida/...: invitación creada desde la Agenda, sin proceso.
  const esRapida = params.id === 'rapida';
  const procesoId = esRapida ? 0 : Number(params.id);
  const citaParam = Number(search.get('cita') || 0);
  // ?nueva=1: se redacta la invitación sobre el documento y al guardar se crea.
  const esNueva = !esRapida && search.get('nueva') === '1';

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
  const [fechaNueva, setFechaNueva] = useState('');
  const [horaNueva, setHoraNueva] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [errorGuardar, setErrorGuardar] = useState('');
  const [okGuardar, setOkGuardar] = useState('');
  const [popFecha, setPopFecha] = useState(false);

  // Rellena los campos con los textos que se guardaron con una invitación.
  const aplicarDocumento = (doc: any, conTitulo = true) => {
    if (!doc) return;
    if (doc.modelo === 'natural' || doc.modelo === 'empresa') setModelo(doc.modelo);
    if (conTitulo && doc.titulo) setTitulo(doc.titulo);
    if (doc.fecha_emision) setFechaEmision(doc.fecha_emision);
    if (typeof doc.asunto === 'string') setAsunto(doc.asunto);
    if (doc.lugar) setLugar(doc.lugar);
    if (doc.pie) setPie(doc.pie);
    if (typeof doc.extras === 'string') setExtras(doc.extras);
  };

  useEffect(() => {
    if (!procesoId && !(esRapida && citaParam)) return;
    (esRapida ? getDatosInvitacionRapida(citaParam) : getDatosInvitacion(procesoId))
      .then((d) => {
        setData(d);
        const citas = d.citas || [];
        const activa = esNueva
          ? null
          : citas.find((c: any) => c.id === citaParam) ||
            [...citas].reverse().find((c: any) => c.estado !== 'cancelada') ||
            citas[citas.length - 1];
        if (esNueva) {
          setCitaId(0);
          setTitulo(`${ORDINALES[citas.length] || `Invitación N.° ${citas.length + 1}`}${ORDINALES[citas.length] ? ' invitación' : ''}`);
        } else if (activa) {
          setCitaId(activa.id);
          const idx = citas.findIndex((c: any) => c.id === activa.id);
          setTitulo(`${ORDINALES[idx] || `Invitación N.° ${idx + 1}`}${ORDINALES[idx] ? ' invitación' : ''}`);
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
        // El teléfono y el correo del pie son SIEMPRE los del administrador
        // responsable de la sucursal (se editan en Sucursales); aquí no se
        // pueden cambiar. Si la sucursal aún no los tiene, se usa el
        // teléfono de la sucursal y el correo del centro.
        setTelefono(d.proceso?.sucursal_admin_telefono || d.proceso?.sucursal_telefono || '');
        setCorreo(d.proceso?.sucursal_admin_email || CORREO_DEFECTO);

        // Si la invitación ya tiene textos guardados, se usan esos. Para una
        // nueva, se parte de los de la última invitación (lugar, asunto, etc.).
        if (activa?.documento) {
          aplicarDocumento(activa.documento);
        } else if (esNueva) {
          const previa = [...citas].reverse().find((c: any) => c.documento);
          if (previa) aplicarDocumento(previa.documento, false);
        }
      })
      .catch((e) => {
        // La invitación rápida ya se enlazó a un proceso: se abre desde ahí.
        const detalle = String(e?.response?.data?.detail || '');
        if (esRapida && detalle.startsWith('proceso:')) {
          router.replace(`/procesos/${detalle.slice(8)}/invitacion-imprimir?cita=${citaParam}`);
          return;
        }
        setError(detalle || 'No se pudo cargar la invitación.');
      })
      .finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [procesoId, citaParam, esNueva]);

  const documentoActual = () => ({
    modelo,
    titulo,
    fecha_emision: fechaEmision,
    asunto,
    lugar,
    pie,
    telefono,
    correo,
    extras
  });

  // Nueva: crea la invitación en el sistema y guarda los textos del documento.
  // Existente: solo guarda los textos.
  const guardar = async () => {
    setErrorGuardar('');
    setOkGuardar('');
    if (esNueva) {
      if (!fechaNueva || !horaNueva) {
        setErrorGuardar('Falta la fecha y la hora de la audiencia: toca el campo amarillo de la fecha en el documento.');
        return;
      }
      if (fechaNueva < hoyEcuador()) {
        setErrorGuardar('La fecha de la audiencia no puede ser pasada.');
        return;
      }
    }
    setGuardando(true);
    try {
      if (esNueva) {
        const nueva = await crearInvitacionProceso(procesoId, {
          fecha: fechaNueva,
          hora: horaNueva,
          observaciones: titulo || 'Invitación'
        });
        try {
          await guardarDocumentoInvitacion(procesoId, nueva.id, documentoActual());
        } catch {
          /* la invitación ya existe; los textos se pueden guardar luego */
        }
        router.replace(`/procesos/${procesoId}/invitacion-imprimir?cita=${nueva.id}`);
      } else if (citaId) {
        if (esRapida) {
          await guardarDocumentoInvitacionRapida(citaId, documentoActual());
        } else {
          await guardarDocumentoInvitacion(procesoId, citaId, documentoActual());
        }
        setOkGuardar('Cambios del documento guardados.');
      }
    } catch (e: any) {
      setErrorGuardar(
        e?.response?.data?.detail || 'No se pudo guardar. Revisa los datos e inténtalo de nuevo.'
      );
    } finally {
      setGuardando(false);
    }
  };

  const cita = useMemo(
    () => (data?.citas || []).find((c: any) => c.id === citaId),
    [data, citaId]
  );

  // Una invitación ya realizada, cancelada o reagendada no se puede modificar.
  const { user: usuarioActual } = useAuth();
  // La secretaria no puede volver a modificar un documento que ya editó el
  // mediador o el administrador: solo verlo e imprimirlo.
  const soloLecturaSecretaria =
    esRapida &&
    usuarioActual?.rol === 'secretaria' &&
    ['mediador', 'administrador'].includes(cita?.documento?.editor_rol);
  const bloqueada =
    (!esNueva && !!cita && cita.estado !== 'pendiente') || soloLecturaSecretaria;
  // Una invitación rápida no se imprime sin tema (asunto).
  const sinTema = esRapida && !asunto.trim();

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
  // Modelo que corresponde según las partes del proceso (el mismo criterio con
  // que se elige solo al abrir). Si se elige otro, se avisa, sin bloquear.
  const modeloRecomendado: Modelo = (data.partes || []).some((p: any) => p.tipo === 'empresa')
    ? 'empresa'
    : 'natural';
  const solicitantes = (data.partes || []).filter((p: any) => p.rol === 'solicitante');
  const invitados = (data.partes || []).filter((p: any) => p.rol === 'invitado');
  const mediador = `${proceso.mediador_nombre} ${proceso.mediador_apellido}`.trim();
  const plural = (l: any[], a: string, b: string) => (l.length > 1 ? b : a);

  const fechaBase = esNueva ? fechaNueva : cita?.fecha;
  const horaBase = esNueva ? horaNueva : cita?.hora;
  const fechaCita = fechaBase
    ? (() => {
        const p = partes(fechaBase);
        return `${p.dia} ${String(p.d).padStart(2, '0')} de ${MESES[p.m - 1]} del año ${p.y}, a las ${horaBase ? horaTexto(horaBase) : '__H__'}`;
      })()
    : '__ de ______ del año ____, a las __H__';

  const chipFecha = (
    <span style={{ position: 'relative' }}>
      <b
        className={esNueva ? 'campo-edit' : undefined}
        style={{ cursor: esNueva ? 'pointer' : undefined }}
        onClick={() => esNueva && setPopFecha(true)}
      >
        {fechaCita}
      </b>
      {esNueva && popFecha && (
        <span
          className="print:hidden"
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            zIndex: 30,
            display: 'flex',
            gap: '8px',
            alignItems: 'flex-end',
            background: '#fff',
            border: '1px solid #bbb',
            borderRadius: 4,
            padding: 10,
            boxShadow: '0 4px 14px rgba(0,0,0,.18)',
            textAlign: 'left',
            fontSize: '10pt',
            fontWeight: 400,
            width: 'max-content'
          }}
        >
          <span>
            <span className={etiqueta}>Fecha</span>
            <input
              type="date"
              className={campo}
              min={hoyEcuador()}
              value={fechaNueva}
              onChange={(e) => setFechaNueva(e.target.value)}
            />
          </span>
          <span>
            <span className={etiqueta}>Hora</span>
            <input
              type="time"
              className={campo}
              value={horaNueva}
              onChange={(e) => setHoraNueva(e.target.value)}
            />
          </span>
          <button
            type="button"
            onClick={() => setPopFecha(false)}
            className="px-3 py-1.5 bg-numa-900 text-numa-50 rounded-sm text-sm"
          >
            Listo
          </button>
        </span>
      )}
    </span>
  );

  const ciudadEmision = proceso.ciudad || 'Santo Domingo';
  const lineaFecha = `${ciudadEmision}, ${fechaLarga(fechaEmision)}.`;

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

  const cuerpoNatural = (
    <>
      <div style={{ display: 'flex', gap: '8mm', ...pDefault }}>
        <div style={{ flex: 1 }}>
          <p style={{ margin: 0 }}>{plural(solicitantes, 'Señor(a):', 'Señores:')}</p>
          <p style={{ margin: '2mm 0 0' }}>{listaNombres(solicitantes, true)}</p>
          <p style={{ margin: '3mm 0 0', fontSize: '10pt' }}>
            {plural(solicitantes, 'Solicitante', 'Solicitantes')} de Mediación.
            <br />
            Ciudad. -
          </p>
        </div>
        <div style={{ flex: 1 }}>
          <p style={{ margin: 0 }}>{plural(invitados, 'Señor(a):', 'Señores:')}</p>
          <p style={{ margin: '2mm 0 0' }}>{listaNombres(invitados, true)}</p>
          <p style={{ margin: '3mm 0 0', fontSize: '10pt' }}>
            {plural(invitados, 'Invitado', 'Invitados')} a Mediación.
            <br />
            Ciudad.-
          </p>
        </div>
      </div>

      <p style={pDefault}>
        <Editable value={titulo} onChange={setTitulo} placeholder="Primera invitación" />.
      </p>
      <p style={pDefault}>De mi consideración:</p>

      <p style={pDefault}>
        {plural(solicitantes, 'La persona', 'Las personas')} {listaNombres(solicitantes)},{' '}
        {plural(solicitantes, 'ha solicitado', 'han solicitado')} una Audiencia de Mediación, con{' '}
        {listaNombres(invitados)}, y así poder solucionar, de manera extrajudicial, un conflicto de ámbito{' '}
        <b>
          <Editable value={asunto} onChange={setAsunto} placeholder="ámbito del conflicto" upper />
        </b>
        .
      </p>

      <p style={pDefault}>
        Este centro acepta prestar sus servicios, para cuyo efecto convoca a la Audiencia de
        Mediación que se efectuará el {chipFecha}, a realizarse{' '}
        <Editable value={lugar} onChange={setLugar} placeholder="lugar de la audiencia" multi />.
      </p>

      <p style={pDefault}>
        Agradeceré confirmar su asistencia con el suscrito al teléfono {telefono} o al correo
        electrónico {correo}.
      </p>

      <p style={pDefault}>Atentamente,</p>
      {firma}
    </>
  );

  const cuerpoEmpresa = (
    <>
      <p style={pDefault}>
        <b>{plural(invitados, 'SEÑOR(A):', 'SEÑORES:')}</b>
      </p>
      <p style={pDefault}>{listaNombres(invitados, true)}.</p>
      <p style={pDefault} className={extras.trim() ? undefined : 'extras-vacio'}>
        <Editable
          value={extras}
          onChange={setExtras}
          placeholder="Líneas adicionales (opcional): delegados, cargos…"
          multi
        />
      </p>
      <p style={pDefault}>
        <b>ASUNTO:</b>{' '}
        <Editable value={asunto} onChange={setAsunto} placeholder="asunto" />.
      </p>
      <p style={pDefault}>
        <Editable value={titulo} onChange={setTitulo} placeholder="Primera invitación" />.
      </p>
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
        {listaNombres(solicitantes, true)}, {plural(solicitantes, 'ha solicitado', 'han solicitado')} que
        invite a {listaNombres(invitados)}, para llevar a cabo una audiencia en el Centro de
        Mediación “NUMA”, con el fin de resolver el conflicto mediante acuerdos voluntarios
        extrajudiciales, referente a:{' '}
        <b>
          <Editable value={asunto} onChange={setAsunto} placeholder="asunto" />
        </b>
        .
      </p>

      <p style={pDefault}>
        <b>2.- INVITACIÓN</b>
      </p>
      <p style={pDefault}>
        Este centro acepta prestar sus servicios, para cuyo efecto convoca a la audiencia de
        mediación que se efectuará el {chipFecha},{' '}
        <Editable value={lugar} onChange={setLugar} placeholder="lugar de la audiencia" multi />, lugar donde se procurará un
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

      <p style={pDefault}>
        Agradeceré confirmar su asistencia con el suscrito al teléfono {telefono} o al correo
        electrónico {correo}.
      </p>

      <p style={pDefault}>Atentamente,</p>
      {firma}
    </>
  );

  return (
    <main className="min-h-screen bg-numa-100 print:bg-white">
     <SoloLecturaCtx.Provider value={bloqueada}>
      <style>{`
        @page { size: A4; margin: 0; }
        /* En pantalla la hoja crece con el texto: el membrete (arriba) se queda
           arriba y el pie se pega al final de la hoja, así nunca se encima
           con el texto. Al imprimir, el membrete y el pie van solo en la primera hoja; las
           siguientes quedan en blanco. */
        .membrete { position: absolute; top: 0; left: 0; width: 210mm; height: 297mm; z-index: 0; clip-path: inset(0 0 42mm 0); }
        .membrete-pie { position: absolute; left: 0; bottom: 0; width: 210mm; height: 297mm; z-index: 0; clip-path: inset(255mm 0 0 0); pointer-events: none; }
        .campo-edit { background: #fff7cc; border-bottom: 1px dashed #c9a400; outline: none; padding: 0 1px; cursor: text; border-radius: 2px; }
        .campo-edit:focus { background: #ffefa0; }
        .campo-edit:empty::before { content: attr(data-ph); color: #8a7a20; font-weight: 400; text-transform: none; }
        .pie-capa { position: absolute; bottom: 0; left: 0; width: 210mm; height: 297mm; z-index: 5; pointer-events: none; }
        .pie-capa > div { pointer-events: auto; }
        @media print {
          .campo-edit { background: none !important; border: 0 !important; padding: 0 !important; }
          .campo-edit:empty::before { content: '' !important; }
          .extras-vacio { display: none !important; }
          .pie-capa { position: absolute; top: 0; bottom: auto; }
          html, body { background: #fff !important; }
          .hoja { box-shadow: none !important; margin: 0 !important; min-height: 0 !important; }
          .membrete { position: absolute; clip-path: none; }
          .membrete-pie { display: none; }
        }
      `}</style>

      {/* Panel de datos: no se imprime */}
      <div className="print:hidden max-w-5xl mx-auto px-4 pt-6 pb-4">
        <div className="bg-white border border-numa-200 rounded-sm p-4">
          <Link
            href={
              esRapida
                ? `/agenda?cita=${citaId || citaParam}${cita?.usuario_id ? `&mediador=${cita.usuario_id}` : ''}`
                : `/procesos/${procesoId}`
            }
            className="inline-flex items-center gap-1.5 text-sm text-numa-600 hover:text-numa-900 mb-3"
          >
            <ArrowLeft className="w-4 h-4" />
            {esRapida
              ? 'Volver a la Agenda'
              : esNueva
              ? 'Volver al proceso sin guardar'
              : 'Volver al proceso'}
          </Link>
          <div className="flex items-start justify-between gap-3 mb-3">
            <div>
              <h1 className="text-lg font-semibold text-numa-900">
                {esNueva ? 'Nueva invitación' : 'Invitación'} —{' '}
                {esRapida ? 'rápida (sin proceso)' : proceso.codigo_proceso}
              </h1>
              {cita?.fecha_creacion && (
                <p className="text-xs text-numa-500 mt-1">
                  Invitación creada el{' '}
                  <span className="font-semibold">{fechaCreacionEC(cita.fecha_creacion)}</span>
                  {cita.creado_por && (
                    <>
                      {' '}por <span className="font-semibold">{cita.creado_por}</span>
                    </>
                  )}
                  . Este dato es solo de consulta y no sale impreso.
                </p>
              )}
            </div>
            <div className="flex flex-wrap gap-2 justify-end shrink-0">
              {!bloqueada && (
                <button
                onClick={guardar}
                disabled={guardando || (!esNueva && !citaId)}
                className="inline-flex items-center gap-2 px-4 py-2 bg-numa-900 text-numa-50 rounded-sm text-sm font-medium hover:bg-numa-950 transition-colors disabled:opacity-50"
              >
                <Save className="w-4 h-4" />
                {guardando ? 'Guardando...' : esNueva ? 'Guardar invitación' : 'Guardar cambios'}
              </button>
              )}
              {!esNueva && (
                <button
                  disabled={sinTema}
                  title={sinTema ? 'Escribe el asunto para poder imprimir' : undefined}
                  onClick={() => window.print()}
                  className="inline-flex items-center gap-2 px-4 py-2 border border-numa-300 text-numa-800 bg-white rounded-sm text-sm font-medium hover:bg-numa-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Printer className="w-4 h-4" />
                  Descargar o imprimir
                </button>
              )}
            </div>
          </div>

          {errorGuardar && (
            <p className="mb-3 text-sm text-red-700 bg-red-50 border border-red-200 rounded-sm px-3 py-2">
              {errorGuardar}
            </p>
          )}
          {okGuardar && (
            <p className="mb-3 text-sm text-green-700 bg-green-50 border border-green-200 rounded-sm px-3 py-2">
              {okGuardar}
            </p>
          )}

          {sinTema && !bloqueada && (
            <p className="mb-3 text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-sm px-3 py-2">
              Falta el tema: escribe el asunto sobre el documento y guarda los cambios para poder
              imprimirla.
            </p>
          )}

          {soloLecturaSecretaria && (
            <p className="mb-3 text-sm text-numa-700 bg-numa-50 border border-numa-200 rounded-sm px-3 py-2">
              El mediador ya editó esta invitación: solo puedes verla e imprimirla.
            </p>
          )}

          {bloqueada && !soloLecturaSecretaria && (
            <p className="mb-3 text-sm text-numa-700 bg-numa-50 border border-numa-200 rounded-sm px-3 py-2">
              Esta invitación ya no está pendiente ({cita?.estado === 'realizada' ? 'ya se realizó' : cita?.estado === 'cancelada' ? 'fue cancelada' : 'cambió de estado'}),
              por eso solo se puede imprimir o guardar como PDF. No se puede modificar.
            </p>
          )}

          <p className={`text-xs text-numa-600 mb-3 ${bloqueada ? 'hidden' : ''}`}>
            Escribe directamente sobre el documento: los campos con fondo amarillo se pueden
            editar{esNueva ? ' (la fecha y la hora se eligen tocando el campo de la fecha)' : ''}. Lo
            amarillo no sale impreso.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className={etiqueta}>Modelo</label>
              <select
                className={campo}
                disabled={bloqueada}
                value={modelo}
                onChange={(e) => setModelo(e.target.value as Modelo)}
              >
                <option value="natural">Persona natural</option>
                <option value="empresa">Empresa / institución</option>
              </select>
              {!bloqueada && modelo !== modeloRecomendado && (
                <p className="mt-1 text-[11px] leading-snug rounded-sm border border-amber-300 bg-amber-50 text-amber-800 px-2 py-1">
                  {modeloRecomendado === 'empresa'
                    ? 'Este proceso tiene una empresa o institución: se debería escoger el modelo Empresa / institución.'
                    : 'Este proceso solo tiene personas naturales: se debería escoger el modelo Persona natural.'}
                </p>
              )}
            </div>
            {!esNueva && !esRapida && (
              <div>
                <label className={etiqueta}>Invitación</label>
                <select
                  className={campo}
                  value={citaId}
                  onChange={(e) => {
                    const id = Number(e.target.value);
                    setCitaId(id);
                    const idx = (data.citas || []).findIndex((c: any) => c.id === id);
                    if (idx >= 0) {
                      setTitulo(`${ORDINALES[idx] || `Invitación N.° ${idx + 1}`}${ORDINALES[idx] ? ' invitación' : ''}`);
                      aplicarDocumento(data.citas[idx].documento);
                    }
                  }}
                >
                  {(data.citas || []).map((c: any, i: number) => (
                    <option key={c.id} value={c.id}>
                      #{i + 1} · {c.fecha ? fechaLarga(c.fecha) : ''} · {(c.hora || '').slice(0, 5)}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div>
              <label className={etiqueta}>Fecha del documento</label>
              <input
                type="date"
                className={campo}
                disabled={bloqueada}
                value={fechaEmision}
                onChange={(e) => setFechaEmision(e.target.value)}
              />
            </div>
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
        </div>

        {/* Pie del membrete: solo en pantalla, pegado al final de la hoja. */}
        <div className="membrete-pie">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/images/membrete-numa.jpg"
            alt=""
            style={{ position: 'absolute', top: 0, left: 0, width: '210mm', height: '297mm' }}
          />
        </div>

        {/* Pie: dirección editable; celular y correo fijos (los del administrador de la sucursal). */}
        <div className="pie-capa">
          <div style={{ ...estiloPie, top: '278.5mm', left: '7.5mm', width: '95mm' }}>
            <Editable value={pie} onChange={setPie} placeholder="dirección del pie" multi />
          </div>
          <div
            style={{ ...estiloPie, top: '281mm', right: '4mm', width: '85mm', textAlign: 'right' }}
          >
            Celular: {telefono}
            <br />
            Correo: {correo}
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
                <div style={{ height: `${ESPACIO_SUP_SIGUIENTES}mm` }} />
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
                <div style={{ height: `${ESPACIO_SUP - ESPACIO_SUP_SIGUIENTES}mm` }} />
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
     </SoloLecturaCtx.Provider>
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
