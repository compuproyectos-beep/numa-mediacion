'use client';

import { useState } from 'react';
import { Printer, Upload, Eye, Download, PauseCircle, Pencil, FileX, CheckCircle2 } from 'lucide-react';
import { Modal, ErrorAlert, TextareaField } from '@/components/ui';
import {
  subirActaFirmada,
  descargarActaFirmada,
  corregirAcuerdo,
  getHistorialAcuerdo,
  suspenderProceso,
  solicitarActaNoAcuerdo,
  pedirNumeroActaProceso,
  descargarComprobanteFinal,
  marcarActaImpresa,
  marcarEfectivoDepositado
} from '@/lib/services';
import { conActa, esNoAcuerdo, dinero, saldoPago, fechaDia } from '@/lib/actaProceso';
import { hoyEcuador } from '@/lib/accionProceso';
import { getUser } from '@/lib/auth';

interface Props {
  proceso: any;
  esAdmin: boolean;
  onCambio: () => void;
}

const fmt = (v?: string) => {
  if (!v) return '—';
  const d = new Date(v);
  return isNaN(d.getTime())
    ? '—'
    : d.toLocaleDateString('es-EC', { day: '2-digit', month: '2-digit', year: 'numeric' });
};

// Todo lo que pasa DESPUÉS de cerrar con acuerdo: el acuerdo escrito, el acta
// imprimible, la subida del acta firmada, y (solo admin) corregir el acuerdo y
// suspender/reactivar el proceso.
export default function ActaFlujoProceso({ proceso, esAdmin, onCambio }: Props) {
  const [error, setError] = useState('');
  // El botón de subir el acta firmada se habilita después de abrir
  // "Imprimir acta para firmar" una vez. Se guarda en el servidor, así que
  // vale desde cualquier computador.
  const [imprimioAhora, setImprimioAhora] = useState(false);
  // Sin el botón de imprimir, ya no se exige haber impreso el acta para poder subirla.
  const yaImprimio: boolean = true as boolean;
  const marcarImpresa = () => {
    if (yaImprimio) return;
    setImprimioAhora(true);
    marcarActaImpresa(proceso.id).catch(() => {});
  };
  const [ok, setOk] = useState('');

  // Acta firmada
  const [showFirmada, setShowFirmada] = useState(false);
  const [archivoFirmada, setArchivoFirmada] = useState<File | null>(null);
  const [confirmoFirmada, setConfirmoFirmada] = useState(false);
  const [subiendo, setSubiendo] = useState(false);
  // Segundo pago (cuando el pago quedó en abonos)
  const [archivoSegundoPago, setArchivoSegundoPago] = useState<File | null>(null);
  const [fechaSegundoPago, setFechaSegundoPago] = useState(hoyEcuador());
  const [formaSaldo, setFormaSaldo] = useState<'deposito' | 'efectivo'>('deposito');
  // Efectivo recibido que falta depositar
  const [depositando, setDepositando] = useState<number | null>(null);
  const [confirmarDeposito, setConfirmarDeposito] = useState<number | null>(null);

  // Acta de no acuerdo (opcional)
  const [confirmandoNA, setConfirmandoNA] = useState(false);
  const [pidiendoNA, setPidiendoNA] = useState(false);

  // Corregir acuerdo (admin)
  const [showCorregir, setShowCorregir] = useState(false);
  const [textoNuevo, setTextoNuevo] = useState('');
  const [motivoCorreccion, setMotivoCorreccion] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [historial, setHistorial] = useState<any[] | null>(null);

  // Suspender (admin)
  const [showSuspender, setShowSuspender] = useState(false);
  // true: dar de baja el acta (libera el número 30 días); false: solo suspender.
  const [modoBaja, setModoBaja] = useState(false);
  const [motivoSuspension, setMotivoSuspension] = useState('');

  const etapa = proceso.etapa_acta as string | null;
  const msg = (e: any, def: string) => e?.response?.data?.detail || def;

  const pedirActaNA = async () => {
    setPidiendoNA(true);
    setError('');
    try {
      // Si el proceso no tiene número de acta todavía, se pide junto con el acta.
      if (!proceso.numero_acta_codigo) await pedirNumeroActaProceso(proceso.id);
      await solicitarActaNoAcuerdo(proceso.id);
      setConfirmandoNA(false);
      setOk('Acta de no acuerdo pedida. Ahora sube la documentación y el comprobante de pago.');
      onCambio();
    } catch (e: any) {
      setError(msg(e, 'No se pudo pedir el acta de no acuerdo'));
    } finally {
      setPidiendoNA(false);
    }
  };

  // Proceso cerrado sin acuerdo que todavía no pidió su acta: solo se ofrece
  // la opción (es opcional). Si no es ni con acuerdo ni sin acuerdo, no hay nada.
  if (!conActa(proceso)) {
    if (!esNoAcuerdo(proceso)) return null;

    return (
      <div className="card p-4">
        <h3 className="text-base font-bold text-numa-900 mb-1">Acta de no acuerdo</h3>
        <p className="text-sm text-numa-700 mb-3">
          Este proceso cerró sin acuerdo. El acta de no acuerdo es opcional: si la emites, funciona
          como cualquier otra acta (con número, facturación, comprobante de pago y acta firmada).
        </p>
        {error && (
          <div className="mb-3">
            <ErrorAlert message={error} />
          </div>
        )}
        {ok && (
          <div className="flex items-start gap-3 text-sm px-4 py-3 mb-3 rounded-sm bg-white border border-numa-200 text-numa-800">
            <CheckCircle2 className="w-5 h-5 text-green-600 shrink-0 mt-0.5" aria-hidden="true" />
            <span>{ok}</span>
          </div>
        )}
        {!confirmandoNA ? (
          <button
            type="button"
            onClick={() => {
              setConfirmandoNA(true);
              setError('');
            }}
            className="btn-secondary btn-sm"
          >
            <FileX className="w-4 h-4" /> Emitir acta de no acuerdo
          </button>
        ) : (
          <div className="p-3 border border-amber-300 bg-amber-50 rounded-sm text-sm text-amber-900">
            <p className="mb-2">
              Vas a emitir el acta de no acuerdo. Entra a tu fila de actas pendientes: hasta
              completarla (acta, comprobante de pago y acta firmada) no podrás subir las actas de
              tus otros procesos. Después de confirmar no se puede deshacer. ¿Confirmas?
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={pedirActaNA}
                disabled={pidiendoNA}
                className="btn-primary btn-sm disabled:opacity-50"
              >
                {pidiendoNA ? 'Guardando...' : 'Confirmar'}
              </button>
              <button
                type="button"
                onClick={() => setConfirmandoNA(false)}
                disabled={pidiendoNA}
                className="btn-ghost btn-sm"
              >
                Cancelar
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  const noAcuerdo = esNoAcuerdo(proceso);
  const saldo = saldoPago(proceso);

  const verComprobanteFinal = async () => {
    try {
      const blob = await descargarComprobanteFinal(proceso.id);
      window.open(window.URL.createObjectURL(blob), '_blank');
    } catch {
      setError('No se pudo abrir el comprobante del segundo pago');
    }
  };

  const verFirmada = async () => {
    try {
      const blob = await descargarActaFirmada(proceso.id);
      window.open(window.URL.createObjectURL(blob), '_blank');
    } catch {
      setError('No se pudo abrir el acta firmada');
    }
  };

  const descargarFirmada = async () => {
    try {
      const blob = await descargarActaFirmada(proceso.id);
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `acta_firmada_${proceso.codigo_proceso}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch {
      setError('No se pudo descargar el acta firmada');
    }
  };

  const pagosEf: any[] = Array.isArray(proceso.pagos_efectivo) ? proceso.pagos_efectivo : [];
  const soloEfectivo = !!proceso.efectivo_pendiente && !proceso.pago_pendiente;
  const nombreConcepto = (c: string) => (c === 'abono1' ? 'Primer abono' : c === 'saldo' ? 'Saldo' : 'Pago');

  const depositar = async (id: number) => {
    setDepositando(id);
    setError('');
    try {
      const r = await marcarEfectivoDepositado(id);
      setConfirmarDeposito(null);
      setOk(r?.mensaje || 'Depósito registrado.');
      onCambio();
    } catch (e: any) {
      setError(msg(e, 'No se pudo registrar el depósito'));
    } finally {
      setDepositando(null);
    }
  };

  const subir = async () => {
    // Con pago en abonos solo se sube el comprobante del saldo: el acta firmada ya viene en la documentación.
    if (!proceso.pago_pendiente && !archivoFirmada) return;
    if (proceso.pago_pendiente && formaSaldo === 'deposito' && !archivoSegundoPago) return;
    setSubiendo(true);
    setError('');
    try {
      await subirActaFirmada(
        proceso.id,
        proceso.pago_pendiente ? null : archivoFirmada,
        proceso.pago_pendiente
          ? {
              comprobante: formaSaldo === 'efectivo' ? null : archivoSegundoPago,
              fecha: fechaSegundoPago || undefined,
              forma: formaSaldo
            }
          : null
      );
      setShowFirmada(false);
      setArchivoFirmada(null);
      setArchivoSegundoPago(null);
      setConfirmoFirmada(false);
      setOk(proceso.pago_pendiente
        ? (formaSaldo === 'efectivo' ? 'Saldo en efectivo registrado. Falta marcar que ya lo depositaste para completar el proceso.' : 'Comprobante del saldo subido. El proceso quedó completo.')
        : 'Acta firmada subida. El proceso quedó completo.');
      setFormaSaldo('deposito');
      onCambio();
    } catch (e: any) {
      setError(msg(e, 'No se pudo subir el acta firmada'));
    } finally {
      setSubiendo(false);
    }
  };

  const abrirCorregir = async () => {
    setTextoNuevo(proceso.acuerdo_texto || '');
    setMotivoCorreccion('');
    setError('');
    setShowCorregir(true);
    try {
      setHistorial(await getHistorialAcuerdo(proceso.id));
    } catch {
      setHistorial([]);
    }
  };

  const guardarCorreccion = async () => {
    setGuardando(true);
    setError('');
    try {
      await corregirAcuerdo(proceso.id, textoNuevo, motivoCorreccion);
      setShowCorregir(false);
      setOk('Acuerdo corregido. El acta imprimible ya usa el texto nuevo.');
      onCambio();
    } catch (e: any) {
      setError(msg(e, 'No se pudo corregir el acuerdo'));
    } finally {
      setGuardando(false);
    }
  };

  const suspender = async () => {
    setGuardando(true);
    setError('');
    try {
      await suspenderProceso(proceso.id, motivoSuspension, modoBaja);
      setShowSuspender(false);
      setMotivoSuspension('');
      setOk(modoBaja ? 'Acta dada de baja. El mediador queda libre y el número vuelve a estar disponible 30 días.' : 'Proceso suspendido. El mediador ya no queda bloqueado por este proceso.');
      onCambio();
    } catch (e: any) {
      setError(msg(e, 'No se pudo suspender'));
    } finally {
      setGuardando(false);
    }
  };

  // Por ahora los mediadores hacen el acta a mano, con su propio formato.
  // El acta que genera el sistema queda escondida (la página
  // /procesos/[id]/acta-imprimir sigue existiendo por si se vuelve a usar).
  const MOSTRAR_BOTON_IMPRIMIR_ACTA = false;
  // El texto del acuerdo y su corrección ya no se usan: el acta se hace aparte, con su propio formato.
  const MOSTRAR_TEXTO_ACUERDO = false;
  const botonImprimir = (
    texto = 'Descargar o imprimir acta para firmar',
    ayuda = 'Genera el acta con los datos del sistema y espacios en blanco para firmar. Puedes imprimirla o guardarla como PDF.'
  ) => !MOSTRAR_BOTON_IMPRIMIR_ACTA ? null : (
    <button
      type="button"
      onClick={() => {
        marcarImpresa();
        window.open(`/procesos/${proceso.id}/acta-imprimir`, '_blank');
      }}
      title={ayuda}
      className="btn-secondary btn-sm"
    >
      <Printer className="w-3.5 h-3.5" /> {texto}
    </button>
  );

  return (
    <div className="space-y-4">
      {error && !showFirmada && !showCorregir && !showSuspender && <ErrorAlert message={error} />}
      {ok && (
        <div className="flex items-start gap-3 text-sm px-4 py-3 rounded-sm bg-white border border-numa-200 text-numa-800">
          <CheckCircle2 className="w-5 h-5 text-green-600 shrink-0 mt-0.5" aria-hidden="true" />
          <span>{ok}</span>
        </div>
      )}

      {/* Acuerdo registrado */}
      {MOSTRAR_TEXTO_ACUERDO && !noAcuerdo && proceso.acuerdo_texto && etapa !== 'completa' && (
        <div className="card p-4">
          <div className="flex items-center justify-between gap-3 mb-2 flex-wrap">
            <h3 className="text-base font-bold text-numa-900">Acuerdo</h3>
            {esAdmin && (
              <button type="button" onClick={abrirCorregir} className="btn-ghost btn-sm">
                <Pencil className="w-3 h-3" /> Corregir acuerdo
              </button>
            )}
          </div>
          <p className="text-sm text-numa-800 whitespace-pre-line">{proceso.acuerdo_texto}</p>
        </div>
      )}

      {/* Pago en abonos */}
      {proceso.pago_en_abonos && (
        <div
          className={`card p-4 ${
            proceso.pago_pendiente ? 'border-amber-200 bg-amber-50' : 'border-green-200 bg-green-50/50'
          }`}
        >
          <p className="text-base font-bold text-numa-900 mb-1">Pago en abonos</p>
          <p className="text-sm text-numa-800">
            Primer abono: <strong>{dinero(proceso.abono1_monto)}</strong> el {fechaDia(proceso.pago_fecha)}.
          </p>
          {proceso.pago_pendiente ? (
            <p className="text-sm text-amber-800 mt-1">
              Saldo pendiente: <strong>{dinero(saldo)}</strong> (valor total {dinero(proceso.monto_total)}).
              El proceso queda con pago incompleto: sube el comprobante del saldo cuando se complete el pago.
              {!esAdmin && ' Mientras tanto no podrás subir otras actas.'}
            </p>
          ) : (
            <>
              <p className="text-sm text-numa-800 mt-1">
                Saldo pagado: <strong>{dinero(saldo)}</strong> el {fechaDia(proceso.pago_final_fecha)}. Pago
                completo (valor total {dinero(proceso.monto_total)}).
              </p>
              <button type="button" onClick={verComprobanteFinal} className="btn-secondary btn-sm mt-2">
                <Eye className="w-3.5 h-3.5" /> Ver comprobante del segundo pago
              </button>
            </>
          )}
        </div>
      )}

      {/* Suspendido */}
      {/* El aviso de proceso suspendido (y el botón de reactivar) se muestra arriba de
          la pantalla del proceso, no aquí. */}

      {/* Efectivo recibido: falta depositarlo en la cuenta de NUMA */}
      {pagosEf.length > 0 && (
        <div className={`card p-4 ${proceso.efectivo_pendiente ? 'border-amber-200 bg-amber-50' : 'border-green-200 bg-green-50/50'}`}>
          <p className="text-base font-bold text-numa-900 mb-1">Pago en efectivo</p>
          {proceso.efectivo_pendiente && (
            <p className="text-sm text-amber-800 mb-2">
              Deposita el dinero en la cuenta de NUMA y luego marca «Efectivo ya depositado». El proceso no se completa hasta entonces.
              {!esAdmin && ' Mientras tanto no podrás subir otras actas.'}
            </p>
          )}
          <ul className="space-y-2">
            {pagosEf.map((pe: any) => (
              <li key={pe.id} className="flex flex-wrap items-center justify-between gap-2 text-sm text-numa-900">
                <span>
                  <strong>{nombreConcepto(pe.concepto)}</strong>
                  {pe.monto != null && <> · {dinero(Number(pe.monto))}</>}
                  {' '}· recibido el {fechaDia(pe.fecha_recibido)}
                </span>
                {pe.depositado ? (
                  <span className="text-green-700 font-semibold">Depositado el {fmt(pe.fecha_deposito)}</span>
                ) : confirmarDeposito === pe.id ? (
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="text-amber-900">¿Ya depositaste este dinero en la cuenta de NUMA?</span>
                    <button
                      type="button"
                      onClick={() => depositar(pe.id)}
                      disabled={depositando === pe.id}
                      className="btn-primary btn-sm disabled:opacity-50"
                    >
                      {depositando === pe.id ? 'Guardando...' : 'Sí, ya lo deposité'}
                    </button>
                    <button type="button" onClick={() => setConfirmarDeposito(null)} className="btn-secondary btn-sm">
                      No
                    </button>
                  </span>
                ) : (
                  <button type="button" onClick={() => setConfirmarDeposito(pe.id)} className="btn-primary btn-sm">
                    Efectivo ya depositado
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Falta el acta firmada */}
      {etapa === 'falta_firmada' && !soloEfectivo && (
        <div className="card p-4">
          <p className="text-sm text-numa-800 mb-1 font-semibold">
            {proceso.pago_pendiente ? 'Proceso incompleto: falta el comprobante del saldo' : 'Proceso incompleto: falta el acta firmada'}
          </p>
          <p className="text-sm text-numa-700 mb-3">
            {proceso.pago_pendiente
              ? 'La documentación con el acta firmada ya está subida. Falta el comprobante del segundo pago (el saldo) para completar el proceso.'
              : noAcuerdo
              ? 'Haz que firmen el acta el solicitante responsable y el mediador y súbela en PDF (no se aceptan fotos).'
              : 'Haz que firmen el acta las partes y el mediador y súbela en PDF (no se aceptan fotos).'}
            {/* El bloqueo solo aplica al mediador; el admin no lo tiene. */}
            {!esAdmin && ' Mientras falte, no podrás subir las actas de tus otros procesos.'}
          </p>
          <div className="flex flex-wrap gap-2">
            {botonImprimir()}
            <button
              type="button"
              disabled={!esAdmin && !yaImprimio}
              title={
                !esAdmin && !yaImprimio
                  ? 'Primero imprime el acta para firmar'
                  : 'Subir el acta ya firmada (PDF)'
              }
              onClick={() => {
                setShowFirmada(true);
                setArchivoFirmada(null);
                setArchivoSegundoPago(null);
                setFechaSegundoPago(hoyEcuador());
                setConfirmoFirmada(false);
                setError('');
              }}
              className="btn-primary btn-sm disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Upload className="w-4 h-4" /> {proceso.pago_pendiente ? 'Subir comprobante del saldo' : 'Subir acta firmada'}
            </button>
          </div>
          {!esAdmin && !yaImprimio && (
            <p className="text-xs text-numa-800 mt-2">
              Primero imprime el acta para firmar; luego se habilita &quot;Subir acta firmada&quot;.
            </p>
          )}
        </div>
      )}

      {/* Completa */}
      {etapa === 'completa' && !proceso.tiene_acta_firmada && (
        <div className="card p-4">
          <p className="flex items-center gap-2 text-sm text-numa-900 font-semibold mb-1">
            <CheckCircle2 className="w-5 h-5 text-green-600" aria-hidden="true" />
            {noAcuerdo ? 'Proceso completo: cerrado sin acuerdo' : 'Proceso completo: cerrado con acuerdo'}
          </p>
          <p className="text-sm text-numa-700">
            {proceso.tiene_acta_firmada
              ? 'El proceso terminó: solo se puede consultar el historial. Los documentos del acta están abajo.'
              : 'Proceso anterior a la regla del acta firmada.'}
          </p>
          <div className="flex flex-wrap items-center gap-2 mt-3 empty:hidden">
            {!proceso.tiene_acta_firmada && botonImprimir()}
          </div>
        </div>
      )}

      {/* La anulación (y la liberación del mediador) se hace desde «Anular este proceso». */}

      {/* Modal: subir acta firmada */}
      <Modal
        open={showFirmada}
        onClose={() => setShowFirmada(false)}
        title={`${proceso.pago_pendiente ? 'Subir comprobante del saldo' : 'Subir acta firmada'} — ${proceso.numero_acta_codigo || proceso.codigo_proceso}`}
      >
        {error && (
          <div className="mb-4">
            <ErrorAlert message={error} />
          </div>
        )}
        <div className="space-y-4">
          {!proceso.pago_pendiente && (
            <div>
              <label className="block text-sm font-medium text-numa-800 mb-1">Acta firmada (PDF)</label>
              <input
                type="file"
                accept="application/pdf"
                onChange={(e) => setArchivoFirmada(e.target.files?.[0] || null)}
                className="input-field"
              />
            </div>
          )}
          {proceso.pago_pendiente && (
            <div className="space-y-3 border border-amber-200 bg-amber-50 rounded-sm p-3">
              <p className="text-sm text-amber-800">
                Saldo pendiente: <strong>{dinero(saldo)}</strong>. Sube el comprobante del segundo
                pago para completar el proceso.
              </p>
              <div className="flex flex-col sm:flex-row gap-2">
                <label className="flex items-center gap-2 text-sm text-numa-800 border border-numa-200 rounded-sm px-3 py-2 cursor-pointer">
                  <input type="radio" name="forma-saldo" checked={formaSaldo === 'deposito'} onChange={() => setFormaSaldo('deposito')} />
                  Depósito o transferencia
                </label>
                <label className="flex items-center gap-2 text-sm text-numa-800 border border-numa-200 rounded-sm px-3 py-2 cursor-pointer">
                  <input type="radio" name="forma-saldo" checked={formaSaldo === 'efectivo'} onChange={() => { setFormaSaldo('efectivo'); setArchivoSegundoPago(null); }} />
                  Efectivo
                </label>
              </div>
              {formaSaldo === 'deposito' ? (
                <div>
                  <label className="block text-sm font-medium text-numa-800 mb-1">
                    Comprobante del segundo pago (PDF, JPG o PNG)
                  </label>
                  <input
                    type="file"
                    accept="application/pdf,image/jpeg,image/png"
                    onChange={(e) => setArchivoSegundoPago(e.target.files?.[0] || null)}
                    className="input-field"
                  />
                </div>
              ) : (
                <p className="text-sm text-amber-800">
                  Con efectivo no se sube comprobante: el proceso se completará cuando marques que ya depositaste el dinero.
                </p>
              )}
              <div>
                <label className="block text-sm font-medium text-numa-800 mb-1">
                  Fecha del segundo pago
                </label>
                <input
                  type="date"
                  value={fechaSegundoPago}
                  onChange={(e) => setFechaSegundoPago(e.target.value)}
                  className="input-field"
                />
              </div>
            </div>
          )}
          <label className="flex items-start gap-2 text-sm text-numa-800">
            <input
              type="checkbox"
              checked={confirmoFirmada}
              onChange={(e) => setConfirmoFirmada(e.target.checked)}
              className="mt-1"
            />
            {proceso.pago_pendiente
              ? 'Confirmo que este comprobante es real y legal. Entiendo que solo se puede subir una vez y no podré cambiarlo después.'
              : 'Confirmo que este documento es real y legal, avalado por el mediador. Entiendo que solo se puede subir una vez y no podré cambiarlo después.'}
          </label>
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={() => setShowFirmada(false)} className="btn-secondary">
              Cancelar
            </button>
            <button
              type="button"
              onClick={subir}
              disabled={
                subiendo || (!proceso.pago_pendiente && !archivoFirmada) || !confirmoFirmada ||
                (!!proceso.pago_pendiente && formaSaldo === 'deposito' && !archivoSegundoPago)
              }
              className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {subiendo ? 'Subiendo...' : proceso.pago_pendiente ? 'Subir comprobante' : 'Subir acta firmada'}
            </button>
          </div>
        </div>
      </Modal>

      {/* Modal: corregir acuerdo (admin) */}
      <Modal
        open={showCorregir}
        onClose={() => setShowCorregir(false)}
        title={`Corregir acuerdo — ${proceso.numero_acta_codigo || proceso.codigo_proceso}`}
        size="lg"
      >
        {error && (
          <div className="mb-4">
            <ErrorAlert message={error} />
          </div>
        )}
        <div className="space-y-4">
          <TextareaField
            label="Texto del acuerdo"
            rows={6}
            value={textoNuevo}
            onChange={(e) => setTextoNuevo(e.target.value)}
          />
          <TextareaField
            label="Motivo de la corrección (queda registrado)"
            rows={2}
            value={motivoCorreccion}
            onChange={(e) => setMotivoCorreccion(e.target.value)}
          />

          {historial && historial.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-numa-800 uppercase tracking-wide mb-2">
                Correcciones anteriores
              </p>
              <ul className="space-y-2 max-h-40 overflow-y-auto">
                {historial.map((h) => (
                  <li key={h.id} className="text-xs text-numa-700 border border-numa-200 rounded-sm p-2">
                    <span className="font-medium">{h.usuario}</span> · {fmt(h.fecha)} — {h.motivo}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={() => setShowCorregir(false)} className="btn-secondary">
              Cancelar
            </button>
            <button
              type="button"
              onClick={guardarCorreccion}
              disabled={guardando || !textoNuevo.trim() || motivoCorreccion.trim().length < 5}
              className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {guardando ? 'Guardando...' : 'Guardar corrección'}
            </button>
          </div>
        </div>
      </Modal>

    </div>
  );
}
