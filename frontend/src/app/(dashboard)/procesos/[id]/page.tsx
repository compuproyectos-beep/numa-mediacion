'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, Printer, Upload, Calendar as CalendarIcon, Eye, Download, Receipt } from 'lucide-react';
import CalendarioAgendaMediador from '@/components/citas/CalendarioAgendaMediador';
import {
  Spinner,
  EmptyState,
  SelectField,
  TextareaField,
  InputField,
  ErrorAlert,
  SuccessAlert,
  Modal
} from '@/components/ui';

import {
  getProcesos,
  getCitasProceso,
  crearInvitacionProceso,
  getAvancesProceso,
  crearAvanceProceso,
  subirActaFinalProceso,
  getExpedienteProceso,
  getCitas,
  descargarPdfActaFinal,
  descargarComprobantePagoActaFinal
} from '@/lib/services';

const getEstadoProcesoLabel = (estado: string) => {
  const labels: any = {
    en_negociacion: 'En negociación',
    cerrado_con_acuerdo: 'Cerrado con acuerdo',
    cerrado_sin_acuerdo: 'Cerrado sin acuerdo',
    archivado: 'Archivado'
  };

  return labels[estado] || estado;
};

const getEstadoProcesoClass = (estado: string) => {
  const classes: any = {
    en_negociacion: 'bg-amber-50 text-amber-700',
    cerrado_con_acuerdo: 'bg-green-50 text-green-700',
    cerrado_sin_acuerdo: 'bg-red-50 text-red-700',
    archivado: 'bg-slate-100 text-slate-600'
  };

  return classes[estado] || 'bg-numa-100 text-numa-600';
};

// Mismos colores que ya se usan en la Agenda (ver colorPorEstado en
// CalendarioAgendaMediador) para el estado de una invitación — así una
// invitación pendiente/realizada/cancelada se identifica igual en los dos
// lugares del sistema.
const getEstadoCitaBadgeClass = (estado: string) => {
  const classes: any = {
    pendiente: 'bg-gold-400/10 text-gold-700',
    realizada: 'bg-green-50 text-green-700',
    cancelada: 'bg-red-50 text-red-700',
    reagendada: 'bg-numa-100 text-numa-700'
  };

  return classes[estado] || 'bg-numa-100 text-numa-600';
};

