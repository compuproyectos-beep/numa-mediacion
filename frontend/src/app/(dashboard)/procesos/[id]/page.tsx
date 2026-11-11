'use client';

import { mayusInicial } from '@/lib/texto';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useParams, useRouter } from 'next/navigation';
import PasosProceso from '@/components/procesos/PasosProceso';
import { ArrowLeft, Printer, Upload, Calendar as CalendarIcon, Eye, Download, Receipt, FileText, PlayCircle, CheckCircle2, Lock, Clock, Hash } from 'lucide-react';
import { tiempoRestante, useAhora, CuentaRegresiva } from '@/components/actas/NumeroActaPanel';
import PedirAnulacionBoton from '@/components/actas/PedirAnulacionBoton';
import { isAdmin as esAdminSesion } from '@/lib/auth';
import PartesProceso from '@/components/procesos/PartesProceso';
import FacturacionProceso from '@/components/procesos/FacturacionProceso';
import ActaFlujoProceso from '@/components/procesos/ActaFlujoProceso';
import FacturasProceso from '@/components/procesos/FacturasProceso';
import DocFila from '@/components/procesos/DocFila';
import CalendarioAgendaMediador from '@/components/citas/CalendarioAgendaMediador';
import {
  Spinner,
  EmptyState,
  SelectField,
  TextareaField,
  InputField,
  ErrorAlert,
  SuccessAlert,
  Modal,
  ConfirmDialog,
  Pill
} from '@/components/ui';
import { estadoLabel, estadoLabelProceso, estadoPill } from '@/lib/estados';
import { conActa, esNoAcuerdo, dinero } from '@/lib/actaProceso';
import { hoyEcuador } from '@/lib/accionProceso';

import {
  getProcesos,
  getCitasProceso,
  solicitarActaNoAcuerdo,
  reactivarProceso,
  crearInvitacionProceso,
  leerInvitacionLlena,
  getAvancesProceso,
  crearAvanceProceso,
  subirActaFinalProceso,
  getMiNumeroActa,
  anularProceso,
  getExpedienteProceso,
  getCitas,
  descargarPdfActaFinal,
  descargarComprobantePagoActaFinal,
  pedirNumeroActaProceso,
  desbloquearActa,
  getUsuarios,
  reasignarMediadorProceso,
  getHistorialAsignacion,
} from '@/lib/services';

// Mismos colores que ya se usan en la Agenda (ver colorPorEstado en
// CalendarioAgendaMediador) para el estado de una invitación — así una
// invitación pendiente/realizada/cancelada se identifica igual en los dos
// lugares del sistema.
const getEstadoCitaBadgeClass = (estado: string) => {
  const classes: any = {
    pendiente: 'bg-gold-400/10 text-gold-700',
    realizada: 'bg-green-50 text-green-700',
    no_realizada: 'bg-stone-100 text-stone-700',
    cancelada: 'bg-red-50 text-red-700',
    reagendada: 'bg-numa-100 text-numa-800'
  };

  return classes[estado] || 'bg-numa-100 text-numa-700';
};

const getEstadoCitaBorderClass = (estado: string) => {
  const classes: any = {
    pendiente: 'border-l-gold-400',
    realizada: 'border-l-green-600',
    no_realizada: 'border-l-stone-400',
    cancelada: 'border-l-red-600',
    reagendada: 'border-l-numa-600'
  };

  return classes[estado] || 'border-l-numa-200';
};

// Una invitación "pendiente" cuya fecha y hora ya pasaron está atrasada:
// nadie registró cómo terminó. Se marca en rojo para que no se olvide.
const citaEstaAtrasada = (cita: any) => {
  if (!cita || cita.estado !== 'pendiente') return false;
  const fecha = String(cita.fecha || '').slice(0, 10);
  const hora = String(cita.hora || '').slice(0, 5) || '00:00';
  const momento = new Date(`${fecha}T${hora}:00`);
  return !isNaN(momento.getTime()) && momento.getTime() < Date.now();
};

