'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft, Eye } from 'lucide-react';
import { PageHeader, Spinner, EmptyState, Badge, Pill, ErrorAlert } from '@/components/ui';
import {
  getFichaCliente,
  getFacturasPagos,
  verFacturaProceso,
  descargarComprobantePagoActaFinal,
  descargarComprobanteFinal,
} from '@/lib/services';
import { estadoLabelProceso, estadoPill } from '@/lib/estados';

const TABS = [
  { id: 'datos', label: 'Datos' },
  { id: 'procesos', label: 'Procesos' },
  { id: 'invitaciones', label: 'Invitaciones' },
  { id: 'facturas', label: 'Facturas y pagos' },
] as const;

function fecha(v?: string | null) {
  if (!v) return '—';
  const d = /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T12:00:00`) : new Date(v);
  return d.toLocaleDateString('es-EC', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'America/Guayaquil' });
}

function dinero(v: any) {
  const n = Number(v);
  return Number.isFinite(n) ? `$${n.toLocaleString('es-EC', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—';
}

function Dato({ label, valor }: { label: string; valor?: string | null }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-[#6B7C99]">{label}</p>
      <p className="mt-0.5 text-sm font-medium text-[#0A2A62] break-words">{valor || '—'}</p>
    </div>
  );
}

export default function FichaClientePage() {
  const { id } = useParams();
  const [ficha, setFicha] = useState<any>(null);
  const [pagos, setPagos] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<(typeof TABS)[number]['id']>('datos');

  useEffect(() => {
    setLoading(true);
    Promise.all([getFichaCliente(id as string), getFacturasPagos({ cliente_id: id as string })])
      .then(([f, p]) => {
        setFicha(f);
        setPagos(p);
      })
      .catch((e) => setError(e?.response?.data?.detail || 'No se pudo cargar la ficha del cliente'))
      .finally(() => setLoading(false));
  }, [id]);

  const abrir = async (f: any) => {
    try {
      const blob =
        f.tipo === 'pago_acta'
          ? await descargarComprobantePagoActaFinal(f.acta_id)
          : f.tipo === 'pago_final'
          ? await descargarComprobanteFinal(f.proceso_id)
          : await verFacturaProceso(f.proceso_id, f.archivo_id);
      window.open(window.URL.createObjectURL(blob), '_blank');
    } catch {
      setError('No se pudo abrir el archivo');
    }
  };

  if (loading) return <Spinner />;

  if (!ficha) {
    return (
      <>
        <Link href="/clientes" className="mb-3 inline-flex items-center gap-1 text-sm font-semibold text-[#144193] hover:underline">
          <ArrowLeft size={14} /> Volver a clientes
        </Link>
        <ErrorAlert message={error || 'Cliente no encontrado'} />
      </>
    );
  }

  const c = ficha.cliente;
  const esEmpresa = c.tipo === 'empresa';
  const nombre = esEmpresa ? c.razon_social || c.nombre : `${c.nombre} ${c.apellido || ''}`.trim();
  const conteo: Record<string, number> = {
    procesos: ficha.procesos.length,
    invitaciones: ficha.citas.length,
    facturas: pagos.length,
  };

  return (
    <>
      <Link href="/clientes" className="mb-3 inline-flex items-center gap-1 text-sm font-semibold text-[#144193] hover:underline">
        <ArrowLeft size={14} /> Volver a clientes
      </Link>

      <PageHeader
        title={nombre}
        subtitle={esEmpresa ? `Empresa · RUC ${c.ruc || '—'}` : `Persona · Cédula ${c.cedula || '—'}`}
      />

      {error && (
        <div className="mb-4">
          <ErrorAlert message={error} />
        </div>
      )}

      <div className="mb-4 flex flex-wrap gap-1 border-b border-[#CBD6E8]">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={
              tab === t.id
                ? '-mb-px rounded-t-lg border border-b-white border-[#CBD6E8] bg-white px-4 py-2 text-sm font-semibold text-[#144193]'
                : 'rounded-t-lg px-4 py-2 text-sm font-medium text-[#6B7C99] hover:text-[#144193]'
            }
          >
            {t.label}
            {conteo[t.id] !== undefined && (
              <span className="ml-1.5 rounded-full bg-[#F4F7FC] px-1.5 py-0.5 text-[11px] font-semibold text-[#144193]">
                {conteo[t.id]}
              </span>
            )}
          </button>
        ))}
      </div>

      {tab === 'datos' && (
        <div className="grid gap-4 rounded-xl border border-[#CBD6E8] bg-white p-5 sm:grid-cols-2 lg:grid-cols-3">
          {esEmpresa ? (
            <>
              <Dato label="Razón social" valor={c.razon_social || c.nombre} />
              <Dato label="RUC" valor={c.ruc} />
              <Dato label="Representante" valor={c.representante_nombre} />
              <Dato label="Cédula del representante" valor={c.representante_cedula} />
            </>
          ) : (
            <>
              <Dato label="Nombres" valor={c.nombre} />
              <Dato label="Apellidos" valor={c.apellido} />
              <Dato label="Cédula" valor={c.cedula} />
            </>
          )}
          <Dato label="Correo" valor={c.email} />
          <Dato label="Teléfono" valor={c.telefono} />
          <Dato label="Ciudad" valor={[c.ciudad, c.provincia].filter(Boolean).join(', ')} />
          <div className="sm:col-span-2 lg:col-span-3">
            <Dato label="Dirección" valor={c.direccion} />
          </div>
          <Dato label="Registrado el" valor={fecha(c.fecha_creacion)} />
        </div>
      )}

      {tab === 'procesos' &&
        (ficha.procesos.length === 0 ? (
          <EmptyState icon="📁" message="Este cliente no tiene procesos." />
        ) : (
          <div className="space-y-2">
            {ficha.procesos.map((p: any) => (
              <Link
                key={p.id}
                href={`/procesos/${p.id}`}
                className="block rounded-xl border border-[#CBD6E8] bg-white px-4 py-3 transition-colors hover:bg-[#F4F7FC]"
              >
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="font-bold text-[#0A2A62]">{p.codigo_proceso}</span>
                  {p.numero_acta && (
                    <span className="rounded-full bg-[#144193] px-2.5 py-0.5 text-xs font-semibold text-white">
                      Acta {p.numero_acta}
                    </span>
                  )}
                  <Pill
                    label={p.suspendido ? 'Suspendido' : estadoLabelProceso(p.estado)}
                    {...estadoPill(p.estado)}
                  />
                  <span className="rounded-full border border-[#CBD6E8] px-2 py-0.5 text-xs text-[#4A5B78]">{p.rol}</span>
                  <span className="text-xs text-[#6B7C99] sm:ml-auto">{fecha(p.fecha_creacion)}</span>
                </div>
                <p className="mt-1 text-sm text-[#4A5B78] truncate">{p.tema || 'Sin tema'}</p>
                <p className="mt-0.5 text-xs text-[#6B7C99]">Mediador: {p.mediador} · {p.sucursal}</p>
              </Link>
            ))}
          </div>
        ))}

      {tab === 'invitaciones' &&
        (ficha.citas.length === 0 ? (
          <EmptyState icon="✉️" message="Este cliente no tiene citas ni invitaciones." />
        ) : (
          <ul className="divide-y divide-[#E3EAF5] overflow-hidden rounded-xl border border-[#CBD6E8] bg-white">
            {ficha.citas.map((ct: any) => (
              <li key={ct.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-sm">
                <span className="w-28 font-semibold text-[#0A2A62]">{fecha(ct.fecha)}</span>
                <span className="w-14 text-[#4A5B78]">{String(ct.hora || '').slice(0, 5)}</span>
                <span className="min-w-0 flex-1 truncate text-[#4A5B78]">{ct.tema || 'Sin tema'}</span>
                {ct.codigo_proceso && (
                  <Link href={`/procesos/${ct.proceso_id}`} className="font-semibold text-[#144193] hover:underline">
                    {ct.codigo_proceso}
                  </Link>
                )}
                <span className="rounded-full border border-[#CBD6E8] px-2 py-0.5 text-xs text-[#4A5B78]">{ct.rol}</span>
                <Badge label={String(ct.estado || '').replace(/_/g, ' ')} />
                {ct.tiene_invitacion && <span className="text-xs text-[#6B7C99]">Con invitación</span>}
              </li>
            ))}
          </ul>
        ))}

      {tab === 'facturas' &&
        (pagos.length === 0 ? (
          <EmptyState icon="🧾" message="Aún no hay facturas ni comprobantes de este cliente." />
        ) : (
          <ul className="divide-y divide-[#E3EAF5] overflow-hidden rounded-xl border border-[#CBD6E8] bg-white">
            {pagos.map((f) => (
              <li key={f.clave} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5 text-sm">
                <Link href={`/procesos/${f.proceso_id}`} className="w-28 font-semibold text-[#144193] hover:underline">
                  {f.codigo_proceso}
                </Link>
                <span className="w-56 shrink-0">
                  <Badge label={f.tipo_etiqueta} variant={f.tipo.startsWith('factura') ? 'enviado' : 'aprobado'} />
                </span>
                <span className="min-w-0 flex-1 truncate text-[#4A5B78]">{f.nombre || '—'}</span>
                {f.monto != null && <span className="font-semibold text-[#0A2A62]">{dinero(f.monto)}</span>}
                <span className="text-xs text-[#6B7C99]">{fecha(f.fecha)}</span>
                <button
                  type="button"
                  onClick={() => abrir(f)}
                  className="inline-flex items-center gap-1 rounded-lg border border-[#CBD6E8] px-2.5 py-1.5 text-xs font-semibold text-[#144193] hover:bg-[#F4F7FC]"
                >
                  <Eye size={14} /> Abrir
                </button>
              </li>
            ))}
          </ul>
        ))}
    </>
  );
}