const getEstadoCitaBorderClass = (estado: string) => {
  const classes: any = {
    pendiente: 'border-l-gold-400',
    realizada: 'border-l-green-600',
    cancelada: 'border-l-red-600',
    reagendada: 'border-l-numa-600'
  };

  return classes[estado] || 'border-l-numa-200';
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
  const [citasMediador, setCitasMediador] = useState<any[]>([]);

  const [avanceForm, setAvanceForm] = useState({
    resultado: 'en_negociacion',
    observacion: ''
  });
  const [guardandoAvance, setGuardandoAvance] = useState(false);

  // Se refresca cada minuto para que el contador de las 48 horas del acta
  // final se vea actualizado sin que el mediador tenga que recargar la
  // página.
  const [ahora, setAhora] = useState(() => new Date());

  useEffect(() => {
    const intervalo = setInterval(() => setAhora(new Date()), 60000);
    return () => clearInterval(intervalo);
  }, []);

  const [showActaFinal, setShowActaFinal] = useState(false);
  const [archivoActaFinal, setArchivoActaFinal] = useState<File | null>(null);
  const [archivoComprobantePago, setArchivoComprobantePago] = useState<File | null>(null);
  const [subiendoActaFinal, setSubiendoActaFinal] = useState(false);

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

      // Si este proceso está pendiente de acta pero no es el primero en la
      // fila, se busca cuál sí lo es (mismo mediador), para nombrarlo en el
      // aviso en vez de dejarlo genérico.
      if (
        encontrado &&
        encontrado.estado === 'cerrado_con_acuerdo' &&
        !encontrado.finalizado &&
        !encontrado.acta_primero_en_fila
      ) {
        const primero = procesos.find(
          (p: any) =>
            p.usuario_id === encontrado.usuario_id &&
            p.estado === 'cerrado_con_acuerdo' &&
            !p.finalizado &&
            p.acta_primero_en_fila
        );
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

  const handleCrearAvance = async () => {
    if (!proceso) return;

    if (!avanceForm.observacion.trim()) {
      setError('Debe ingresar una observación');
      return;
    }

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
        `Avance registrado: ${getEstadoProcesoLabel(avanceForm.resultado)}.`
      );
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'Error al registrar avance');
    } finally {
      setGuardandoAvance(false);
    }
  };

  const handleSubirActaFinal = async () => {
    if (!proceso || !archivoActaFinal || !archivoComprobantePago) {
      setError('Debe seleccionar el acta final (PDF) y el comprobante de pago');
      return;
    }

    setSubiendoActaFinal(true);
    setError('');
    setSuccessMessage('');

    try {
      const data = await subirActaFinalProceso(
        proceso.id,
        archivoActaFinal,
        archivoComprobantePago
      );

      setShowActaFinal(false);
      setArchivoActaFinal(null);
      setArchivoComprobantePago(null);

      const p = await cargarProceso();
      if (p) await cargarSeguimiento(p);

      setSuccessMessage(`Acta final y comprobante de pago subidos correctamente: ${data.codigo_acta}`);
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

  // Da un texto legible: "1 día, 15 horas y 30 minutos" si ya pasó un día
  // completo, o "5h 30min" si falta menos de un día. Siempre incluye los
  // minutos, para poder distinguir dos procesos que se cerraron casi a la
  // misma hora.
  const formatDuracion = (horas: number, minutos: number) => {
    if (horas >= 24) {
      const dias = Math.floor(horas / 24);
      const horasRestantes = horas % 24;
      const textoDias = `${dias} día${dias > 1 ? 's' : ''}`;

      const partes = [textoDias];
      if (horasRestantes > 0) {
        partes.push(`${horasRestantes} hora${horasRestantes > 1 ? 's' : ''}`);
      }
      partes.push(`${minutos} minuto${minutos !== 1 ? 's' : ''}`);

      return partes.length > 1
        ? `${partes.slice(0, -1).join(', ')} y ${partes[partes.length - 1]}`
        : partes[0];
    }
    return `${horas}h ${minutos}min`;
  };

  // Cuenta regresiva de las 48 horas que tiene el mediador, desde que el
  // proceso pasó a "cerrado con acuerdo", para subir el acta final junto
  // con el comprobante de pago.
  const plazoActaInfo = (() => {
    // Una vez que el acta final ya se subió (finalizado = true), el plazo
    // de 48 horas deja de tener sentido — si no, el aviso se quedaba
    // mostrando "venció hace..." para siempre, aunque ya se hubiera subido.
    if (proceso?.finalizado) return null;

    const inicio = parseFechaUTC(proceso?.fecha_acuerdo);
    if (!inicio) return null;

    const limiteMs = inicio.getTime() + 48 * 60 * 60 * 1000;
    const msRestante = limiteMs - ahora.getTime();
    const vencido = msRestante <= 0;

    const totalMinutos = Math.floor(Math.abs(msRestante) / 60000);
    const horas = Math.floor(totalMinutos / 60);
    const minutos = totalMinutos % 60;

    return { vencido, horas, minutos, texto: formatDuracion(horas, minutos) };
  })();

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

      <div className="page-header items-start">
        <div>
          <h1 className="section-title">{proceso.codigo_proceso}</h1>
          <p className="text-numa-700 mt-1">
            {proceso.demandante} vs {proceso.demandado}
          </p>
          <p className="text-xs text-numa-400 mt-1">
            {proceso.demandante_cedula} · {proceso.demandado_cedula}
          </p>
        </div>

        <div className="flex items-center gap-3">
          <span
            className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold ${getEstadoProcesoClass(
              proceso.estado
            )}`}
          >
            {getEstadoProcesoLabel(proceso.estado)}
          </span>

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
            className="btn-secondary text-xs"
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
            Este proceso también tiene el acta final pendiente, pero primero
            debes subir la del proceso{' '}
            <strong>{procesoPrimeroEnFila.codigo_proceso}</strong> — es el
            primero en la fila. Súbela ahí para poder continuar con este.
          </span>

          <button
            type="button"
            onClick={() => router.push(`/procesos/${procesoPrimeroEnFila.id}`)}
            className="btn-secondary text-xs py-1.5 px-3 shrink-0"
          >
            Ir a {procesoPrimeroEnFila.codigo_proceso}
          </button>
        </div>
      ) : (
        plazoActaInfo && (
          <div
            className={`mb-4 text-sm px-4 py-3 rounded-sm border font-medium ${
              plazoActaInfo.vencido
                ? 'bg-red-50 border-red-100 text-red-700'
                : 'bg-gold-50 border-gold-100 text-gold-700'
            }`}
          >
            {plazoActaInfo.vencido
              ? `Ya pasó el plazo recomendado de 48 horas para subir el acta final y el comprobante de pago de este proceso (hace ${plazoActaInfo.texto}). Súbelos cuanto antes — este proceso ya no bloquea la subida de otros, pero sigue pendiente.`
              : `Te quedan ${plazoActaInfo.texto} del plazo recomendado de 48 horas para subir el acta final y el comprobante de pago. Mientras esté dentro de este plazo, no podrás subir actas de otros procesos pendientes.`}
          </div>
        )
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

      <div className="card p-5 mb-6 grid grid-cols-1 md:grid-cols-4 gap-4 text-sm">
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
                          {cita.fecha} — {cita.hora?.slice(0, 5)}
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
                      </div>

                      <span
                        className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold capitalize shrink-0 ${getEstadoCitaBadgeClass(
                          cita.estado
                        )}`}
                      >
                        {cita.estado}
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
                          {getEstadoProcesoLabel(avance.resultado)}
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
                        <p className="text-sm text-numa-400">
                          Pendiente de registrar resultado.
                        </p>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {proceso.finalizado && (
          <div className="p-4 bg-green-50 border border-green-100 rounded-sm text-sm text-green-700">
            Este proceso ya fue finalizado. Solo se permite consultar el historial.
          </div>
        )}

        {expedienteProceso?.acta_final && (
          <div className="card p-4 bg-green-50/40 border-green-100">
            <h3 className="text-sm font-semibold text-green-800 mb-3">
              Acta final subida
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

              <div className="flex flex-wrap gap-2 flex-1 justify-center">
                <button
                  type="button"
                  onClick={() => handleVerPdfActaFinal(expedienteProceso.acta_final.id)}
                  className="btn-ghost text-xs py-1 px-2"
                >
                  <Eye className="w-4 h-4" />
                  Ver PDF
                </button>

                <button
                  type="button"
                  onClick={() =>
                    handleDescargarPdfActaFinal(
                      expedienteProceso.acta_final.id,
                      expedienteProceso.acta_final.codigo_acta
                    )
                  }
                  className="btn-ghost text-xs py-1 px-2"
                >
                  <Download className="w-4 h-4" />
                  Descargar
                </button>

                {expedienteProceso.acta_final.nombre_comprobante_pago && (
                  <>
                    <button
                      type="button"
                      onClick={() => handleVerComprobanteActaFinal(expedienteProceso.acta_final.id)}
                      className="btn-ghost text-xs py-1 px-2"
                    >
                      <Receipt className="w-4 h-4" />
                      Ver comprobante
                    </button>

                    <button
                      type="button"
                      onClick={() =>
                        handleDescargarComprobanteActaFinal(
                          expedienteProceso.acta_final.id,
                          expedienteProceso.acta_final.codigo_acta,
                          expedienteProceso.acta_final.nombre_comprobante_pago
                        )
                      }
                      className="btn-ghost text-xs py-1 px-2"
                    >
                      <Download className="w-4 h-4" />
                      Descargar comprobante
                    </button>
                  </>
                )}
              </div>
            </div>

            <p className="text-sm text-green-700 mt-1">
              Subido por: {expedienteProceso.acta_final.subido_por || '—'}
            </p>

            <p className="text-sm text-green-700 mt-1">
              Fecha oficial:{' '}
              {expedienteProceso.acta_final.fecha_subida
                ? new Date(
                    expedienteProceso.acta_final.fecha_subida
                  ).toLocaleString('es-EC')
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
                  className="btn-ghost text-xs"
                >
                  <CalendarIcon className="w-3.5 h-3.5" />
                  Ocultar calendario
                </button>
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
                  className="btn-ghost text-xs"
                >
                  <CalendarIcon className="w-3.5 h-3.5" />
                  Mostrar calendario
                </button>
              )}
            </div>

            <div className="mt-4">
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
                onChange={(e) =>
                  setAvanceForm({ ...avanceForm, resultado: e.target.value })
                }
              >
                <option value="en_negociacion">En negociación</option>
                <option value="cerrado_con_acuerdo">Cerrado con acuerdo</option>
                <option value="cerrado_sin_acuerdo">Cerrado sin acuerdo</option>
                <option value="archivado">Archivado</option>
              </SelectField>

              <div className="mt-4">
                <TextareaField
                  label="Observación / registro de reunión"
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

                <button
                  onClick={handleCrearAvance}
                  disabled={guardandoAvance}
                  className="btn-primary"
                >
                  {guardandoAvance ? 'Guardando...' : 'Registrar avance'}
                </button>
              </div>
            </div>
          )}

        {proceso.estado === 'cerrado_con_acuerdo' && !proceso.finalizado && (
          <div className="card p-4">
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <p className="text-sm text-numa-600">
                {procesoPrimeroEnFila
                  ? `Este proceso llegó a un acuerdo, pero primero debes subir el acta de ${procesoPrimeroEnFila.codigo_proceso} (es el primero en la fila).`
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
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setShowActaFinal(true);
                    setArchivoActaFinal(null);
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
      </div>

      <Modal
        open={showActaFinal}
        onClose={() => {
          setShowActaFinal(false);
          setArchivoActaFinal(null);
          setArchivoComprobantePago(null);
          setError('');
        }}
        title={`Subir Acta Final — ${proceso.codigo_proceso}`}
        size="md"
      >
        {error && (
          <div className="mb-4">
            <ErrorAlert message={error} />
          </div>
        )}

        <div className="space-y-4">
          <p className="text-sm text-numa-600">
            Debe subir el acta final y el comprobante de pago juntos: el proceso no
            queda finalizado hasta que ambos archivos estén cargados. El plazo
            recomendado es de 48 horas desde que el proceso pasó a &quot;Cerrado con
            acuerdo&quot;. Si tiene más de un proceso pendiente a la vez, no podrá
            subir actas de los demás mientras este siga dentro de su plazo de 48
            horas — pero si se le pasa el plazo sin subirlo, deja de bloquear a los
            otros (aunque sigue pendiente).
          </p>

          {plazoActaInfo && (
            <div
              className={`text-xs px-3 py-2 rounded-sm border ${
                plazoActaInfo.vencido
                  ? 'bg-red-50 border-red-100 text-red-700'
                  : 'bg-gold-50 border-gold-100 text-gold-700'
              }`}
            >
              {plazoActaInfo.vencido
                ? `Ya pasó el plazo recomendado de 48 horas (hace ${plazoActaInfo.texto}).`
                : `Te quedan ${plazoActaInfo.texto} del plazo recomendado de 48 horas.`}
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-numa-700 mb-1">
              Acta final (PDF)
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
              {subiendoActaFinal ? 'Subiendo...' : 'Subir Acta Final y Comprobante'}
            </button>
          </div>
        </div>
      </Modal>
    </>
  );
}