// Fecha en letras (ej. "lunes, 26 de octubre de 2026") a partir de "AAAA-MM-DD".
function fechaLargaEC(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('es-EC', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

// Al pasar de un proceso a otro (por ejemplo desde una notificación) la pantalla
// se reinicia, para que no queden datos ni formularios abiertos del anterior.
export default function ProcesoDetallePage() {
  const { id } = useParams();
  return <ProcesoDetalleContenido key={String(id)} />;
}

function ProcesoDetalleContenido() {
  const params = useParams();
  const router = useRouter();
  // "Volver" regresa a la pantalla de donde vino la persona (Actas finales, Agenda, etc.); si no hay historial, va a Procesos.
  const volverAtras = () => {
    if (typeof window !== 'undefined' && window.history.length > 1) router.back();
    else router.push('/procesos');
  };
  const procesoId = Number(params.id);

  const [proceso, setProceso] = useState<any | null>(null);
  const [loadingProceso, setLoadingProceso] = useState(true);

  // Si este proceso está "cerrado con acuerdo" pero NO es el primero en la
  // fila para subir acta (ver la regla de fila FIFO en el backend), aquí
  // se guarda cuál es el que sí lo es, para poder mostrarlo por nombre en
  // el aviso en vez de solo decir "hay otro proceso con prioridad".
  const [procesoPrimeroEnFila, setProcesoPrimeroEnFila] = useState<any | null>(null);
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  const [citasProceso, setCitasProceso] = useState<any[]>([]);
  // Empieza en true: así, mientras llega la línea de tiempo se ve el círculo
  // de carga y no un instante de "sin invitaciones" (parecía vacía).
  const [loadingCitas, setLoadingCitas] = useState(true);

  const [avancesProceso, setAvancesProceso] = useState<any[]>([]);
  const [loadingAvances, setLoadingAvances] = useState(false);

  const [expedienteProceso, setExpedienteProceso] = useState<any | null>(null);
  // ¿Ya tiene datos de facturación? (obligatorios antes de subir el acta)
  const [tieneFacturacion, setTieneFacturacion] = useState<boolean | null>(null);
  const [loadingExpediente, setLoadingExpediente] = useState(false);

  const [invitacionForm, setInvitacionForm] = useState({
    fecha: '',
    hora: '',
    observaciones: ''
  });
  const [guardandoInvitacion, setGuardandoInvitacion] = useState(false);
  // Candado sincrónico contra doble clic: setGuardandoInvitacion(true) no
  // deshabilita el botón hasta el siguiente render, así que dos clics muy
  // seguidos podían disparar dos peticiones antes de que React pintara el
  // botón como disabled. Este ref se marca de inmediato, sin esperar a
  // ningún render, y es la primera línea de defensa antes del candado
  // real que ahora vive en la base de datos (ver migración 005).
  const enviandoInvitacionRef = useRef(false);
  const [mostrarCalendarioInvitacion, setMostrarCalendarioInvitacion] = useState(false);

  // Camino A: el mediador sube la invitación ya llena (Word o PDF), el
  // sistema la lee y rellena el formulario; el mediador revisa y crea.
  const [leyendoInvitacion, setLeyendoInvitacion] = useState(false);
  const [lecturaInvitacion, setLecturaInvitacion] = useState<any | null>(null);
  const archivoInvitacionRef = useRef<HTMLInputElement | null>(null);

  const handleLeerInvitacion = async (file: File | null) => {
    if (!file || !proceso) return;
    setLeyendoInvitacion(true);
    setError('');
    setSuccessMessage('');
    setLecturaInvitacion(null);
    try {
      const lectura = await leerInvitacionLlena(proceso.id, file);
      setLecturaInvitacion(lectura);
      const orden = ['Primera', 'Segunda', 'Tercera', 'Cuarta', 'Quinta', 'Sexta'];
      setInvitacionForm((prev) => ({
        // Si el documento nuevo no trae fecha u hora, se vacían: así no queda
        // la fecha de un documento anterior por error.
        fecha: lectura.fecha || '',
        hora: lectura.hora || '',
        observaciones:
          prev.observaciones ||
          (lectura.ordinal && orden[lectura.ordinal - 1]
            ? `${orden[lectura.ordinal - 1]} invitación`
            : '')
      }));
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'No se pudo leer el archivo');
    } finally {
      setLeyendoInvitacion(false);
      if (archivoInvitacionRef.current) archivoInvitacionRef.current.value = '';
    }
  };
  const [citasMediador, setCitasMediador] = useState<any[]>([]);

  // Al elegir fecha y hora en el calendario (botón "Usar esta fecha y
  // hora"), el calendario se oculta y aparece más abajo la sección de
  // Fecha/Hora/Observaciones — igual que en la Agenda, se baja la
  // pantalla sola hasta ahí para que no se quede "estática" a la vista.
  const observacionesRef = useRef<HTMLDivElement>(null);

  const bajarAObservaciones = () => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        observacionesRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      });
    });
  };

  // Cerrar o archivar un proceso no se puede deshacer, así que antes de
  // registrarlo se pide una confirmación en pantalla.
  const [confirmandoCierre, setConfirmandoCierre] = useState(false);
  const [anulando, setAnulando] = useState(false);
  const [motivoAnulacion, setMotivoAnulacion] = useState('');
  const [guardandoAnulacion, setGuardandoAnulacion] = useState(false);
  const [avanceForm, setAvanceForm] = useState({
    resultado: 'en_negociacion',
    observacion: ''
  });
  const [guardandoAvance, setGuardandoAvance] = useState(false);
  // Si el mediador tiene un acta vencida (más de 48 horas), no puede cerrar
  // con acta: acuerdo ni no acuerdo (necesitan un número nuevo).
  const [bloqueoNumero, setBloqueoNumero] = useState<string | null>(null);
  useEffect(() => {
    if (!proceso?.id || esAdminSesion()) return;
    getMiNumeroActa()
      .then((r: any) => setBloqueoNumero(r?.puede_pedir === false ? r?.motivo || 'Tienes un acta pendiente.' : null))
      .catch(() => setBloqueoNumero(null));
  }, [proceso?.id]);
  const cierreConActaBloqueado = !!bloqueoNumero && !proceso?.numero_acta_codigo;

  // Borrador del texto del resultado: se conserva si el mediador sale a otra pantalla.
  const claveBorrador = proceso?.id ? `borrador-resultado-${proceso.id}` : '';
  useEffect(() => {
    if (!claveBorrador) return;
    try {
      const guardado = window.localStorage.getItem(claveBorrador);
      if (guardado) setAvanceForm((f) => (f.observacion ? f : { ...f, observacion: guardado }));
    } catch {}
  }, [claveBorrador]);

  const ahoraReloj = useAhora();
  // Al cumplirse el plazo de 48 horas el acta se bloquea sola; se recarga el proceso una vez
  // para que la pantalla refleje el bloqueo sin que la persona tenga que actualizar.
  const recargadoPorPlazo = useRef(false);
  useEffect(() => {
    const v = proceso?.numero_acta_vence_en;
    if (!v || proceso?.numero_acta_estado !== 'reservado') {
      recargadoPorPlazo.current = false;
      return;
    }
    const iso = String(v).replace(' ', 'T');
    const d = new Date(/(Z|[+-]\d\d:?\d\d)$/.test(iso) ? iso : `${iso}Z`);
    if (!isNaN(d.getTime()) && d.getTime() <= ahoraReloj && !recargadoPorPlazo.current) {
      recargadoPorPlazo.current = true;
      cargarProceso();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ahoraReloj, proceso?.numero_acta_vence_en, proceso?.numero_acta_estado]);
  // Lugar de la barra de arriba (junto a la campana) donde va el botón "Volver".
  const [slotVolver, setSlotVolver] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setSlotVolver(document.getElementById('barra-izquierda'));
  }, []);
  // Aviso grande cuando el sistema acaba de dar un número de acta nuevo.
  const [avisoNumero, setAvisoNumero] = useState<string | null>(null);
  const [desbloqueandoActa, setDesbloqueandoActa] = useState(false);
  const [confirmoActaFinal, setConfirmoActaFinal] = useState(false);
  const [confirmDesbloqueo, setConfirmDesbloqueo] = useState(false);
  const [reasignando, setReasignando] = useState(false);
  const [historialAsignacion, setHistorialAsignacion] = useState<any[]>([]);
  useEffect(() => {
    if (!esAdminSesion() || !proceso?.id) return;
    getHistorialAsignacion(Number(proceso.id)).then(setHistorialAsignacion).catch(() => setHistorialAsignacion([]));
  }, [proceso?.id, proceso?.usuario_id]);
  const [candidatosMediador, setCandidatosMediador] = useState<any[]>([]);
  const [nuevoMediadorId, setNuevoMediadorId] = useState('');
  const [guardandoReasignacion, setGuardandoReasignacion] = useState(false);
  const abrirReasignar = async () => {
    setReasignando(true);
    setNuevoMediadorId('');
    try {
      setCandidatosMediador(await getUsuarios());
    } catch {
      setCandidatosMediador([]);
    }
  };
  const confirmarReasignar = async () => {
    if (!proceso || !nuevoMediadorId) return;
    setGuardandoReasignacion(true);
    setError('');
    try {
      const r = await reasignarMediadorProceso(Number(proceso.id), Number(nuevoMediadorId));
      setReasignando(false);
      setSuccessMessage(`Proceso reasignado a ${r?.mediador ?? 'el nuevo mediador'}. Tiene 48 horas nuevas para completar el acta.`);
      window.location.reload();
    } catch (e: any) {
      const d = e?.response?.data?.detail;
      setError(typeof d === 'string' ? d : 'No se pudo reasignar el proceso');
    } finally {
      setGuardandoReasignacion(false);
    }
  };
  const desbloquearDesdeProceso = async () => {
    setConfirmDesbloqueo(false);
    if (!proceso?.bloqueo_acta_id) return;
    setDesbloqueandoActa(true);
    setError('');
    try {
      const r = await desbloquearActa(proceso.bloqueo_acta_id);
      await cargarProceso();
      setSuccessMessage(
        r?.mismo_numero
          ? `Acta desbloqueada. El mediador recibió el número ${r.codigo} (nadie más lo había tomado) y tiene 48 horas nuevas.`
          : `Acta desbloqueada. El mediador recibió el número nuevo ${r?.codigo}: debe rehacer y volver a firmar el acta con ese número, y tiene 48 horas nuevas.`
      );
    } catch (e: any) {
      setError(e?.response?.data?.detail || 'No se pudo desbloquear el acta');
    } finally {
      setDesbloqueandoActa(false);
    }
  };
  const [showActaFinal, setShowActaFinal] = useState(false);
  const [archivoActaFinal, setArchivoActaFinal] = useState<File | null>(null);
  const [archivoComprobantePago, setArchivoComprobantePago] = useState<File | null>(null);
  const [subiendoActaFinal, setSubiendoActaFinal] = useState(false);
  // Pago del acta: completo (un comprobante) o en abonos (primer abono ahora,
  // el saldo se paga y se sube con el acta firmada).
  const [pagoModo, setPagoModo] = useState<'completo' | 'abonos'>('completo');
  const [formaPago, setFormaPago] = useState<'deposito' | 'efectivo'>('deposito');
  const [montoTotal, setMontoTotal] = useState('');
  const [montoAbono, setMontoAbono] = useState('');
  const [fechaPago, setFechaPago] = useState(hoyEcuador());
  // Números de acta que el mediador pidió y aún no usó: elige cuál corresponde
  // a esta acta (debe coincidir con la que redactó).
  const [numerosPedidos, setNumerosPedidos] = useState<any[]>([]);
  const [pidiendoNumero, setPidiendoNumero] = useState(false);
  const [errorNumero, setErrorNumero] = useState('');
  const pedirNumeroProceso = async () => {
    setPidiendoNumero(true);
    setErrorNumero('');
    try {
      await pedirNumeroActaProceso(proceso.id);
      await cargarProceso();
    } catch (e: any) {
      setErrorNumero(e?.response?.data?.detail || 'No se pudo pedir el número de acta');
    } finally {
      setPidiendoNumero(false);
    }
  };
  const [numeroActaId, setNumeroActaId] = useState('');

  const cargarProceso = async () => {
    try {
      // Se pide solo este proceso (antes se traían todos y se buscaba el
      // que tocaba: era lo que hacía lenta la apertura).
      let procesos = await getProcesos({ proceso_id: procesoId });
      let encontrado = procesos.find((p: any) => p.id === procesoId) || null;

      // Si se acaba de crear el proceso y por alguna razón no aparece en el
      // primer intento, se reintenta una vez antes de mostrar "no encontrado".
      if (!encontrado) {
        await new Promise((resolve) => setTimeout(resolve, 600));
        procesos = await getProcesos({ proceso_id: procesoId });
        encontrado = procesos.find((p: any) => p.id === procesoId) || null;
      }

      setProceso(encontrado);

      // Si este proceso espera su acta pero otro del mismo mediador va
      // primero en la fila, se busca cuál es para nombrarlo en el aviso. El
      // administrador no está sujeto a la fila.
      if (encontrado && encontrado.bloqueante_id && !esAdminSesion()) {
        const delante = await getProcesos({ proceso_id: encontrado.bloqueante_id });
        const primero = delante.find((p: any) => p.id === encontrado.bloqueante_id);
        setProcesoPrimeroEnFila(primero || null);
      } else {
        setProcesoPrimeroEnFila(null);
      }

      return encontrado;
    } catch {
      setError('Error al cargar el proceso');
      return null;
    }
  };

  // silencioso: recarga sin mostrar los círculos de carga (se usa al volver
  // a la pestaña, para que la pantalla no parpadee).
  const cargarSeguimiento = async (
    p: any,
    silencioso = false,
    citasAdelantadas?: Promise<any[] | null>,
    avancesAdelantados?: Promise<any[] | null>
  ) => {
    if (p?.finalizado || p?.estado === 'archivado') {
      if (!silencioso) setLoadingExpediente(true);

      try {
        const data = await getExpedienteProceso(p.id);

        setExpedienteProceso(data);
        setCitasProceso(data.linea_tiempo || []);
        setAvancesProceso(data.linea_tiempo || []);
      } catch (err: any) {
        setError(
          err?.response?.data?.detail ||
          'No se pudo cargar el expediente del proceso'
        );
      } finally {
        setLoadingExpediente(false);
        setLoadingCitas(false);
      }

      return;
    }

    if (!silencioso) setLoadingCitas(true);

    try {
      let citas = (citasAdelantadas ? await citasAdelantadas : null) ?? (await getCitasProceso(p.id));
      // Recién creado el proceso (por ejemplo desde una invitación rápida) la
      // lista puede llegar vacía un instante: se vuelve a pedir una vez antes
      // de dar por hecho que no hay invitaciones.
      if (citas.length === 0) {
        await new Promise((resolve) => setTimeout(resolve, 1200));
        citas = await getCitasProceso(p.id);
      }
      setCitasProceso(citas);
    } catch {
      setCitasProceso([]);
    } finally {
      setLoadingCitas(false);
    }

    if (!silencioso) setLoadingAvances(true);

    try {
      const avances =
        (avancesAdelantados ? await avancesAdelantados : null) ?? (await getAvancesProceso(p.id));
      setAvancesProceso(avances);
    } catch {
      setAvancesProceso([]);
    } finally {
      setLoadingAvances(false);
    }
  };

  useEffect(() => {
    (async () => {
      setLoadingProceso(true);

      // Las invitaciones se piden al mismo tiempo que el proceso (en vez de
      // esperar a que termine de cargar la lista de procesos): la pantalla
      // queda lista varios segundos antes.
      const citasAdelantadas = getCitasProceso(procesoId).catch(() => null);
      const avancesAdelantados = getAvancesProceso(procesoId).catch(() => null);

      const p = await cargarProceso();

      setLoadingProceso(false);

      if (p) await cargarSeguimiento(p, false, citasAdelantadas, avancesAdelantados);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [procesoId]);

  // La invitación se redacta en otra pestaña ("Redactar sobre el documento").
  // Al volver a esta pestaña se recargan el proceso y su seguimiento, para que
  // la invitación recién creada aparezca sin tener que refrescar a mano.
  useEffect(() => {
    let ultima = Date.now();
    const alVolver = async () => {
      if (document.visibilityState !== 'visible') return;
      if (Date.now() - ultima < 15000) return;
      ultima = Date.now();
      const p = await cargarProceso();
      if (p) await cargarSeguimiento(p, true);
    };
    document.addEventListener('visibilitychange', alVolver);
    window.addEventListener('focus', alVolver);
    return () => {
      document.removeEventListener('visibilitychange', alVolver);
      window.removeEventListener('focus', alVolver);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [procesoId]);

  // Todas las invitaciones pendientes de este mediador (en cualquier
  // proceso), para poder avisar de una vez si la fecha/hora elegida ya
  // está ocupada, sin tener que esperar al error del servidor al enviar.
  const cargarCitasMediador = async (usuarioId: number) => {
    try {
      const data = await getCitas({ usuario_id: usuarioId, estado: 'pendiente' });
      setCitasMediador(data);
    } catch {
      setCitasMediador([]);
    }
  };

  useEffect(() => {
    if (proceso?.usuario_id) {
      cargarCitasMediador(proceso.usuario_id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [proceso?.usuario_id]);

  // Cada invitación ocupa 1 hora: con una a las 09:00, la siguiente puede ser
  // recién a las 10:00 (y la anterior, hasta las 08:00).
  const aMinutosHora = (h?: string) => {
    const [hh, mm] = String(h || '').split(':').map(Number);
    return (hh || 0) * 60 + (mm || 0);
  };
  const horaChocanteInvitacion =
    invitacionForm.fecha && invitacionForm.hora
      ? citasMediador.find(
          (c) =>
            c.fecha === invitacionForm.fecha &&
            Math.abs(aMinutosHora(c.hora?.slice(0, 5)) - aMinutosHora(invitacionForm.hora)) < 60
        )
      : undefined;
  const horaInvitacionOcupada = !!horaChocanteInvitacion;

  const handleCrearInvitacion = async () => {
    if (!proceso) return;

    // Corta de inmediato un segundo clic mientras el primero todavía está
    // en vuelo, sin depender de que React ya haya vuelto a pintar el
    // botón como disabled.
    if (enviandoInvitacionRef.current) return;

    if (!invitacionForm.fecha || !invitacionForm.hora) {
      setError('Debe ingresar fecha y hora');
      return;
    }

    if (horaInvitacionOcupada) {
      setError(`Choca con tu invitación de las ${horaChocanteInvitacion?.hora?.slice(0, 5)}: cada invitación dura 1 hora, debe haber al menos 1 hora entre una y otra. Elige otra hora.`);
      return;
    }

    enviandoInvitacionRef.current = true;
    setGuardandoInvitacion(true);
    setError('');
    setSuccessMessage('');

    const fechaEnviada = invitacionForm.fecha;
    const horaEnviada = invitacionForm.hora;

    try {
      await crearInvitacionProceso(proceso.id, invitacionForm);

      const data = await getCitasProceso(proceso.id);
      setCitasProceso(data);

      if (proceso.usuario_id) await cargarCitasMediador(proceso.usuario_id);

      setInvitacionForm({ fecha: '', hora: '', observaciones: '' });
      setLecturaInvitacion(null);

      setSuccessMessage(
        `Invitación creada para el ${fechaEnviada} a las ${horaEnviada}. Ya aparece en la línea de tiempo del proceso.`
      );
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'Error al crear invitación');
    } finally {
      enviandoInvitacionRef.current = false;
      setGuardandoInvitacion(false);
    }
  };

  const handleCrearAvance = async (yaConfirmado = false) => {
    if (!proceso) return;

    if (!avanceForm.observacion.trim()) {
      setError('Debe ingresar una observación');
      return;
    }

    // "En negociación" y "No asistió" no cierran el proceso: no piden la
    // confirmación de cierre.
    if (
      avanceForm.resultado !== 'en_negociacion' &&
      avanceForm.resultado !== 'no_realizada' &&
      !yaConfirmado
    ) {
      setError('');
      setConfirmandoCierre(true);
      return;
    }

    setConfirmandoCierre(false);

    setGuardandoAvance(true);
    setError('');
    setSuccessMessage('');

    // "Cerrado con no acuerdo" = cierra sin acuerdo y pide el acta de no
    // acuerdo de una vez (las partes asistieron y no se pusieron de acuerdo).
    const conActaNoAcuerdo = avanceForm.resultado === 'cerrado_no_acuerdo';

    try {
      const respAvance = await crearAvanceProceso(proceso.id, {
        resultado: avanceForm.resultado,
        observacion: avanceForm.observacion
      });
      if (respAvance?.numero_acta_nuevo && respAvance?.numero_acta_asignado) {
        setAvisoNumero(respAvance.numero_acta_asignado);
      }

      const avances = await getAvancesProceso(proceso.id);
      setAvancesProceso(avances);

      const citas = await getCitasProceso(proceso.id);
      setCitasProceso(citas);

      await cargarProceso();

      setAvanceForm({
        resultado: 'en_negociacion',
        observacion: ''
      });
      try {
        window.localStorage.removeItem(claveBorrador);
      } catch {}

      setSuccessMessage(
        conActaNoAcuerdo
          ? 'Proceso cerrado con no acuerdo. Sube la documentación del acta de no acuerdo y el comprobante de pago.'
          : `Resultado registrado: ${estadoLabel(avanceForm.resultado)}.`
      );
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'Error al registrar el resultado');
    } finally {
      setGuardandoAvance(false);
    }
  };

  const handleAnularProceso = async () => {
    if (!proceso) return;

    if (motivoAnulacion.trim().length < 5) {
      setError('Escribe el motivo de la anulación (mínimo 5 caracteres).');
      return;
    }

    setGuardandoAnulacion(true);
    setError('');
    setSuccessMessage('');

    try {
      await anularProceso(proceso.id, motivoAnulacion.trim());
      setAnulando(false);
      setMotivoAnulacion('');
      const p = await cargarProceso();
      if (p) await cargarSeguimiento(p);
      setSuccessMessage('Proceso anulado. Su número de acta queda libre para otro mediador de la sucursal.');
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'No se pudo anular el proceso');
    } finally {
      setGuardandoAnulacion(false);
    }
  };

  const handleSubirActaFinal = async () => {
    if (!proceso || !archivoActaFinal || (formaPago === 'deposito' && !archivoComprobantePago)) {
      setError(formaPago === 'efectivo'
        ? 'Debe seleccionar los documentos del acta (PDF)'
        : 'Debe seleccionar los documentos del acta (PDF) y el comprobante de pago');
      return;
    }
    if (formaPago === 'efectivo' && pagoModo === 'completo' && !(Number(montoTotal) > 0)) {
      setError('Indica cuánto dinero se recibió en efectivo');
      return;
    }

    if (numerosPedidos.length > 1 && !numeroActaId && !esAdminSesion()) {
      setError('Elige el número de acta que corresponde a esta acta');
      return;
    }

    if (pagoModo === 'abonos') {
      const total = Number(montoTotal);
      const abono = Number(montoAbono);
      if (!(total > 0) || !(abono > 0)) {
        setError('Indica el valor total y lo que se pagó en este primer abono');
        return;
      }
      if (abono >= total) {
        setError('El primer abono debe ser menor al valor total. Si ya se pagó todo, elige "Pago completo".');
        return;
      }
    }

    setSubiendoActaFinal(true);
    setError('');
    setSuccessMessage('');

    try {
      const data = await subirActaFinalProceso(
        proceso.id,
        archivoActaFinal,
        formaPago === 'efectivo' ? null : archivoComprobantePago,
        {
          modo: pagoModo,
          forma: formaPago,
          fecha: fechaPago || undefined,
          montoTotal: (pagoModo === 'abonos' || formaPago === 'efectivo') ? Number(montoTotal) : undefined,
          montoAbono: pagoModo === 'abonos' ? Number(montoAbono) : undefined
        },
        numeroActaId ? Number(numeroActaId) : undefined
      );

      setShowActaFinal(false);
      setArchivoActaFinal(null);
      setArchivoComprobantePago(null);
      setPagoModo('completo');
      setFormaPago('deposito');
      setMontoTotal('');
      setMontoAbono('');
      setFechaPago(hoyEcuador());

      const p = await cargarProceso();
      if (p) await cargarSeguimiento(p);

      setConfirmoActaFinal(false);
      setSuccessMessage(formaPago === 'efectivo'
        ? `${esNoAcuerdo(proceso) ? 'Documentos del acta de no acuerdo' : 'Documentos del acta'} subidos: ${data.codigo_acta}. Falta marcar que el efectivo ya se depositó para completar el proceso.`
        : `${esNoAcuerdo(proceso) ? 'Documentos del acta de no acuerdo' : 'Documentos del acta'} y comprobante de pago subidos correctamente: ${data.codigo_acta}`);
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'Error al subir los documentos del acta y el comprobante de pago');
    } finally {
      setSubiendoActaFinal(false);
    }
  };

  // Permiten ver/descargar el acta final (y su comprobante) directo desde
  // la ficha del proceso — antes había que anotar el código del acta y
  // buscarla a mano en Actas Finales.
  const handleVerPdfActaFinal = async (actaId: number) => {
    try {
      const blob = await descargarPdfActaFinal(actaId);
      const url = window.URL.createObjectURL(blob);
      window.open(url, '_blank');
    } catch {
      setError('No se pudo abrir los documentos del acta');
    }
  };

  const handleDescargarPdfActaFinal = async (actaId: number, codigoActa: string) => {
    try {
      const blob = await descargarPdfActaFinal(actaId);
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');

      link.href = url;
      link.download = `${codigoActa}.pdf`;

      document.body.appendChild(link);
      link.click();
      link.remove();

      window.URL.revokeObjectURL(url);
    } catch {
      setError('No se pudo descargar los documentos del acta');
    }
  };

  const handleVerComprobanteActaFinal = async (actaId: number) => {
    try {
      const blob = await descargarComprobantePagoActaFinal(actaId);
      const url = window.URL.createObjectURL(blob);
      window.open(url, '_blank');
    } catch {
      setError('No se pudo abrir el comprobante de pago');
    }
  };

  const handleDescargarComprobanteActaFinal = async (
    actaId: number,
    codigoActa: string,
    nombreComprobante?: string
  ) => {
    try {
      const blob = await descargarComprobantePagoActaFinal(actaId);
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');

      const extension = nombreComprobante?.includes('.')
        ? nombreComprobante.split('.').pop()
        : 'pdf';

      link.href = url;
      link.download = `comprobante_${codigoActa}.${extension}`;

      document.body.appendChild(link);
      link.click();
      link.remove();

      window.URL.revokeObjectURL(url);
    } catch {
      setError('No se pudo descargar el comprobante de pago');
    }
  };

  const citaPendiente = citasProceso.find((c: any) => c.estado === 'pendiente');
  // El resultado de la reunión solo se registra cuando ya llegó su hora (hora de Ecuador).
  const reunionYaLlego = citaPendiente
    ? new Date(
        `${String(citaPendiente.fecha || '').slice(0, 10)}T${String(citaPendiente.hora || '00:00').slice(0, 5)}:00-05:00`
      ).getTime() <= Date.now()
    : false;

  // "Siguiente paso": una línea que le dice al mediador qué le toca hacer
  // ahora en este proceso, según su estado y sus invitaciones.
  const siguientePaso = (() => {
    if (!proceso) return null;

    if (proceso.etapa_acta === 'suspendido') {
      return String(proceso.motivo_suspension || '').startsWith('Baja del acta')
        ? 'El administrador dio de baja el acta y este proceso: ya no continúa.'
        : 'Este proceso está suspendido por el administrador.';
    }

    if (proceso.bloqueo_acta_id) {
      return esAdminSesion()
        ? 'El acta está bloqueada por pasar 48 horas. Desbloquéala para que el mediador pueda continuar.'
        : 'El acta está bloqueada por pasar 48 horas. Pide al administrador que la desbloquee.';
    }

    if (proceso.etapa_acta === 'falta_firmada') {
      if (proceso.efectivo_pendiente && !proceso.pago_pendiente) {
        return 'Falta depositar el efectivo en la cuenta de NUMA. Cuando lo hagas, marca «Efectivo ya depositado» para completar el proceso.';
      }
      return proceso.pago_pendiente
        ? 'Falta el comprobante del segundo pago (el saldo). Súbelo para completar el proceso; mientras tanto no puedes subir otras actas.'
        : 'Haz que firmen el acta las partes y el mediador y sube el acta firmada en PDF para completar el proceso.';
    }

    if (proceso.finalizado) {
      return 'Este proceso está completo. Puedes consultar el historial.';
    }

    if (proceso.estado === 'anulado') {
      return 'Este proceso fue anulado. Solo puedes consultar su historial.';
    }

    if (conActa(proceso) && procesoPrimeroEnFila) {
      return `Primero completa el acta ${procesoPrimeroEnFila.numero_acta_codigo || `del proceso ${procesoPrimeroEnFila.codigo_proceso}`}, que ya pasó las 48 horas.`;
    }

    if (conActa(proceso) && tieneFacturacion === false && !proceso.sin_factura) {
      return 'Completa los datos de facturación y luego sube la documentación y el comprobante de pago.';
    }

    if (conActa(proceso)) {
      return 'Sube la documentación y el comprobante de pago para finalizar el proceso.';
    }

    if (proceso.estado === 'cerrado_sin_acuerdo') {
      return 'Este proceso cerró sin acuerdo. Si lo necesitas, puedes emitir el acta de no acuerdo; si no, solo consulta su historial.';
    }

    if (proceso.estado === 'archivado') {
      return 'Este proceso ya está cerrado. Solo puedes consultar su historial.';
    }

    if (citaPendiente) {
      const fechaCitaIso = String(citaPendiente.fecha || '').slice(0, 10);
      const fechaCita = fechaLargaEC(fechaCitaIso);
      const horaCita = String(citaPendiente.hora || '').slice(0, 5);
      const fechaHoraCita = new Date(`${fechaCitaIso}T${horaCita || '00:00'}:00`);
      const yaPaso = !isNaN(fechaHoraCita.getTime()) && fechaHoraCita.getTime() < Date.now();

      return yaPaso
        ? `La invitación del ${fechaCita} a las ${horaCita} ya pasó. Registra cómo terminó la reunión en "Registrar resultado".`
        : `Tienes una invitación pendiente para el ${fechaCita} a las ${horaCita}. Cuando se realice, registra su resultado.`;
    }

    return citasProceso.length === 0
      ? 'Agenda la primera invitación para iniciar la mediación.'
      : 'Todas las invitaciones están resueltas. Agenda la siguiente invitación o cierra el proceso.';
  })();

  // Línea de pasos de arriba. Si el proceso cierra sin acuerdo o se archiva,
  // el camino termina en "Resultado"; si hay acuerdo, sigue con facturación,
  // acta y acta firmada. Un proceso anulado no muestra la línea.
  const pasosProceso = (() => {
    if (!proceso || proceso.estado === 'anulado') return null;

    const hayInvitacion = citasProceso.length > 0;
    const cerrado = proceso.estado !== 'en_negociacion';
    // Lleva facturación, acta y acta firmada si cerró con acuerdo o si se
    // pidió el acta de no acuerdo.
    const conAcuerdo = conActa(proceso);

    const base = [
      // Si el proceso ya cerró, es porque hubo al menos una invitación.
      { etiqueta: 'Invitación', hecho: hayInvitacion || cerrado },
      { etiqueta: 'Resultado', hecho: cerrado }
    ];

    if (cerrado && !conAcuerdo) return base;

    return [
      ...base,
      { etiqueta: 'Facturación', hecho: tieneFacturacion === true || !!proceso.sin_factura },
      { etiqueta: 'Documentación y comprobante', hecho: !!proceso.finalizado },
      {
        etiqueta: 'Acta firmada',
        hecho: !!proceso.finalizado && proceso.etapa_acta !== 'falta_firmada'
      }
    ];
  })();

  // El backend guarda fecha_acuerdo con NOW() en UTC, pero como la columna
  // es TIMESTAMP sin zona horaria, psycopg2/FastAPI la devuelven como texto
  // "naive" (sin la "Z" al final). Si se le pasa tal cual a `new Date(...)`,
  // el navegador la interpreta como hora LOCAL en vez de UTC, y en Ecuador
  // (UTC-5) eso adelantaba el plazo 5 horas de más (por eso se veían "52h"
  // en vez de 47h). Aquí se le agrega la "Z" cuando no la trae, para que
  // siempre se interprete como UTC.
  const parseFechaUTC = (valor: string) => {
    if (!valor) return null;
    const tieneZonaHoraria = /Z$|[+-]\d{2}:?\d{2}$/.test(valor);
    return new Date(tieneZonaHoraria ? valor : `${valor}Z`);
  };

  // Da un texto legible, en días y horas: 36 horas se muestran como
  // "1 día y 12 horas". Si falta menos de un día, se muestra en horas y
  // minutos ("5 horas y 30 minutos").
  const formatDuracion = (horas: number, minutos: number) => {
    const dias = Math.floor(horas / 24);
    const horasRestantes = horas % 24;

    const partes: string[] = [];
    if (dias > 0) partes.push(`${dias} día${dias > 1 ? 's' : ''}`);
    if (horasRestantes > 0) {
      partes.push(`${horasRestantes} hora${horasRestantes > 1 ? 's' : ''}`);
    }
    // Los minutos solo se muestran si no hay días completos, para que el
    // texto sea corto ("1 día y 12 horas") y no confunda.
    if (dias === 0 && (minutos > 0 || partes.length === 0)) {
      partes.push(`${minutos} minuto${minutos !== 1 ? 's' : ''}`);
    }

    return partes.length > 1
      ? `${partes.slice(0, -1).join(', ')} y ${partes[partes.length - 1]}`
      : partes[0];
  };

  if (loadingProceso) {
    return (
      <>
        <Spinner />
      </>
    );
  }

  if (!proceso) {
    return (
      <>
        <button onClick={volverAtras} className="btn-ghost text-sm mb-4">
          <ArrowLeft className="w-4 h-4" />
          Volver
        </button>

        <EmptyState message="Proceso no encontrado." />
      </>
    );
  }

  return (
    <div className="vista-proceso">
      {/* "Volver" va en la barra de arriba, al nivel de la campana, para ganar espacio. */}
      {(() => {
        const boton = (
          <button onClick={volverAtras} className="btn-ghost text-sm -ml-2">
            <ArrowLeft className="w-4 h-4" />
            Volver
          </button>
        );
        return slotVolver ? createPortal(boton, slotVolver) : <div className="mb-4">{boton}</div>;
      })()}

      {/* En celular el título y los botones van uno debajo del otro (para que el
          código y los nombres no queden apretados); desde pantallas medianas
          vuelven a ir lado a lado como antes. */}
      <div className="page-header items-start flex-col gap-3 sm:flex-row sm:gap-0">
        <div>
          {proceso.numero_acta_codigo ? (
            <>
              <h1 className="section-title whitespace-nowrap font-mono text-3xl sm:text-4xl">
                Acta: {proceso.numero_acta_codigo}
                {proceso.numero_acta_estado === 'anulado' && (
                  <span className="text-red-700 text-xl font-sans"> (anulado)</span>
                )}
              </h1>
              <p className="text-sm text-numa-700 mt-1">Proceso {proceso.codigo_proceso}</p>
            </>
          ) : (
            <h1 className="section-title whitespace-nowrap">{proceso.codigo_proceso}</h1>
          )}
          <p className="text-numa-800 mt-1">
            {proceso.demandante}
            {proceso.total_solicitantes > 1 && (
              <span className="text-numa-700"> +{proceso.total_solicitantes - 1} más</span>
            )}{' '}
            y {proceso.demandado}
            {proceso.total_invitados > 1 && (
              <span className="text-numa-700"> +{proceso.total_invitados - 1} más</span>
            )}
          </p>
          <p className="text-xs text-numa-700 mt-1">
            {proceso.demandante_cedula || '—'} · {proceso.demandado_cedula || '—'}
          </p>
          {proceso.numero_acta_codigo && proceso.numero_acta_estado === 'reservado' && (() => {
            const t = tiempoRestante(proceso.numero_acta_vence_en, ahoraReloj);
            return (
              <div className="mt-3 inline-flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5">
                <div className="flex items-start gap-2.5">
                  <Clock className="w-5 h-5 text-red-700 shrink-0 mt-0.5" aria-hidden="true" />
                  <p className="text-sm font-semibold sm:whitespace-nowrap text-numa-900">
                    {t
                      ? 'Tiempo para subir toda la documentación y el comprobante de pago'
                      : 'Plazo de 48 horas cumplido: el acta se bloquea en breve'}
                  </p>
                </div>
                {t && <CuentaRegresiva venceEn={proceso.numero_acta_vence_en} />}
                {t && !esAdminSesion() && proceso.numero_acta_id && (
                  <PedirAnulacionBoton numeroId={proceso.numero_acta_id} codigo={proceso.numero_acta_codigo} />
                )}
              </div>
            );
          })()}
        </div>

        <div className="flex items-center gap-3 flex-wrap">
<Pill label={estadoLabelProceso(proceso.estado, proceso.requiere_acta_no_acuerdo)} {...estadoPill(proceso.estado)} />

          {/* El cliente pidió que "Imprimir expediente" esté disponible en
              cualquier etapa del proceso, no solo cuando ya está finalizado
              con acuerdo — el endpoint del expediente ya soporta procesos
              sin acta final subida todavía. */}
          <button
            type="button"
            onClick={() =>
              window.open(
                `/procesos/${proceso.id}/expediente-imprimir`,
                '_blank'
              )
            }
            className="btn-primary btn-sm"
          >
            <Printer className="w-3.5 h-3.5" />
            Imprimir expediente
          </button>
        </div>
      </div>

      {/* Proceso suspendido: va primero para que el administrador vea de una vez
          el aviso y el botón de reactivar, sin bajar por toda la pantalla. */}
      {proceso.etapa_acta === 'suspendido' && (
        <div className="mb-4 px-4 py-3 rounded-sm border-2 border-amber-300 bg-amber-50 flex items-center justify-between gap-3 flex-wrap">
          <p className="text-sm text-amber-900">
            {String(proceso.motivo_suspension || '').startsWith('Baja del acta') ? (
              <>
                <strong>El administrador dio de baja el acta y este proceso.</strong>{' '}
                {`Motivo: ${String(proceso.motivo_suspension).replace(/^Baja del acta:\s*/, '')}. `}
                Ya no continúa ni bloquea al mediador, y su número de acta quedó libre.
              </>
            ) : (
              <>
                <strong>Proceso suspendido por el administrador.</strong>{' '}
                {proceso.motivo_suspension ? `Motivo: ${proceso.motivo_suspension}. ` : ''}
                Ya no bloquea al mediador. Los documentos pendientes se podrán completar cuando el
                administrador lo reactive.
              </>
            )}
          </p>
          {esAdminSesion() && (
            <button
              type="button"
              onClick={async () => {
                setError('');
                try {
                  await reactivarProceso(proceso.id);
                  setSuccessMessage('Proceso reactivado.');
                  await cargarProceso();
                  try {
                    setExpedienteProceso(await getExpedienteProceso(proceso.id));
                  } catch {}
                } catch (e: any) {
                  setError(e?.response?.data?.detail || 'No se pudo reactivar el proceso');
                }
              }}
              className="btn-primary btn-sm shrink-0"
            >
              <PlayCircle className="w-4 h-4" /> Reactivar proceso
            </button>
          )}
        </div>
      )}

      {/* Se muestra justo debajo del encabezado (no al fondo de la página)
          para que el mediador vea de una vez si este proceso tiene su acta
          pendiente, y si es el que debe subir primero (fila FIFO) o si hay
          otro con prioridad. */}
      {procesoPrimeroEnFila ? (
        <div className="mb-4 text-sm px-4 py-3 rounded-sm border font-medium bg-blue-50 border-blue-100 text-blue-700 flex items-center justify-between gap-3 flex-wrap">
          <span>
            Esta acta no se puede subir todavía: primero debes completar el acta{' '}
            <strong>{procesoPrimeroEnFila.numero_acta_codigo || `del proceso ${procesoPrimeroEnFila.codigo_proceso}`}</strong>{' '}
            (documentos, comprobante y acta firmada), porque ya pasaron sus 48 horas.
          </span>

          <button
            type="button"
            onClick={() => router.push(`/procesos/${procesoPrimeroEnFila.id}`)}
            className="btn-secondary btn-sm shrink-0"
          >
            Ir a {procesoPrimeroEnFila.codigo_proceso}
          </button>
        </div>
      ) : null}

      <PasosProceso pasos={pasosProceso} mensaje={siguientePaso} />

      {proceso.estado === 'anulado' && (
        <div className="mb-4 text-sm px-4 py-3 rounded-sm border border-red-200 bg-red-50 text-red-700">
          <strong>Proceso anulado.</strong>{' '}
          {proceso.motivo_anulacion ? `Motivo: ${proceso.motivo_anulacion}` : ''}
        </div>
      )}

      {error && (
        <div className="mb-4">
          <ErrorAlert message={error} />
        </div>
      )}

      {successMessage && (
        <div className="mb-4">
          <SuccessAlert message={successMessage} />
        </div>
      )}

      {avisoNumero && !(conActa(proceso) && !proceso.finalizado && !proceso.suspendido && !proceso.bloqueo_acta_id && !proceso.bloqueo_otro_codigo && !procesoPrimeroEnFila && proceso.numero_acta_codigo) && (
        <div className="mb-4 rounded-xl border-2 border-gold-400 bg-gold-50 px-5 py-4 shadow-[0_14px_30px_-22px_rgba(10,42,98,0.5)]">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <Hash className="w-7 h-7 text-gold-700 shrink-0 mt-0.5" aria-hidden="true" />
              <div>
                <p className="text-base font-bold text-numa-900">Se creó el número de acta de este proceso</p>
                <p className="text-2xl font-mono font-extrabold text-numa-900 my-1">{avisoNumero}</p>
                <p className="text-sm text-numa-800">
                  Escribe este número en el acta. Desde ahora tienes 48 horas para subir toda la documentación
                  y el comprobante de pago; si no, el acta se bloquea.
                </p>
              </div>
            </div>
            <button type="button" onClick={() => setAvisoNumero(null)} className="text-base font-bold text-numa-900 underline shrink-0">
              Entendido
            </button>
          </div>
        </div>
      )}

      {(proceso as any).acta_renumerada_desde && proceso.numero_acta_codigo && proceso.numero_acta_estado === 'reservado' && !proceso.bloqueo_acta_id && (
        <div className="mb-4 rounded-xl border-2 border-gold-400 bg-gold-50 px-5 py-4 shadow-[0_14px_30px_-22px_rgba(10,42,98,0.5)]">
          <div className="flex items-start gap-3">
            <Hash className="w-7 h-7 text-gold-700 shrink-0 mt-0.5" aria-hidden="true" />
            <div>
              <p className="text-base font-bold text-numa-900">Acta desbloqueada: este proceso tiene un número de acta nuevo</p>
              <p className="text-2xl font-mono font-extrabold text-numa-900 my-1">{proceso.numero_acta_codigo}</p>
              <p className="text-sm text-numa-800">
                El número anterior ({(proceso as any).acta_renumerada_desde}) quedó libre para otros mediadores.
                Rehaz el acta con este número nuevo y vuelve a firmarla. Tienes 48 horas desde el desbloqueo
                para subir toda la documentación y el comprobante de pago.
              </p>
            </div>
          </div>
        </div>
      )}

      {esAdminSesion() && !proceso.finalizado && proceso.estado !== 'anulado' && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white px-4 py-3">
          <p className="text-sm text-gray-700">
            A cargo de <strong>{(proceso.usuario ?? proceso.mediador) ?? 'sin asignar'}</strong>
            {proceso.sucursal ? ` · ${proceso.sucursal}` : ''}
          </p>
          {!reasignando ? (
            <button
              type="button"
              onClick={abrirReasignar}
              className="inline-flex items-center gap-2 rounded-md border-2 border-numa-800 bg-numa-800 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-numa-900 hover:border-numa-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-500 focus-visible:ring-offset-2"
            >
              Reasignar mediador
            </button>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={nuevoMediadorId}
                onChange={(e) => setNuevoMediadorId(e.target.value)}
                className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm"
                aria-label="Nuevo mediador"
              >
                <option value="">Elegir quién lo lleva</option>
                {candidatosMediador
                  .filter((m: any) =>
                    m.activo !== false &&
                    m.id !== proceso.usuario_id &&
                    (m.rol === 'administrador' || (m.rol === 'mediador' && String(m.sucursal_id) === String(proceso.sucursal_id)))
                  )
                  .map((m: any) => (
                    <option key={m.id} value={m.id}>
                      {m.nombre} {m.apellido}{m.rol === 'administrador' ? ' (administrador)' : ''}
                    </option>
                  ))}
              </select>
              <button
                type="button"
                disabled={!nuevoMediadorId || guardandoReasignacion}
                onClick={confirmarReasignar}
                className="rounded-lg bg-gray-900 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
              >
                {guardandoReasignacion ? 'Pasando…' : 'Pasar el proceso'}
              </button>
              <button
                type="button"
                onClick={() => setReasignando(false)}
                className="px-2 py-1.5 text-sm text-gray-600 hover:underline"
              >
                Cancelar
              </button>
            </div>
          )}
          {reasignando && (
            <p className="basis-full text-xs text-gray-600">
              El proceso, su número de acta y sus invitaciones pendientes pasan al nuevo responsable, y le corren 48 horas nuevas.
            </p>
          )}
          {historialAsignacion.length > 0 && (
            <ul className="basis-full space-y-0.5 border-t border-gray-100 pt-2 text-xs text-gray-600">
              {historialAsignacion.map((h: any) => (
                <li key={h.id}>
                  <span className="font-semibold text-gray-800">
                    {new Date(h.fecha_creacion).toLocaleString('es-EC', { timeZone: 'America/Guayaquil', dateStyle: 'short', timeStyle: 'short' })}
                  </span>
                  {' · '}{h.detalle}
                  {h.usuario_nombre ? ` (por ${h.usuario_nombre})` : ''}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <ConfirmDialog
        open={confirmDesbloqueo}
        onClose={() => setConfirmDesbloqueo(false)}
        onConfirm={desbloquearDesdeProceso}
        loading={desbloqueandoActa}
        confirmLabel="Sí, desbloquear"
        variante="primario"
        message={`¿Desbloquear el acta ${proceso.bloqueo_acta_codigo ?? ''} de ${(proceso.usuario ?? proceso.mediador) ?? 'el mediador'}? Ese número quedó libre para otros mediadores: recibirá el número libre más bajo de la sucursal (puede ser el mismo si nadie lo tomó). Si el número cambia, deberá rehacer y volver a firmar el acta. Tendrá 48 horas nuevas.`}
      />

      {proceso.bloqueo_acta_id && (
        <div className="mb-4 rounded-xl border-2 border-red-400 bg-red-50 px-5 py-4">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <Lock className="w-7 h-7 text-red-700 shrink-0 mt-0.5" aria-hidden="true" />
              <div>
                <p className="text-base font-bold text-red-900">
                  Acta bloqueada · {proceso.bloqueo_acta_codigo}
                </p>
                <p className="text-sm text-red-900">
                  Pasaron 48 horas desde que se dio el número sin completar la documentación.
                  {esAdminSesion()
                    ? ' Su número quedó libre para otros mediadores. Al desbloquearla, el mediador recibe el número libre más bajo de la sucursal (puede ser el mismo si nadie lo tomó) y, si cambia, debe rehacer y volver a firmar el acta.'
                    : ' Mientras esté bloqueada no puedes pedir números de acta ni subir otras actas. Pide al administrador que la desbloquee.'}
                </p>
              </div>
            </div>
            {esAdminSesion() && (
              <button
                type="button"
                onClick={() => setConfirmDesbloqueo(true)}
                disabled={desbloqueandoActa}
                className="btn-primary shrink-0 disabled:opacity-50"
              >
                {desbloqueandoActa ? 'Desbloqueando…' : 'Desbloquear acta'}
              </button>
            )}
          </div>
        </div>
      )}

      <PartesProceso
        resumen={
          <div className="flex flex-wrap gap-x-8 gap-y-2 text-sm pb-3 mb-3 border-b border-numa-200">
            {esAdminSesion() && (
              <div>
                <p className="text-numa-700 text-xs mb-0.5">Ciudad · Sucursal · Mediador</p>
                <p className="text-numa-900 font-medium">
                  {proceso.ciudad || '—'} · {proceso.sucursal || '—'} · {proceso.usuario || '—'}
                </p>
              </div>
            )}
            <div className="min-w-0 max-w-xl">
              <p className="text-numa-700 text-xs mb-0.5">Tema</p>
              <p className="text-numa-900 font-medium">{mayusInicial(proceso.tema)}</p>
            </div>
            <div>
              <p className="text-numa-700 text-xs mb-0.5">Fecha de apertura</p>
              <p className="text-numa-900 font-medium">
                {proceso.fecha_creacion
                  ? new Date(proceso.fecha_creacion).toLocaleDateString('es-EC')
                  : '—'}
              </p>
            </div>
          </div>
        }
        procesoId={proceso.id}
        editable={proceso.estado === 'en_negociacion'}
        onCambio={cargarProceso}
      />

      {esAdminSesion() && (proceso.estado === 'en_negociacion' || proceso.etapa_acta === 'falta_acta' || proceso.etapa_acta === 'falta_firmada') && (
        <div className="mb-4">
          {!anulando ? (
            <button
              type="button"
              onClick={() => setAnulando(true)}
              className="link-danger"
            >
              Anular este proceso
            </button>
          ) : (
            <div className="text-sm px-4 py-3 rounded-sm border border-red-200 bg-red-50 text-red-800 space-y-2">
              <p>
                Anular deja el proceso como <strong>Anulado</strong>: no se borra y conserva su
                historial. Si tenía número de acta, queda libre 30 días; se liberan al mediador de
                este proceso y se cancelan sus invitaciones pendientes. Esto no se puede deshacer.
              </p>
              <textarea
                value={motivoAnulacion}
                onChange={(e) => setMotivoAnulacion(e.target.value)}
                rows={2}
                placeholder="Motivo de la anulación (obligatorio)"
                className="w-full rounded-sm border border-red-200 bg-white px-3 py-2 text-sm text-numa-800"
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={guardandoAnulacion}
                  onClick={handleAnularProceso}
                  className="btn-danger btn-sm"
                >
                  {guardandoAnulacion ? 'Anulando...' : 'Sí, anular proceso'}
                </button>
                <button
                  type="button"
                  disabled={guardandoAnulacion}
                  onClick={() => {
                    setAnulando(false);
                    setMotivoAnulacion('');
                  }}
                  className="btn-secondary btn-sm"
                >
                  Cancelar
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="space-y-8">
        <div>
          <h3 className="text-base font-bold text-numa-900 mb-3">
            Línea de tiempo del proceso
          </h3>

          {loadingCitas || loadingAvances || loadingExpediente ? (
            <Spinner />
          ) : citasProceso.length === 0 ? (
            <EmptyState message="No hay invitaciones registradas." />
          ) : (
            <div className="space-y-4">
              {citasProceso.map((cita, index) => {
                const avance =
                  cita.resultado || cita.avance_observacion
                    ? cita
                    : avancesProceso.find(
                        (a) => Number(a.cita_id) === Number(cita.id)
                      );

                return (
                  <div
                    key={cita.id}
                    className={`card p-5`}
                  >
                    <div className="flex justify-between gap-3">
                      <div>
                        <p className="font-semibold text-numa-800">
                          Invitación #{index + 1}
                        </p>

                        <p className="text-sm text-numa-800 mt-1">
                          {cita.fecha ? cita.fecha.slice(0, 10).split('-').reverse().join('/') : '—'} · {cita.hora?.slice(0, 5)}
                        </p>

                        {/* Quién creó esta invitación — no siempre es el
                            mediador asignado al proceso: un admin puede
                            crearla en su nombre (ej. el mediador se
                            enfermó), y esto deja ese dato visible. */}
                        {(cita.creado_por || cita.fecha_creacion) && (
                          <p className="text-xs text-numa-700 mt-1">
                            Invitación creada
                            {cita.fecha_creacion && (
                              <>
                                {' '}el{' '}
                                {new Date(
                                  /(Z|[+-]\d\d:?\d\d)$/.test(String(cita.fecha_creacion))
                                    ? String(cita.fecha_creacion)
                                    : `${String(cita.fecha_creacion).replace(' ', 'T')}Z`
                                ).toLocaleString('es-EC', {
                                  timeZone: 'America/Guayaquil',
                                  day: '2-digit',
                                  month: '2-digit',
                                  year: 'numeric',
                                  hour: '2-digit',
                                  minute: '2-digit'
                                })}
                              </>
                            )}
                            {cita.creado_por && <> por: {cita.creado_por}</>}
                          </p>
                        )}

                        {cita.estado !== 'cancelada' && (
                          <button
                            type="button"
                            onClick={() =>
                              window.open(
                                `/procesos/${proceso.id}/invitacion-imprimir?cita=${cita.id}`,
                                '_blank'
                              )
                            }
                            className="btn-primary btn-sm mt-2"
                          >
                            <Printer className="w-3.5 h-3.5" />
                            Imprimir invitación
                          </button>
                        )}
                      </div>

                      <span
                        className={`inline-flex items-center self-start px-2.5 py-1 rounded-full text-xs font-semibold capitalize shrink-0 ${
                          citaEstaAtrasada(cita)
                            ? 'bg-red-50 text-red-700'
                            : getEstadoCitaBadgeClass(cita.estado)
                        }`}
                      >
                        {citaEstaAtrasada(cita)
                          ? 'Atrasada'
                          : cita.estado === 'no_realizada'
                            ? 'No asistió'
                            : cita.estado}
                      </span>
                    </div>

                    {cita.observaciones && (
                      <div className="mt-3 border-t border-numa-200 pt-3">
                        <p className="text-[11px] font-bold uppercase tracking-wide text-numa-700">
                          Observación de invitación
                        </p>

                        <p className="text-sm text-numa-900 whitespace-pre-wrap">
                          {cita.observaciones}
                        </p>
                      </div>
                    )}

                    {cita.estado === 'cancelada' && cita.motivo_cancelacion && (
                      <div className="mt-3 bg-red-50 border border-red-100 rounded-sm p-3">
                        <p className="text-xs font-semibold text-red-700">
                          Motivo de cancelación:
                        </p>

                        <p className="text-sm text-red-700 whitespace-pre-wrap">
                          {cita.motivo_cancelacion}
                        </p>
                      </div>
                    )}

                    {avance?.resultado ? (
                      <div className="mt-3 rounded-lg bg-gold-50 px-3.5 py-3">
                        {/* Si es el cierre del proceso, el resultado ya está en el encabezado
                            ("Cerrado con acuerdo"): aquí no se repite. */}
                        {!(proceso.finalizado && String(avance.resultado).startsWith('cerrado')) && (
                          <>
                            <p className="text-[11px] font-bold uppercase tracking-wide text-numa-700">
                              Resultado
                            </p>

                            <p className="text-base font-bold text-numa-900">
                              {estadoLabelProceso(avance.resultado, proceso.requiere_acta_no_acuerdo)}
                            </p>
                          </>
                        )}

                        <p
                          className={`text-[11px] font-bold uppercase tracking-wide text-numa-700 ${
                            proceso.finalizado && String(avance.resultado).startsWith('cerrado') ? '' : 'mt-3'
                          }`}
                        >
                          {proceso.finalizado && String(avance.resultado).startsWith('cerrado')
                            ? 'Observación del cierre'
                            : 'Registro / observación'}
                        </p>

                        <p className="text-sm text-numa-900 whitespace-pre-wrap">
                          {avance.avance_observacion || avance.observacion}
                        </p>

                        {avance.usuario_avance && (
                          <p className="text-xs text-numa-700 mt-2">
                            Registrado por: {avance.usuario_avance}
                          </p>
                        )}

                        {avance.proxima_fecha && (
                          <div className="mt-3 text-xs text-gold-700 bg-gold-50 border border-gold-100 px-3 py-2 rounded-sm">
                            Nueva invitación programada: {avance.proxima_fecha}{' '}
                            {avance.proxima_hora || ''}
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="mt-4 border-t border-numa-200 pt-3">
                        {citaEstaAtrasada(cita) ? (
                          <p className="text-sm font-medium text-red-700">
                            Esta invitación ya pasó y no tiene resultado. Registra cómo terminó la reunión.
                          </p>
                        ) : cita.estado === 'cancelada' ? (
                          <p className="text-sm text-numa-700">
                            Invitación cancelada: no necesita resultado.
                          </p>
                        ) : (
                          <p className="text-sm text-numa-700">
                            Pendiente de registrar resultado.
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {proceso.finalizado && proceso.etapa_acta !== 'falta_firmada' && proceso.etapa_acta !== 'completa' && (
          <div className="flex items-start gap-3 px-4 py-3 bg-white border border-numa-200 rounded-sm text-sm">
            <CheckCircle2 className="w-5 h-5 text-green-600 shrink-0 mt-0.5" aria-hidden="true" />
            <p className="text-numa-800">
              <span className="font-semibold text-numa-900">Proceso finalizado.</span>{' '}
              Solo se puede consultar el historial.
            </p>
          </div>
        )}

        {!proceso.finalizado &&
          proceso.estado === 'en_negociacion' &&
          !loadingCitas &&
          !citaPendiente && (
          <div className="card p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-base font-bold text-numa-900">
                {citasProceso.length === 0
                  ? 'Primera invitación'
                  : 'Programar siguiente invitación'}
              </h3>

              {mostrarCalendarioInvitacion && (
                <button
                  type="button"
                  onClick={() => setMostrarCalendarioInvitacion(false)}
                  className="btn-ghost btn-sm"
                >
                  <CalendarIcon className="w-3.5 h-3.5" />
                  Ocultar calendario
                </button>
              )}
            </div>

            <div className="mb-4 rounded-sm border border-dashed border-numa-200 bg-numa-50/50 p-3">
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() =>
                    window.open(`/procesos/${proceso.id}/invitacion-imprimir?nueva=1`, '_blank')
                  }
                  className="btn-secondary btn-sm"
                >
                  <FileText className="w-3.5 h-3.5" />
                  Redactar sobre el documento
                </button>
              </div>
            </div>

            {mostrarCalendarioInvitacion && (
              <div className="mb-4 border border-numa-200 rounded-sm p-4">
                <CalendarioAgendaMediador
                  usuarioId={proceso.usuario_id}
                  permitirCrear
                  permitirGestionarEstado={false}
                  permitirCancelar
                  onConfirmar={(fecha, hora) => {
                    setInvitacionForm({ ...invitacionForm, fecha, hora });
                    setMostrarCalendarioInvitacion(false);
                    bajarAObservaciones();
                  }}
                  onCitaActualizada={async () => {
                    // Si se cancela la invitación pendiente desde este
                    // mismo calendario, hay que refrescar la línea de
                    // tiempo del proceso: si no, la pantalla se queda
                    // pensando que sigue habiendo una pendiente y no
                    // vuelve a mostrar el formulario de nueva invitación.
                    const data = await getCitasProceso(proceso.id);
                    setCitasProceso(data);

                    if (proceso.usuario_id) {
                      await cargarCitasMediador(proceso.usuario_id);
                    }
                  }}
                />
              </div>
            )}

            <div className="flex flex-wrap items-end gap-4">
              <InputField
                label="Fecha"
                type="date"
                value={invitacionForm.fecha}
                onChange={(e) =>
                  setInvitacionForm({ ...invitacionForm, fecha: e.target.value })
                }
              />

              <InputField
                label="Hora"
                type="time"
                value={invitacionForm.hora}
                onChange={(e) =>
                  setInvitacionForm({ ...invitacionForm, hora: e.target.value })
                }
                error={
                  horaInvitacionOcupada
                    ? `Choca con la invitación de las ${horaChocanteInvitacion?.hora?.slice(0, 5)}: cada invitación dura 1 hora, debe haber al menos 1 hora entre una y otra`
                    : undefined
                }
              />

              {!mostrarCalendarioInvitacion && (
                <button
                  type="button"
                  onClick={() => setMostrarCalendarioInvitacion(true)}
                  className="btn-ghost btn-sm"
                >
                  <CalendarIcon className="w-3.5 h-3.5" />
                  Mostrar calendario
                </button>
              )}
            </div>

            <div ref={observacionesRef} className="mt-4">
              <TextareaField
                label="Observaciones (opcional)"
                rows={3}
                value={invitacionForm.observaciones}
                onChange={(e) =>
                  setInvitacionForm({
                    ...invitacionForm,
                    observaciones: e.target.value
                  })
                }
                placeholder="Solo si quieres dejar una nota sobre esta invitación"
              />
            </div>

            <div className="mt-4">
              {error && (
                <div className="mb-3">
                  <ErrorAlert message={error} />
                </div>
              )}

              <button
                type="button"
                onClick={handleCrearInvitacion}
                disabled={
                  guardandoInvitacion ||
                  horaInvitacionOcupada
                }
                className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {guardandoInvitacion ? 'Guardando...' : 'Crear invitación'}
              </button>
            </div>
          </div>
        )}

        {!proceso.finalizado &&
          proceso.estado === 'en_negociacion' &&
          citaPendiente &&
          !reunionYaLlego && (
            <div className="card p-4">
              <h3 className="text-base font-bold text-numa-900 mb-1">
                Registrar resultado de la invitación pendiente
              </h3>
              <p className="text-xs text-numa-800">
                Se habilita cuando llegue la hora de la reunión (
                {fechaLargaEC(String(citaPendiente.fecha || '').slice(0, 10))} a las{' '}
                {String(citaPendiente.hora || '').slice(0, 5)}).
              </p>
            </div>
          )}

        {!proceso.finalizado &&
          proceso.estado === 'en_negociacion' &&
          citaPendiente &&
          reunionYaLlego && (
            <div className="card p-4">
              <h3 className="text-base font-bold text-numa-900 mb-3">
                Registrar resultado de la invitación pendiente
              </h3>

              {cierreConActaBloqueado && (
                <div className="mb-3 p-3 border border-red-300 bg-red-50 rounded-sm text-sm text-red-800">
                  {bloqueoNumero} Mientras tanto no puedes cerrar este proceso con acuerdo ni con
                  no acuerdo; las otras opciones siguen disponibles.
                </div>
              )}

              <SelectField
                label="Resultado"
                value={avanceForm.resultado}
                onChange={(e) => {
                  setAvanceForm({ ...avanceForm, resultado: e.target.value });
                  setConfirmandoCierre(false);
                }}
              >
                <option value="en_negociacion">En negociación</option>
                <option value="no_realizada">No asistió / no se realizó</option>
                <option value="cerrado_con_acuerdo" disabled={cierreConActaBloqueado}>
                  Cerrado con acuerdo{cierreConActaBloqueado ? ' (bloqueado: completa tus actas pendientes)' : ''}
                </option>
                <option value="cerrado_no_acuerdo" disabled={cierreConActaBloqueado}>
                  Cerrado con no acuerdo (se emite acta de no acuerdo)
                  {cierreConActaBloqueado ? ' (bloqueado: completa tus actas pendientes)' : ''}
                </option>
                {!(proceso?.numero_acta_codigo && ['reservado', 'usado'].includes(proceso?.numero_acta_estado)) && (
                  <>
                    <option value="cerrado_sin_acuerdo">Cerrado sin acuerdo (no se emite acta)</option>
                    <option value="archivado">Archivado</option>
                  </>
                )}
              </SelectField>

              <div className="mt-4">
                <TextareaField
                  label={
                    avanceForm.resultado === 'cerrado_con_acuerdo'
                      ? 'Detalle del acuerdo'
                      : avanceForm.resultado === 'cerrado_no_acuerdo'
                        ? 'Detalle del no acuerdo'
                        : avanceForm.resultado === 'no_realizada'
                        ? 'Constancia: quién no asistió y el motivo'
                        : 'Observación / registro de reunión'
                  }
                  rows={4}
                  value={avanceForm.observacion}
                  onChange={(e) =>
                    {
                      setAvanceForm({ ...avanceForm, observacion: e.target.value });
                      try {
                        window.localStorage.setItem(claveBorrador, e.target.value);
                      } catch {}
                    }
                  }
                  placeholder="Detalle de lo ocurrido en la reunión..."
                />
              </div>

              <div className="mt-4">
                {error && (
                  <div className="mb-3">
                    <ErrorAlert message={error} />
                  </div>
                )}

                {avanceForm.resultado === 'cerrado_no_acuerdo' && !confirmandoCierre && (
                  <div className="mb-3 p-3 border border-gold-200 bg-gold-50 rounded-sm text-xs text-gold-800">
                    Úsalo cuando las partes asistieron y no llegaron a un acuerdo. Se emite el
                    acta de no acuerdo: tendrás 48 horas para subir la documentación y el
                    comprobante de pago.
                  </div>
                )}

                {confirmandoCierre && (
                  <div className="mb-3 p-3 border border-amber-300 bg-amber-50 rounded-sm text-sm text-amber-900">
                    {avanceForm.resultado === 'cerrado_con_acuerdo' ? (
                      <>
                        <p className="font-semibold mb-1">¿Está seguro de este acuerdo?</p>
                        <p className="whitespace-pre-line mb-2">{avanceForm.observacion}</p>
                        <p>
                          Una vez confirmado, el acuerdo y el resultado del proceso ya
                          no se podrán modificar.
                        </p>
                        <p className="mt-3 px-3 py-2 rounded-sm border-2 border-amber-500 bg-white font-semibold">
                          {proceso.numero_acta_codigo
                            ? `Este proceso ya tiene el número de acta ${proceso.numero_acta_codigo}.`
                            : 'Al confirmar se le asignará un número de acta nuevo a este proceso, y desde ese momento cuentan las 48 horas para completar la documentación.'}
                        </p>
                      </>
                    ) : (
                      <>
                        {avanceForm.resultado === 'cerrado_no_acuerdo' ? (
                          <>
                            Vas a cerrar este proceso con <strong>no acuerdo</strong> y a pedir su
                            acta de no acuerdo, y tendrás 48 horas para completarla. Después de
                            esto ya no podrás cambiar el resultado. ¿Confirmas?
                            <span className="block mt-3 px-3 py-2 rounded-sm border-2 border-amber-500 bg-white font-semibold">
                              {proceso.numero_acta_codigo
                                ? `Este proceso ya tiene el número de acta ${proceso.numero_acta_codigo}.`
                                : 'Al confirmar se le asignará un número de acta nuevo a este proceso, y desde ese momento cuentan las 48 horas para completar la documentación.'}
                            </span>
                          </>
                        ) : (
                          <>
                            Vas a marcar este proceso como{' '}
                            <strong>{estadoLabel(avanceForm.resultado)}</strong>.
                            Después de esto ya no podrás cambiar el resultado. ¿Confirmas?
                          </>
                        )}
                      </>
                    )}
                  </div>
                )}

                {confirmandoCierre ? (
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleCrearAvance(true)}
                      disabled={guardandoAvance}
                      className="btn-primary"
                    >
                      {guardandoAvance ? 'Guardando...' : 'Confirmar'}
                    </button>
                    <button
                      onClick={() => setConfirmandoCierre(false)}
                      disabled={guardandoAvance}
                      className="btn-ghost"
                    >
                      {avanceForm.resultado === 'cerrado_con_acuerdo' ? 'Volver a editar' : 'Cancelar'}
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => handleCrearAvance()}
                    disabled={guardandoAvance}
                    className="btn-primary"
                  >
                    {guardandoAvance ? 'Guardando...' : 'Registrar resultado'}
                  </button>
                )}
              </div>
            </div>
          )}

        {proceso.estado !== 'anulado' && (
          <div id="bloque-facturacion">
            <FacturacionProceso
              procesoId={proceso.id}
              editable={esAdminSesion() || proceso.etapa_acta !== 'completa'}
              onEstado={setTieneFacturacion}
              finalizado={!!proceso.finalizado}
              estado={conActa(proceso) ? 'cerrado_con_acuerdo' : proceso.estado}
              sinFactura={!!proceso.sin_factura}
              onSinFactura={cargarProceso}
            />
          </div>
        )}

        {conActa(proceso) && !proceso.finalizado && !proceso.suspendido && !proceso.bloqueo_acta_id && !!proceso.bloqueo_otro_codigo && (
          <div className="card p-4">
            <p className="text-sm text-numa-900 font-medium">
              Esta acta no se puede subir ahora: tienes el acta{' '}
              <b className="font-mono">{proceso.bloqueo_otro_codigo}</b> bloqueada. El administrador
              debe resolverla primero.
            </p>
          </div>
        )}

        {conActa(proceso) && !proceso.finalizado && !proceso.suspendido && !proceso.bloqueo_acta_id && !proceso.bloqueo_otro_codigo && (
          <div className="card p-4">
            {!procesoPrimeroEnFila && proceso.numero_acta_codigo && (
              <div className="mb-4 rounded-xl border-2 border-gold-400 bg-gold-50 px-5 py-4 shadow-[0_14px_30px_-22px_rgba(10,42,98,0.5)]">
                <div className="flex items-start gap-3">
                  <Hash className="w-8 h-8 text-gold-700 shrink-0 mt-1" aria-hidden="true" />
                  <div>
                    <p className="text-sm font-bold uppercase tracking-wide text-numa-800">
                      Número de acta de este proceso
                      <span className="ml-2 normal-case tracking-normal rounded-full bg-numa-900 text-white px-2.5 py-0.5 text-xs">
                        {esNoAcuerdo(proceso) ? 'Acta de no acuerdo' : 'Acta de acuerdo'}
                      </span>
                    </p>
                    <p className="text-3xl sm:text-4xl font-mono font-extrabold text-numa-900 my-1">{proceso.numero_acta_codigo}</p>
                    <p className="text-base font-semibold text-numa-900">
                      Escribe este número en el acta.
                    </p>
                    <p className="text-sm text-numa-800">
                      Desde que se te dio tienes 48 horas para subir toda la documentación y el comprobante de pago;
                      si no, el acta se bloquea.
                    </p>
                  </div>
                </div>
              </div>
            )}
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <p className="text-sm text-numa-700">
                {procesoPrimeroEnFila
                  ? `Esta acta no se puede subir todavía: primero completa el acta ${procesoPrimeroEnFila.numero_acta_codigo || `del proceso ${procesoPrimeroEnFila.codigo_proceso}`}, que ya pasó las 48 horas.`
                  : esNoAcuerdo(proceso)
                  ? (proceso.numero_acta_codigo
                      ? 'Se pidió el acta de no acuerdo.'
                      : 'Se pidió el acta de no acuerdo. Sube la documentación y el comprobante de pago para cerrarla.')
                  : (proceso.numero_acta_codigo
                      ? 'El proceso llegó a un acuerdo.'
                      : 'El proceso llegó a un acuerdo. Sube la documentación y el comprobante de pago para cerrarlo.')}
                {!proceso.numero_acta_codigo && !procesoPrimeroEnFila && ' Primero pide el número de acta.'}
              </p>

              {procesoPrimeroEnFila ? (
                <button
                  type="button"
                  onClick={() => router.push(`/procesos/${procesoPrimeroEnFila.id}`)}
                  className="btn-secondary shrink-0"
                >
                  Ir a {procesoPrimeroEnFila.codigo_proceso}
                </button>
              ) : !proceso.numero_acta_codigo ? (
                <button
                  type="button"
                  onClick={pedirNumeroProceso}
                  disabled={pidiendoNumero}
                  className="btn-primary shrink-0 disabled:opacity-50"
                >
                  {pidiendoNumero ? 'Pidiendo...' : 'Pedir número de acta'}
                </button>
              ) : tieneFacturacion === false && !proceso.sin_factura ? (
                <button
                  type="button"
                  onClick={() =>
                    document
                      .getElementById('bloque-facturacion')
                      ?.scrollIntoView({ behavior: 'smooth', block: 'center' })
                  }
                  className="btn-secondary shrink-0"
                >
                  Primero completa los datos de facturación
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setShowActaFinal(true);
                    setNumeroActaId('');
                    getMiNumeroActa()
                      .then((r: any) => {
                        // Solo los números de la sucursal de este proceso.
                        const deSucursal = (r?.reservados || []).filter(
                          (n: any) => n.sucursal_id === proceso.sucursal_id
                        );
                        // Si el proceso nació de una invitación con número de acta,
                        // ese es el número: no se elige otro. Si no, solo los
                        // números que no están ligados a otra invitación.
                        const ligado = deSucursal.find((n: any) => n.proceso_id === proceso.id);
                        const lista = ligado
                          ? [ligado]
                          : deSucursal.filter((n: any) => !n.cita_id && !n.proceso_id);
                        setNumerosPedidos(lista);
                        if ((ligado || lista.length === 1) && !esAdminSesion()) setNumeroActaId(String(lista[0].id));
                        if (ligado) setNumeroActaId(String(ligado.id));
                      })
                      .catch(() => setNumerosPedidos([]));
                    setArchivoActaFinal(null);
                    setConfirmoActaFinal(false);
                    setPagoModo('completo');
                    setMontoTotal('');
                    setMontoAbono('');
                    setFechaPago(hoyEcuador());
                    setError('');
                  }}
                  className="btn-primary shrink-0"
                >
                  <Upload className="w-4 h-4" />
                  Subir documentación y comprobante de pago
                </button>
              )}
            </div>
            {errorNumero && <p className="text-sm text-red-700 mt-2">{errorNumero}</p>}
          </div>
        )}

        <ActaFlujoProceso
          proceso={proceso}
          esAdmin={esAdminSesion()}
          onCambio={async () => {
            await cargarProceso();
            try {
              setExpedienteProceso(await getExpedienteProceso(proceso.id));
            } catch {}
          }}
        />

        {expedienteProceso?.acta_final && (
          <div className="card p-4">
            <h3 className="flex items-center gap-2 text-base font-bold text-numa-900 mb-3">
              <FileText className="w-5 h-5 text-numa-700" aria-hidden="true" />
              Documentos del acta y comprobante de pago
            </h3>

            {/* Código acta se queda fijo a la izquierda (como estaba antes),
                y los botones quedan centrados en el espacio restante de la
                fila, sin pegarse al borde derecho de la tarjeta. */}
            <div className="flex items-center gap-3 flex-wrap">
              <p className="text-sm text-numa-700 shrink-0">
                Código acta:{' '}
                <span className="font-semibold text-numa-900 code-text">
                  {expedienteProceso.acta_final.codigo_acta}
                </span>
              </p>

            </div>

            {/* Admin y mediador ven el acta y el comprobante; solo el
                administrador puede descargarlos. */}
            {(
              <div className="mt-3 divide-y divide-numa-200 border-y border-numa-200">
                <DocFila
                  etiqueta="Documentos del acta"
                  textoVer="Ver documentos"
                  onVer={() => handleVerPdfActaFinal(expedienteProceso.acta_final.id)}
                  onDescargar={
                    esAdminSesion()
                      ? () =>
                          handleDescargarPdfActaFinal(
                            expedienteProceso.acta_final.id,
                            expedienteProceso.acta_final.codigo_acta
                          )
                      : undefined
                  }
                />
                {expedienteProceso.acta_final.nombre_comprobante_pago && (
                  <DocFila
                    etiqueta="Comprobante de pago"
                    textoVer="Ver comprobante"
                    onVer={() => handleVerComprobanteActaFinal(expedienteProceso.acta_final.id)}
                    onDescargar={
                      esAdminSesion()
                        ? () =>
                            handleDescargarComprobanteActaFinal(
                              expedienteProceso.acta_final.id,
                              expedienteProceso.acta_final.codigo_acta,
                              expedienteProceso.acta_final.nombre_comprobante_pago
                            )
                        : undefined
                    }
                  />
                )}
              </div>
            )}

            <div className="mt-3 pt-3 border-t border-numa-200 text-xs text-numa-800 space-y-0.5">
            <p>
              Subido por{' '}
              <span className="text-numa-800">{expedienteProceso.acta_final.subido_por || '—'}</span>
            </p>

            <p>
              Fecha oficial{' '}
              <span className="text-numa-800">
              {expedienteProceso.acta_final.fecha_subida
                ? new Date(
                    expedienteProceso.acta_final.fecha_subida
                  ).toLocaleString('es-EC', {
                    day: '2-digit', month: '2-digit', year: 'numeric',
                    hour: 'numeric', minute: '2-digit'
                  })
                : '—'}
              </span>
            </p>
            </div>
          </div>
        )}

        <FacturasProceso
          proceso={proceso}
          esAdmin={esAdminSesion()}
          onCambio={cargarProceso}
        />
      </div>

      <Modal
        open={showActaFinal}
        onClose={() => {
          setShowActaFinal(false);
          setArchivoActaFinal(null);
          setArchivoComprobantePago(null);
          setError('');
        }}
        title={`${esNoAcuerdo(proceso) ? 'Subir documentos del acta de no acuerdo' : 'Subir documentos del acta'} — ${proceso.numero_acta_codigo || proceso.codigo_proceso}`}
        size="md"
      >
        {error && (
          <div className="mb-4">
            <ErrorAlert message={error} />
          </div>
        )}

        <div className="space-y-4">
          <p className="text-sm text-numa-700">
            Sube en un solo PDF la documentación del acta, incluida el acta ya firmada, y por
            separado el comprobante de pago. Tienes 48 horas desde que se te dio el número
            de acta; pasado ese plazo el acta se bloquea y no podrás pedir números ni subir
            otras actas hasta que se desbloquee.
          </p>

          {numerosPedidos.length > 0 && (
            <div>
              <label className="block text-sm font-medium text-numa-800 mb-1">
                Número de acta de esta acta
              </label>
              <select
                className="input-field"
                value={numeroActaId}
                disabled={numerosPedidos.length === 1 && numerosPedidos[0].proceso_id === proceso.id}
                onChange={(e) => setNumeroActaId(e.target.value)}
              >
                {(numerosPedidos.length > 1 || esAdminSesion()) && (
                  <option value="">{esAdminSesion() ? 'Asignar el siguiente automáticamente' : 'Elige el número…'}</option>
                )}
                {numerosPedidos.map((n: any) => (
                  <option key={n.id} value={n.id}>
                    {n.codigo}
                  </option>
                ))}
              </select>
              <p className="text-xs text-numa-800 mt-1">
                {numerosPedidos.length === 1 && numerosPedidos[0].proceso_id === proceso.id
                  ? 'Este número se pidió desde la invitación que dio origen al proceso.'
                  : 'Debe ser el mismo número que escribiste en el acta.'}
              </p>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-numa-800 mb-1">
              {esNoAcuerdo(proceso)
                ? 'Documentos del acta de no acuerdo con el acta firmada (un solo PDF)'
                : 'Documentos del acta con el acta firmada (un solo PDF)'}
            </label>
            <input
              type="file"
              accept="application/pdf"
              onChange={(e) => {
                const file = e.target.files?.[0] || null;
                setArchivoActaFinal(file);
              }}
              className="input-field"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-numa-800 mb-1">
              Comprobante de pago (PDF, JPG o PNG)
            </label>
            <input
              type="file"
              accept="application/pdf,image/jpeg,image/png"
              onChange={(e) => {
                const file = e.target.files?.[0] || null;
                setArchivoComprobantePago(file);
              }}
              className="input-field"
            />
          </div>

          <div>
            <p className="block text-sm font-medium text-numa-800 mb-2">¿Cómo se pagó?</p>
            <div className="flex flex-col sm:flex-row gap-2">
              <label className="flex items-center gap-2 text-sm text-numa-800 border border-numa-200 rounded-sm px-3 py-2 cursor-pointer">
                <input
                  type="radio"
                  name="pago-modo"
                  checked={pagoModo === 'completo'}
                  onChange={() => setPagoModo('completo')}
                />
                Pago completo (un comprobante)
              </label>
              <label className="flex items-center gap-2 text-sm text-numa-800 border border-numa-200 rounded-sm px-3 py-2 cursor-pointer">
                <input
                  type="radio"
                  name="pago-modo"
                  checked={pagoModo === 'abonos'}
                  onChange={() => setPagoModo('abonos')}
                />
                En abonos (primer abono ahora)
              </label>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-numa-800 mb-1">
              Fecha del pago
            </label>
            <input
              type="date"
              value={fechaPago}
              onChange={(e) => setFechaPago(e.target.value)}
              className="input-field"
            />
          </div>

          {pagoModo === 'abonos' && (
            <div className="space-y-3 border border-gold-200 bg-gold-50 rounded-sm p-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-numa-800 mb-1">
                    Valor total ($)
                  </label>
                  <input
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="0.01"
                    value={montoTotal}
                    onChange={(e) => setMontoTotal(e.target.value)}
                    className="input-field"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-numa-800 mb-1">
                    Primer abono ($)
                  </label>
                  <input
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="0.01"
                    value={montoAbono}
                    onChange={(e) => setMontoAbono(e.target.value)}
                    className="input-field"
                  />
                </div>
              </div>
              {Number(montoTotal) > 0 && Number(montoAbono) > 0 && Number(montoAbono) < Number(montoTotal) && (
                <p className="text-sm text-gold-800">
                  Saldo pendiente: <strong>{dinero(Number(montoTotal) - Number(montoAbono))}</strong>. El
                  proceso quedará con pago incompleto y no podrás subir otras actas hasta que subas
                  el comprobante del saldo.
                </p>
              )}
            </div>
          )}

          <label className="flex items-start gap-2 text-sm text-numa-800 border border-gold-200 bg-gold-50 rounded-sm p-3">
            <input
              type="checkbox"
              checked={confirmoActaFinal}
              onChange={(e) => setConfirmoActaFinal(e.target.checked)}
              className="mt-1"
            />
            <span>
              Confirmo que estos documentos son reales y legales, avalados por el mediador. Entiendo que
              solo se pueden subir una sola vez y no podré cambiarlos después.
            </span>
          </label>

          <div className="flex justify-end gap-3 pt-4">
            <button
              type="button"
              onClick={() => {
                setShowActaFinal(false);
                setArchivoActaFinal(null);
                setArchivoComprobantePago(null);
                setFormaPago('deposito');
                setConfirmoActaFinal(false);
              }}
              className="btn-secondary"
            >
              Cancelar
            </button>

            <button
              type="button"
              onClick={handleSubirActaFinal}
              disabled={subiendoActaFinal || !archivoActaFinal || (formaPago === 'deposito' && !archivoComprobantePago) || !confirmoActaFinal}
              className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {subiendoActaFinal ? 'Subiendo...' : formaPago === 'efectivo' ? 'Subir documentación (pago en efectivo)' : 'Subir documentación y comprobante de pago'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
