'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import PasosProceso from '@/components/procesos/PasosProceso';
import { ArrowLeft, Printer, Upload, Calendar as CalendarIcon, Eye, Download, Receipt, FileText } from 'lucide-react';
import { isAdmin as esAdminSesion } from '@/lib/auth';
import PartesProceso from '@/components/procesos/PartesProceso';
import FacturacionProceso from '@/components/procesos/FacturacionProceso';
import ActaFlujoProceso from '@/components/procesos/ActaFlujoProceso';
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
  Pill
} from '@/components/ui';
import { estadoLabel, estadoPill } from '@/lib/estados';
import { conActa, esNoAcuerdo, dinero } from '@/lib/actaProceso';
import { hoyEcuador } from '@/lib/accionProceso';

import {
  getProcesos,
  getCitasProceso,
  crearInvitacionProceso,
  leerInvitacionLlena,
  getAvancesProceso,
  crearAvanceProceso,
  subirActaFinalProceso,
  anularProceso,
  getExpedienteProceso,
  getCitas,
  descargarPdfActaFinal,
  descargarComprobantePagoActaFinal
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
    reagendada: 'bg-numa-100 text-numa-700'
  };

  return classes[estado] || 'bg-numa-100 text-numa-600';
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

export default function ProcesoDetallePage() {
  const params = useParams();
  const router = useRouter();
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
  const [loadingCitas, setLoadingCitas] = useState(false);

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

  const [showActaFinal, setShowActaFinal] = useState(false);
  const [archivoActaFinal, setArchivoActaFinal] = useState<File | null>(null);
  const [archivoComprobantePago, setArchivoComprobantePago] = useState<File | null>(null);
  const [subiendoActaFinal, setSubiendoActaFinal] = useState(false);
  // Pago del acta: completo (un comprobante) o en abonos (primer abono ahora,
  // el saldo se paga y se sube con el acta firmada).
  const [pagoModo, setPagoModo] = useState<'completo' | 'abonos'>('completo');
  const [montoTotal, setMontoTotal] = useState('');
  const [montoAbono, setMontoAbono] = useState('');
  const [fechaPago, setFechaPago] = useState(hoyEcuador());

  const cargarProceso = async () => {
    try {
      let procesos = await getProcesos();
      let encontrado = procesos.find((p: any) => p.id === procesoId) || null;

      // Si se acaba de crear el proceso y por alguna razón no aparece en el
      // primer intento, se reintenta una vez antes de mostrar "no encontrado".
      if (!encontrado) {
        await new Promise((resolve) => setTimeout(resolve, 600));
        procesos = await getProcesos();
        encontrado = procesos.find((p: any) => p.id === procesoId) || null;
      }

      setProceso(encontrado);

      // Si este proceso espera su acta pero otro del mismo mediador va
      // primero en la fila, se busca cuál es para nombrarlo en el aviso. El
      // administrador no está sujeto a la fila.
      if (encontrado && encontrado.bloqueante_id && !esAdminSesion()) {
        const primero = procesos.find((p: any) => p.id === encontrado.bloqueante_id);
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

  const cargarSeguimiento = async (p: any) => {
    if (p?.finalizado || p?.estado === 'archivado') {
      setLoadingExpediente(true);

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
      }

      return;
    }

    setLoadingCitas(true);

    try {
      const citas = await getCitasProceso(p.id);
      setCitasProceso(citas);
    } catch {
      setCitasProceso([]);
    } finally {
      setLoadingCitas(false);
    }

    setLoadingAvances(true);

    try {
      const avances = await getAvancesProceso(p.id);
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

      const p = await cargarProceso();

      setLoadingProceso(false);

      if (p) await cargarSeguimiento(p);
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
      if (Date.now() - ultima < 3000) return;
      ultima = Date.now();
      const p = await cargarProceso();
      if (p) await cargarSeguimiento(p);
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

  const horaInvitacionOcupada =
    !!invitacionForm.fecha &&
    !!invitacionForm.hora &&
    citasMediador.some(
      (c) =>
        c.fecha === invitacionForm.fecha &&
        c.hora?.slice(0, 5) === invitacionForm.hora
    );

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
      setError('Ya tienes otra invitación pendiente ese día a esa hora. Elige otra hora.');
      return;
    }

    if (!invitacionForm.observaciones.trim()) {
      setError('Debes ingresar una observación para la invitación');
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

    try {
      await crearAvanceProceso(proceso.id, {
        resultado: avanceForm.resultado,
        observacion: avanceForm.observacion
      });

      const avances = await getAvancesProceso(proceso.id);
      setAvancesProceso(avances);

      const citas = await getCitasProceso(proceso.id);
      setCitasProceso(citas);

      await cargarProceso();

      setAvanceForm({
        resultado: 'en_negociacion',
        observacion: ''
      });

      setSuccessMessage(
        `Avance registrado: ${estadoLabel(avanceForm.resultado)}.`
      );
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'Error al registrar avance');
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
      setSuccessMessage('Proceso anulado. Su número queda bloqueado y no se vuelve a usar.');
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'No se pudo anular el proceso');
    } finally {
      setGuardandoAnulacion(false);
    }
  };

  const handleSubirActaFinal = async () => {
    if (!proceso || !archivoActaFinal || !archivoComprobantePago) {
      setError('Debe seleccionar el acta final (PDF) y el comprobante de pago');
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
        archivoComprobantePago,
        {
          modo: pagoModo,
          fecha: fechaPago || undefined,
          montoTotal: pagoModo === 'abonos' ? Number(montoTotal) : undefined,
          montoAbono: pagoModo === 'abonos' ? Number(montoAbono) : undefined
        }
      );

      setShowActaFinal(false);
      setArchivoActaFinal(null);
      setArchivoComprobantePago(null);
      setPagoModo('completo');
      setMontoTotal('');
      setMontoAbono('');
      setFechaPago(hoyEcuador());

      const p = await cargarProceso();
      if (p) await cargarSeguimiento(p);

      setSuccessMessage(`${esNoAcuerdo(proceso) ? 'Acta de no acuerdo' : 'Acta final'} y comprobante de pago subidos correctamente: ${data.codigo_acta}`);
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'Error al subir el acta final y el comprobante de pago');
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
      setError('No se pudo abrir el PDF del acta final');
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
      setError('No se pudo descargar el PDF del acta final');
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

  // "Siguiente paso": una línea que le dice al mediador qué le toca hacer
  // ahora en este proceso, según su estado y sus invitaciones.
  const siguientePaso = (() => {
    if (!proceso) return null;

    if (proceso.etapa_acta === 'suspendido') {
      return 'Este proceso está suspendido por el administrador.';
    }

    if (proceso.etapa_acta === 'falta_firmada') {
      return proceso.pago_pendiente
        ? 'Imprime el acta, haz que la firmen y sube el acta firmada junto con el comprobante del segundo pago para completar el proceso.'
        : 'Imprime el acta, haz que la firmen las partes y sube el acta firmada en PDF para completar el proceso.';
    }

    if (proceso.finalizado) {
      return 'Este proceso está completo. Puedes consultar el historial.';
    }

    if (proceso.estado === 'anulado') {
      return 'Este proceso fue anulado. Solo puedes consultar su historial.';
    }

    if (conActa(proceso) && procesoPrimeroEnFila) {
      return `Espera tu turno: primero completa el proceso ${procesoPrimeroEnFila.codigo_proceso}.`;
    }

    if (conActa(proceso) && tieneFacturacion === false) {
      return 'Completa los datos de facturación y luego sube el acta y el comprobante de pago.';
    }

    if (conActa(proceso)) {
      return 'Sube el acta y el comprobante de pago para finalizar el proceso.';
    }

    if (proceso.estado === 'cerrado_sin_acuerdo') {
      return 'Este proceso cerró sin acuerdo. Si lo necesitas, puedes emitir el acta de no acuerdo; si no, solo consulta su historial.';
    }

    if (proceso.estado === 'archivado') {
      return 'Este proceso ya está cerrado. Solo puedes consultar su historial.';
    }

    if (citaPendiente) {
      const fechaCita = String(citaPendiente.fecha || '').slice(0, 10);
      const horaCita = String(citaPendiente.hora || '').slice(0, 5);
      const fechaHoraCita = new Date(`${fechaCita}T${horaCita || '00:00'}:00`);
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
      { etiqueta: 'Facturación', hecho: tieneFacturacion === true },
      { etiqueta: 'Acta y comprobante', hecho: !!proceso.finalizado },
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
        <button onClick={() => router.push('/procesos')} className="btn-ghost text-sm mb-4">
          <ArrowLeft className="w-4 h-4" />
          Volver a Procesos
        </button>

        <EmptyState message="Proceso no encontrado." />
      </>
    );
  }

  return (
    <>
      <button onClick={() => router.push('/procesos')} className="btn-ghost text-sm mb-4 -ml-2">
        <ArrowLeft className="w-4 h-4" />
        Volver a Procesos
      </button>

      {/* En celular el título y los botones van uno debajo del otro (para que el
          código y los nombres no queden apretados); desde pantallas medianas
          vuelven a ir lado a lado como antes. */}
      <div className="page-header items-start flex-col gap-3 sm:flex-row sm:gap-0">
        <div>
          <h1 className="section-title whitespace-nowrap">{proceso.codigo_proceso}</h1>
          <p className="text-numa-700 mt-1">
            {proceso.demandante}
            {proceso.total_solicitantes > 1 && (
              <span className="text-numa-400"> y {proceso.total_solicitantes - 1} más</span>
            )}{' '}
            vs {proceso.demandado}
            {proceso.total_invitados > 1 && (
              <span className="text-numa-400"> y {proceso.total_invitados - 1} más</span>
            )}
          </p>
          <p className="text-xs text-numa-400 mt-1">
            {proceso.demandante_cedula || '—'} · {proceso.demandado_cedula || '—'}
          </p>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
<Pill label={estadoLabel(proceso.estado)} {...estadoPill(proceso.estado)} />

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
            className="btn-secondary btn-sm"
          >
            <Printer className="w-3.5 h-3.5" />
            Imprimir expediente
          </button>
        </div>
      </div>

      {/* Se muestra justo debajo del encabezado (no al fondo de la página)
          para que el mediador vea de una vez si este proceso tiene su acta
          pendiente, y si es el que debe subir primero (fila FIFO) o si hay
          otro con prioridad. */}
      {procesoPrimeroEnFila ? (
        <div className="mb-4 text-sm px-4 py-3 rounded-sm border font-medium bg-blue-50 border-blue-100 text-blue-700 flex items-center justify-between gap-3 flex-wrap">
          <span>
            Este proceso también tiene su acta pendiente, pero primero debes
            completar el proceso{' '}
            <strong>{procesoPrimeroEnFila.codigo_proceso}</strong> (acta,
            comprobante y acta firmada) — es el primero en la fila.
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

      <div className="card p-5 mb-4 grid grid-cols-1 md:grid-cols-4 gap-4 text-sm">
        <div>
          <p className="text-numa-400 text-xs mb-1">Ciudad · Sucursal</p>
          <p className="text-numa-800 font-medium">
            {proceso.ciudad || '—'} · {proceso.sucursal || '—'}
          </p>
        </div>

        <div>
          <p className="text-numa-400 text-xs mb-1">Mediador</p>
          <p className="text-numa-800 font-medium">{proceso.usuario || '—'}</p>
        </div>

        <div>
          <p className="text-numa-400 text-xs mb-1">Tema</p>
          <p className="text-numa-800 font-medium">{proceso.tema}</p>
        </div>

        <div>
          <p className="text-numa-400 text-xs mb-1">Fecha de apertura</p>
          <p className="text-numa-800 font-medium">
            {proceso.fecha_creacion
              ? new Date(proceso.fecha_creacion).toLocaleDateString('es-EC')
              : '—'}
          </p>
        </div>
      </div>

      <PartesProceso
        procesoId={proceso.id}
        editable={proceso.estado === 'en_negociacion'}
        onCambio={cargarProceso}
      />

      {proceso.estado !== 'anulado' && (
        <div id="bloque-facturacion">
          <FacturacionProceso
            procesoId={proceso.id}
            editable={esAdminSesion() || proceso.etapa_acta !== 'completa'}
            onEstado={setTieneFacturacion}
            finalizado={!!proceso.finalizado}
            estado={conActa(proceso) ? 'cerrado_con_acuerdo' : proceso.estado}
          />
        </div>
      )}

      {esAdminSesion() && proceso.estado === 'en_negociacion' && (
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
                Anular deja el proceso como <strong>Anulado</strong>: no se borra, conserva su
                número y su historial, y se cancelan sus invitaciones pendientes. Esto no se puede
                deshacer.
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

      <div className="space-y-6">
        <div>
          <h3 className="text-sm font-semibold text-numa-800 mb-3">
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
                    className={`card p-4 border-l-4 ${getEstadoCitaBorderClass(cita.estado)}`}
                  >
                    <div className="flex justify-between gap-3">
                      <div>
                        <p className="font-semibold text-numa-800">
                          Invitación #{index + 1}
                        </p>

                        <p className="text-sm text-numa-500 mt-1">
                          {cita.fecha ? cita.fecha.slice(0, 10).split('-').reverse().join('/') : '—'} · {cita.hora?.slice(0, 5)}
                        </p>

                        {/* Quién creó esta invitación — no siempre es el
                            mediador asignado al proceso: un admin puede
                            crearla en su nombre (ej. el mediador se
                            enfermó), y esto deja ese dato visible. */}
                        {cita.creado_por && (
                          <p className="text-xs text-numa-400 mt-1">
                            Invitación creada por: {cita.creado_por}
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
                            className="btn-secondary btn-sm mt-2"
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
                      <div className="mt-3">
                        <p className="text-xs font-semibold text-numa-500">
                          Observación de invitación:
                        </p>

                        <p className="text-sm text-numa-600 whitespace-pre-wrap">
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
                      <div className="mt-4 border-t border-numa-100 pt-3">
                        <p className="text-xs font-semibold text-numa-500">
                          Resultado:
                        </p>

                        <p className="text-sm font-medium text-numa-800">
                          {estadoLabel(avance.resultado)}
                        </p>

                        <p className="text-xs font-semibold text-numa-500 mt-3">
                          Registro / observación:
                        </p>

                        <p className="text-sm text-numa-600 whitespace-pre-wrap">
                          {avance.avance_observacion || avance.observacion}
                        </p>

                        {avance.usuario_avance && (
                          <p className="text-xs text-numa-400 mt-2">
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
                      <div className="mt-4 border-t border-numa-100 pt-3">
                        {citaEstaAtrasada(cita) ? (
                          <p className="text-sm font-medium text-red-700">
                            Esta invitación ya pasó y no tiene resultado. Registra cómo terminó la reunión.
                          </p>
                        ) : cita.estado === 'cancelada' ? (
                          <p className="text-sm text-numa-400">
                            Invitación cancelada: no necesita resultado.
                          </p>
                        ) : (
                          <p className="text-sm text-numa-400">
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

        {proceso.finalizado && proceso.etapa_acta !== 'falta_firmada' && (
          <div className="p-4 bg-green-50 border border-green-100 rounded-sm text-sm text-green-700">
            Este proceso ya fue finalizado. Solo se permite consultar el historial.
          </div>
        )}

        {expedienteProceso?.acta_final && (
          <div className="card p-4 bg-green-50/40 border-green-100">
            <h3 className="text-sm font-semibold text-green-800 mb-3">
              Acta final y comprobante
            </h3>

            {/* Código acta se queda fijo a la izquierda (como estaba antes),
                y los botones quedan centrados en el espacio restante de la
                fila, sin pegarse al borde derecho de la tarjeta. */}
            <div className="flex items-center gap-3 flex-wrap">
              <p className="text-sm text-green-700 shrink-0">
                Código acta:{' '}
                <span className="font-semibold code-text">
                  {expedienteProceso.acta_final.codigo_acta}
                </span>
              </p>

            </div>

            {/* Admin y mediador ven el acta y el comprobante; solo el
                administrador puede descargarlos. */}
            {(
              <div className="mt-2 space-y-0.5">
                <DocFila
                  etiqueta="Acta final"
                  textoVer="Ver acta"
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

            <p className="text-sm text-green-700 mt-1">
              Subido por: {expedienteProceso.acta_final.subido_por || '—'}
            </p>

            <p className="text-sm text-green-700 mt-1">
              Fecha oficial:{' '}
              {expedienteProceso.acta_final.fecha_subida
                ? new Date(
                    expedienteProceso.acta_final.fecha_subida
                  ).toLocaleString('es-EC', {
                    day: '2-digit', month: '2-digit', year: 'numeric',
                    hour: 'numeric', minute: '2-digit'
                  })
                : '—'}
            </p>
          </div>
        )}

        {!proceso.finalizado &&
          proceso.estado === 'en_negociacion' &&
          !citaPendiente && (
          <div className="card p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-numa-800">
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
                <input
                  ref={archivoInvitacionRef}
                  type="file"
                  accept=".docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                  className="hidden"
                  onChange={(e) => handleLeerInvitacion(e.target.files?.[0] || null)}
                />
                <button
                  type="button"
                  onClick={() => archivoInvitacionRef.current?.click()}
                  disabled={leyendoInvitacion}
                  className="btn-secondary btn-sm disabled:opacity-50"
                >
                  <Upload className="w-3.5 h-3.5" />
                  {leyendoInvitacion ? 'Leyendo...' : 'Subir invitación ya llena (Word o PDF)'}
                </button>
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
                <p className="text-xs text-numa-500">
                  Sube el Word o el PDF hecho en computadora (no una foto, un escaneo ni un
                  documento escrito a mano). El sistema lee la fecha y la hora y llena el
                  formulario de abajo; tú lo revisas y creas la invitación. El archivo no se guarda.
                </p>
              </div>

              {lecturaInvitacion && (
                <div className="mt-3 text-sm space-y-2">
                  <p className="text-numa-700 font-medium">Esto fue lo que se leyó del documento:</p>
                  <ul className="space-y-0.5">
                    {lecturaInvitacion.partes.map((pt: any, i: number) => (
                      <li key={i} className={pt.encontrado ? 'text-green-700' : 'text-amber-700'}>
                        {pt.encontrado ? '✓' : '⚠'} {pt.nombre}{' '}
                        <span className="text-xs text-numa-400">
                          ({pt.rol === 'solicitante' ? 'solicitante' : 'invitado'})
                        </span>
                      </li>
                    ))}
                  </ul>
                  {lecturaInvitacion.avisos.map((a: string, i: number) => (
                    <p key={i} className="text-amber-700 text-xs">
                      ⚠ {a}
                    </p>
                  ))}
                  <p className="text-xs text-numa-500">
                    Revisa la fecha, la hora y las observaciones abajo; puedes corregir lo que haga falta.
                  </p>
                </div>
              )}
            </div>

            {mostrarCalendarioInvitacion && (
              <div className="mb-4 border border-numa-100 rounded-sm p-4">
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
                    ? 'Ya tienes otra invitación pendiente ese día a esa hora'
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
                label="Observaciones"
                rows={3}
                value={invitacionForm.observaciones}
                onChange={(e) =>
                  setInvitacionForm({
                    ...invitacionForm,
                    observaciones: e.target.value
                  })
                }
                placeholder="Ejemplo: Primera invitación a reunión de mediación..."
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
                  horaInvitacionOcupada ||
                  !invitacionForm.observaciones.trim()
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
          citaPendiente && (
            <div className="card p-4">
              <h3 className="text-sm font-semibold text-numa-800 mb-3">
                Registrar resultado de la invitación pendiente
              </h3>

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
                <option value="cerrado_con_acuerdo">Cerrado con acuerdo</option>
                <option value="cerrado_sin_acuerdo">Cerrado sin acuerdo</option>
                <option value="archivado">Archivado</option>
              </SelectField>

              <div className="mt-4">
                <TextareaField
                  label={
                    avanceForm.resultado === 'cerrado_con_acuerdo'
                      ? 'Detalle del acuerdo (se imprimirá tal cual en el acta)'
                      : avanceForm.resultado === 'no_realizada'
                        ? 'Constancia: quién no asistió y el motivo'
                        : 'Observación / registro de reunión'
                  }
                  rows={4}
                  value={avanceForm.observacion}
                  onChange={(e) =>
                    setAvanceForm({ ...avanceForm, observacion: e.target.value })
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

                {avanceForm.resultado === 'cerrado_con_acuerdo' && !confirmandoCierre && (
                  <div className="mb-3 p-3 border border-gold-200 bg-gold-50 rounded-sm text-xs text-gold-800">
                    Este texto es el acuerdo oficial: se escribe una sola vez y sale en
                    el acta que firmarán las partes. Revísalo bien; después solo el
                    administrador podrá corregirlo.
                  </div>
                )}

                {confirmandoCierre && (
                  <div className="mb-3 p-3 border border-amber-300 bg-amber-50 rounded-sm text-sm text-amber-900">
                    {avanceForm.resultado === 'cerrado_con_acuerdo' ? (
                      <>
                        <p className="font-semibold mb-1">¿Está seguro de este acuerdo?</p>
                        <p className="whitespace-pre-line mb-2">{avanceForm.observacion}</p>
                        <p>
                          Después de confirmar no podrás cambiarlo ni cambiar el resultado
                          del proceso.
                        </p>
                      </>
                    ) : (
                      <>
                        Vas a marcar este proceso como{' '}
                        <strong>{estadoLabel(avanceForm.resultado)}</strong>.
                        Después de esto ya no podrás cambiar el resultado. ¿Confirmas?
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
                    {guardandoAvance ? 'Guardando...' : 'Registrar avance'}
                  </button>
                )}
              </div>
            </div>
          )}

        {conActa(proceso) && !proceso.finalizado && !proceso.suspendido && (
          <div className="card p-4">
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <p className="text-sm text-numa-600">
                {procesoPrimeroEnFila
                  ? `Este proceso necesita su acta, pero primero debes completar el proceso ${procesoPrimeroEnFila.codigo_proceso} (es el primero en la fila).`
                  : esNoAcuerdo(proceso)
                  ? 'Se pidió el acta de no acuerdo. Sube el acta y el comprobante de pago para cerrarla.'
                  : 'El proceso llegó a un acuerdo. Sube el acta final y el comprobante de pago para cerrarlo.'}
              </p>

              {procesoPrimeroEnFila ? (
                <button
                  type="button"
                  onClick={() => router.push(`/procesos/${procesoPrimeroEnFila.id}`)}
                  className="btn-secondary shrink-0"
                >
                  Ir a {procesoPrimeroEnFila.codigo_proceso}
                </button>
              ) : tieneFacturacion === false ? (
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
                    setArchivoActaFinal(null);
                    setPagoModo('completo');
                    setMontoTotal('');
                    setMontoAbono('');
                    setFechaPago(hoyEcuador());
                    setError('');
                  }}
                  className="btn-primary shrink-0"
                >
                  <Upload className="w-4 h-4" />
                  Subir Acta y Comprobante
                </button>
              )}
            </div>
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
      </div>

      <Modal
        open={showActaFinal}
        onClose={() => {
          setShowActaFinal(false);
          setArchivoActaFinal(null);
          setArchivoComprobantePago(null);
          setError('');
        }}
        title={`${esNoAcuerdo(proceso) ? 'Subir Acta de No Acuerdo' : 'Subir Acta Final'} — ${proceso.codigo_proceso}`}
        size="md"
      >
        {error && (
          <div className="mb-4">
            <ErrorAlert message={error} />
          </div>
        )}

        <div className="space-y-4">
          <p className="text-sm text-numa-600">
            Debes subir el acta y el comprobante de pago juntos. Después
            podrás imprimir el acta con las firmas y subirla firmada.
            Mientras este proceso no esté completo, no podrás subir actas de tus
            otros procesos.
          </p>

          <div>
            <label className="block text-sm font-medium text-numa-700 mb-1">
              {esNoAcuerdo(proceso) ? 'Acta final no acuerdo (PDF)' : 'Acta final (PDF)'}
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
            <label className="block text-sm font-medium text-numa-700 mb-1">
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
            <p className="block text-sm font-medium text-numa-700 mb-2">¿Cómo se pagó?</p>
            <div className="flex flex-col sm:flex-row gap-2">
              <label className="flex items-center gap-2 text-sm text-numa-700 border border-numa-200 rounded-sm px-3 py-2 cursor-pointer">
                <input
                  type="radio"
                  name="pago-modo"
                  checked={pagoModo === 'completo'}
                  onChange={() => setPagoModo('completo')}
                />
                Pago completo (un comprobante)
              </label>
              <label className="flex items-center gap-2 text-sm text-numa-700 border border-numa-200 rounded-sm px-3 py-2 cursor-pointer">
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
            <label className="block text-sm font-medium text-numa-700 mb-1">
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
                  <label className="block text-sm font-medium text-numa-700 mb-1">
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
                  <label className="block text-sm font-medium text-numa-700 mb-1">
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
                  proceso quedará pendiente hasta que subas el acta firmada junto con el comprobante
                  del segundo pago.
                </p>
              )}
            </div>
          )}

          <div className="flex justify-end gap-3 pt-4">
            <button
              type="button"
              onClick={() => {
                setShowActaFinal(false);
                setArchivoActaFinal(null);
                setArchivoComprobantePago(null);
              }}
              className="btn-secondary"
            >
              Cancelar
            </button>

            <button
              type="button"
              onClick={handleSubirActaFinal}
              disabled={subiendoActaFinal || !archivoActaFinal || !archivoComprobantePago}
              className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {subiendoActaFinal ? 'Subiendo...' : 'Subir Acta y Comprobante'}
            </button>
          </div>
        </div>
      </Modal>
    </>
  );
}
