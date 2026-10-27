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
  descargarPdfActaFinal,
  descargarActaFirmada,
} from '@/lib/services';
import { estadoLabelProceso, estadoPill } from '@/lib/estados';

const TABS = [
  { id: 'datos', label: 'Datos' },
  { id: 'procesos', label: 'Procesos' },
  { id: 'actas', label: 'Actas' },
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

  const abrirActa = async (a: any, firmada: boolean) => {
    try {
      const blob = firmada ? await descargarActaFirmada(a.proceso_id) : await descargarPdfActaFinal(a.id);
      window.open(window.URL.createObjectURL(blob), '_blank');
    } catch {
      setError('No se pudo abrir el acta');
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
    actas: (ficha.actas || []).length,
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
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                  <span className="text-sm text-[#6B7C99]">
                    Proceso <span className="font-bold text-[#0A2A62]">{p.codigo_proceso}</span>
                  </span>
                  <span className="text-sm text-[#6B7C99]">
                    N.º de acta{' '}
                    {p.numero_acta ? (
                      <span className="rounded-full bg-[#144193] px-2.5 py-0.5 text-xs font-semibold text-white">{p.numero_acta}</span>
                    ) : (
                      <span className="font-medium text-[#6B7C99]">aún sin acta</span>
                    )}
                  </span>
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

      {tab === 'actas' &&
        ((ficha.actas || []).length === 0 ? (
          <EmptyState icon="📄" message="Este cliente no tiene actas finales." />
        ) : (
          <div className="overflow-x-auto rounded-xl border border-[#CBD6E8] bg-white">
            <table className="w-full text-sm">
              <thead className="bg-[#F4F7FC] text-left text-xs uppercase tracking-wide text-[#144193]">
                <tr>
                  <th className="px-4 py-3">N.º de acta</th>
                  <th className="px-4 py-3">Resultado</th>
                  <th className="px-4 py-3">Proceso</th>
                  <th className="px-4 py-3">Su papel</th>
                  <th className="px-4 py-3">Mediador</th>
                  <th className="px-4 py-3">Fecha</th>
                  <th className="px-4 py-3 text-right">Documentos</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E3EAF5]">
                {ficha.actas.map((a: any) => (
                  <tr key={a.id}>
                    <td className="px-4 py-3 font-bold text-[#0A2A62]">{a.codigo_acta}</td>
                    <td className="px-4 py-3">
                      <Badge
                        label={a.tipo === 'no_acuerdo' ? 'No acuerdo' : 'Acuerdo'}
                        variant={a.tipo === 'no_acuerdo' ? 'rechazado' : 'aprobado'}
                      />
                    </td>
                    <td className="px-4 py-3">
                      <Link href={`/procesos/${a.proceso_id}`} className="font-semibold text-[#144193] hover:underline">
                        {a.codigo_proceso}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-[#4A5B78]">{a.rol}</td>
                    <td className="px-4 py-3 text-[#4A5B78]">{a.mediador}</td>
                    <td className="px-4 py-3 whitespace-nowrap text-[#4A5B78]">{fecha(a.fecha_subida)}</td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => abrirActa(a, false)}
                        className="inline-flex items-center gap-1 rounded-lg border border-[#CBD6E8] px-2.5 py-1.5 text-xs font-semibold text-[#144193] hover:bg-[#F4F7FC]"
                      >
                        <Eye size={14} /> Acta
                      </button>
                      {a.tiene_firmada && (
                        <button
                          type="button"
                          onClick={() => abrirActa(a, true)}
                          className="ml-2 inline-flex items-center gap-1 rounded-lg border border-[#CBD6E8] px-2.5 py-1.5 text-xs font-semibold text-[#144193] hover:bg-[#F4F7FC]"
                        >
                          <Eye size={14} /> Firmada
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}

      {tab === 'invitaciones' &&
        (ficha.citas.length === 0 ? (
          <EmptyState icon="✉️" message="Este cliente no tiene citas ni invitaciones." />
        ) : (
          <div className="overflow-x-auto rounded-xl border border-[#CBD6E8] bg-white">
            <table className="w-full text-sm">
              <thead className="bg-[#F4F7FC] text-left text-xs uppercase tracking-wide text-[#144193]">
                <tr>
                  <th className="px-4 py-3">Fecha</th>
                  <th className="px-4 py-3">Hora</th>
                  <th className="px-4 py-3">Proceso</th>
                  <th className="px-4 py-3">N.º de acta</th>
                  <th className="px-4 py-3">Tema</th>
                  <th className="px-4 py-3">Su papel</th>
                  <th className="px-4 py-3">Estado de la cita</th>
                  <th className="px-4 py-3">Invitación</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E3EAF5]">
                {ficha.citas.map((ct: any) => (
                  <tr key={ct.id}>
                    <td className="px-4 py-3 whitespace-nowrap font-semibold text-[#0A2A62]">{fecha(ct.fecha)}</td>
                    <td className="px-4 py-3 text-[#4A5B78]">{String(ct.hora || '').slice(0, 5)}</td>
                    <td className="px-4 py-3">
                      {ct.codigo_proceso ? (
                        <Link href={`/procesos/${ct.proceso_id}`} className="font-semibold text-[#144193] hover:underline">
                          {ct.codigo_proceso}
                        </Link>
                      ) : '—'}
                    </td>
                    <td className="px-4 py-3 text-[#0A2A62] font-medium">{ct.numero_acta || '—'}</td>
                    <td className="px-4 py-3 max-w-[240px] truncate text-[#4A5B78]">{ct.tema || 'Sin tema'}</td>
                    <td className="px-4 py-3 text-[#4A5B78]">{ct.rol}</td>
                    <td className="px-4 py-3"><Badge label={String(ct.estado || '').replace(/_/g, ' ')} /></td>
                    <td className="px-4 py-3 text-[#4A5B78]">{ct.tiene_invitacion ? 'Con invitación' : 'Sin invitación'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}

      {tab === 'facturas' &&
        (pagos.length === 0 ? (
          <EmptyState icon="🧾" message="Aún no hay facturas ni comprobantes de este cliente." />
        ) : (
          <div className="overflow-x-auto rounded-xl border border-[#CBD6E8] bg-white">
            <table className="w-full text-sm">
              <thead className="bg-[#F4F7FC] text-left text-xs uppercase tracking-wide text-[#144193]">
                <tr>
                  <th className="px-4 py-3">Proceso</th>
                  <th className="px-4 py-3">Tipo</th>
                  <th className="px-4 py-3">Archivo</th>
                  <th className="px-4 py-3 text-right">Monto</th>
                  <th className="px-4 py-3">Fecha</th>
                  <th className="px-4 py-3 text-right">Ver</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E3EAF5]">
                {pagos.map((f) => (
                  <tr key={f.clave}>
                    <td className="px-4 py-3">
                      <Link href={`/procesos/${f.proceso_id}`} className="font-semibold text-[#144193] hover:underline">
                        {f.codigo_proceso}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <Badge label={f.tipo_etiqueta} variant={f.tipo.startsWith('factura') ? 'enviado' : 'aprobado'} />
                    </td>
                    <td className="px-4 py-3 max-w-[260px] truncate text-[#4A5B78]" title={f.nombre || ''}>{f.nombre || '—'}</td>
                    <td className="px-4 py-3 text-right font-semibold text-[#0A2A62]">{f.monto != null ? dinero(f.monto) : '—'}</td>
                    <td className="px-4 py-3 whitespace-nowrap text-[#4A5B78]">{fecha(f.fecha)}</td>
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => abrir(f)}
                        className="inline-flex items-center gap-1 rounded-lg border border-[#CBD6E8] px-2.5 py-1.5 text-xs font-semibold text-[#144193] hover:bg-[#F4F7FC]"
                      >
                        <Eye size={14} /> Abrir
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
    </>
  );
}
