'use client';

import { useEffect, useRef, useState } from 'react';
import { Upload, Eye, FileText, RefreshCw } from 'lucide-react';
import { ErrorAlert } from '@/components/ui';
import {
  getFacturasProceso,
  subirFacturaProceso,
  verFacturaProceso
} from '@/lib/services';

type Tipo = 'cliente' | 'mediador';

const TARJETAS: { tipo: Tipo; titulo: string; ayuda: string }[] = [
  {
    tipo: 'cliente',
    titulo: 'Factura de NUMA al cliente',
    ayuda:
      'La factura que NUMA emite al cliente por esta acta. Una sola por acta, aunque el pago haya sido en abonos.'
  },
  {
    tipo: 'mediador',
    titulo: 'Tu factura a NUMA',
    ayuda:
      'La factura que tú emites a NUMA por esta acta.'
  }
];

// Las fechas vienen en UTC sin zona horaria: se muestran en hora de Ecuador.
const fechaEC = (v: any) => {
  if (!v) return '—';
  const iso = String(v).replace(' ', 'T');
  const d = new Date(/(Z|[+-]\d\d:?\d\d)$/.test(iso) ? iso : `${iso}Z`);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleString('es-EC', {
    timeZone: 'America/Guayaquil',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
};

interface Props {
  proceso: any;
  esAdmin: boolean;
  // Avisa a la pantalla para que refresque la marca "Faltan facturas".
  onCambio?: () => void;
}

export default function FacturasProceso({ proceso, esAdmin, onCambio }: Props) {
  const [facturas, setFacturas] = useState<any[]>([]);
  const [cargando, setCargando] = useState(true);
  const [subiendo, setSubiendo] = useState<Tipo | null>(null);
  const [error, setError] = useState('');
  const inputs = useRef<Record<string, HTMLInputElement | null>>({});

  const visible = !!proceso?.requiere_facturas && !!proceso?.tiene_acta_firmada;

  const cargar = async () => {
    try {
      const r = await getFacturasProceso(proceso.id);
      setFacturas(r.facturas || []);
    } catch {
      setError('No se pudieron cargar las facturas');
    } finally {
      setCargando(false);
    }
  };

  useEffect(() => {
    if (visible) cargar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [proceso?.id, visible]);

  if (!visible) return null;

  const elegirArchivo = async (tipo: Tipo, e: React.ChangeEvent<HTMLInputElement>) => {
    const archivo = e.target.files?.[0];
    e.target.value = '';
    if (!archivo) return;
    if (archivo.type !== 'application/pdf') {
      setError('La factura se sube solo en PDF');
      return;
    }
    setError('');
    setSubiendo(tipo);
    try {
      const r = await subirFacturaProceso(proceso.id, tipo, archivo);
      setFacturas(r.facturas || []);
      onCambio?.();
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'No se pudo subir la factura');
    } finally {
      setSubiendo(null);
    }
  };

  const ver = async (facturaId: number) => {
    try {
      const blob = await verFacturaProceso(proceso.id, facturaId);
      window.open(window.URL.createObjectURL(blob), '_blank');
    } catch {
      setError('No se pudo abrir la factura');
    }
  };

  const faltan = TARJETAS.filter((t) => !facturas.some((f) => f.tipo === t.tipo && f.vigente));

  return (
    <div className="card p-4">
      <div className="flex flex-wrap items-center gap-2 mb-1">
        <FileText className="w-4 h-4 text-numa-700" />
        <h2 className="text-sm font-semibold text-numa-800">Facturas del acta</h2>
        {!cargando && faltan.length > 0 && (
          <span className="pill bg-amber-50 text-amber-800">
            <span className="pill-dot bg-amber-500" aria-hidden="true" />
            Faltan facturas
          </span>
        )}
      </div>
      <p className="text-xs text-numa-700 mb-3">
        Se suben en PDF después del acta firmada. Son obligatorias para el expediente, pero no
        bloquean nada del proceso. Si te equivocas puedes reemplazarlas.
      </p>

      {error && (
        <div className="mb-3">
          <ErrorAlert message={error} />
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {TARJETAS.map((t) => {
          const lista = facturas.filter((f) => f.tipo === t.tipo);
          const vigente = lista.find((f) => f.vigente);
                    return (
            <div key={t.tipo} className="border border-numa-100 rounded-sm p-3 bg-white">
              <p className="text-sm font-semibold text-numa-800">{t.titulo}</p>
              <p className="text-xs text-numa-600 mb-2">{t.ayuda}</p>

              {cargando ? null : vigente ? (
                <p className="text-xs text-green-700 mb-2">
                  Subida el {fechaEC(vigente.fecha_subida)}
                  {vigente.subida_por ? ` por ${vigente.subida_por}` : ''}.
                </p>
              ) : (
                <p className="text-xs text-amber-700 mb-2">Todavía no se ha subido.</p>
              )}

              <div className="flex flex-wrap items-center gap-2">
                {vigente && (
                  <button
                    type="button"
                    onClick={() => ver(vigente.id)}
                    className="btn-secondary btn-sm"
                  >
                    <Eye className="w-3.5 h-3.5" /> Ver
                  </button>
                )}
                <button
                  type="button"
                  disabled={subiendo !== null}
                  onClick={() => inputs.current[t.tipo]?.click()}
                  className={`${vigente ? 'btn-secondary' : 'btn-primary'} btn-sm disabled:opacity-50`}
                >
                  {vigente ? <RefreshCw className="w-3.5 h-3.5" /> : <Upload className="w-3.5 h-3.5" />}
                  {subiendo === t.tipo ? 'Subiendo...' : vigente ? 'Reemplazar' : 'Subir PDF'}
                </button>
                <input
                  ref={(el) => {
                    inputs.current[t.tipo] = el;
                  }}
                  type="file"
                  accept="application/pdf"
                  className="hidden"
                  onChange={(e) => elegirArchivo(t.tipo, e)}
                />
              </div>

            </div>
          );
        })}
      </div>
      {esAdmin && (
        <p className="text-[11px] text-numa-600 mt-2">
          Como administrador puedes ver y reemplazar ambas facturas.
        </p>
      )}
    </div>
  );
}
