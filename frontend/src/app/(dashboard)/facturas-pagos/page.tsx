'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Eye, FileSpreadsheet, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { PageHeader, Spinner, EmptyState, Badge, InputField, SelectField, ErrorAlert } from '@/components/ui';
import {
  getFacturasPagos,
  getFacturasPagosFaltantes,
  descargarFacturasPagosExcel,
  verFacturaProceso,
  descargarComprobantePagoActaFinal,
  descargarComprobanteFinal,
  getUsuarios,
} from '@/lib/services';
import { getSucursalesCached } from '@/lib/catalogCache';

const TIPOS = [
  { value: 'factura_cliente', label: 'Factura de NUMA al cliente' },
  { value: 'factura_mediador', label: 'Factura del mediador a NUMA' },
  { value: 'pago_acta', label: 'Comprobante de pago' },
  { value: 'pago_final', label: 'Comprobante del segundo pago' },
];

const VACIO = { q: '', tipo: '', sucursal_id: '', usuario_id: '', fecha_desde: '', fecha_hasta: '' };

function formatearFecha(v?: string | null) {
  if (!v) return '—';
  return new Date(v).toLocaleDateString('es-EC', {
    day: '2-digit', month: 'short', year: 'numeric', timeZone: 'America/Guayaquil',
  });
}

function dinero(v: any) {
  const n = Number(v);
  return Number.isFinite(n) ? `$${n.toLocaleString('es-EC', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—';
}

function limpiar(f: typeof VACIO) {
  return {
    q: f.q || undefined,
    tipo: f.tipo || undefined,
    sucursal_id: f.sucursal_id || undefined,
    usuario_id: f.usuario_id || undefined,
    fecha_desde: f.fecha_desde || undefined,
    fecha_hasta: f.fecha_hasta || undefined,
  };
}

export default function FacturasPagosPage() {
  const { isAdmin } = useAuth();
  const [filas, setFilas] = useState<any[]>([]);
  // Lo que falta por subir (facturas y comprobantes), en una pestaña aparte.
  const [faltantes, setFaltantes] = useState<any[]>([]);
  const [vista, setVista] = useState<'subidos' | 'faltan'>('subidos');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [exportando, setExportando] = useState(false);
  const [filters, setFilters] = useState(VACIO);
  const [sucursales, setSucursales] = useState<any[]>([]);
  const [mediadores, setMediadores] = useState<any[]>([]);

  const cargar = async (f = filters) => {
    setLoading(true);
    try {
      const [subidos, faltan] = await Promise.all([
        getFacturasPagos(limpiar(f)),
        getFacturasPagosFaltantes({
          q: f.q || undefined,
          sucursal_id: f.sucursal_id || undefined,
          usuario_id: f.usuario_id || undefined,
        }).catch(() => [] as any[]),
      ]);
      setFilas(subidos);
      setFaltantes(faltan);
    } catch {
      setFilas([]);
      setError('No se pudo cargar la lista');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    cargar();
  }, []);

  useEffect(() => {
    if (!isAdmin) return;
    getSucursalesCached().then(setSucursales).catch(() => setSucursales([]));
    getUsuarios()
      .then((u) => setMediadores(u.filter((x: any) => x.rol === 'mediador' || x.rol === 'administrador')))
      .catch(() => setMediadores([]));
  }, [isAdmin]);

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
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const exportar = async () => {
    setExportando(true);
    try {
      const blob = await descargarFacturasPagosExcel(limpiar(filters));
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'facturas_y_pagos_numa.xlsx';
      a.click();
      window.URL.revokeObjectURL(url);
    } catch {
      setError('No se pudo exportar a Excel');
    } finally {
      setExportando(false);
    }
  };

  const limpiarFiltros = () => {
    setFilters(VACIO);
    cargar(VACIO);
  };

  // Un cuadro por proceso, con sus documentos adentro (el orden sale del más reciente).
  const grupos: any[] = [];
  const porProceso = new Map<number, any>();
  filas.forEach((f) => {
    let g = porProceso.get(f.proceso_id);
    if (!g) {
      g = { ...f, items: [] };
      porProceso.set(f.proceso_id, g);
      grupos.push(g);
    }
    g.items.push(f);
  });
  // Montos en orden: primer abono, segundo abono (si hay) y monto final.
  const ORDEN: Record<string, number> = { pago_acta: 0, pago_final: 1, factura_cliente: 2, factura_mediador: 3 };
  grupos.forEach((g) => {
    g.items.sort((a: any, b: any) => (ORDEN[a.tipo] ?? 9) - (ORDEN[b.tipo] ?? 9));
    const segundo = g.items.find((i: any) => i.tipo === 'pago_final' && i.monto != null);
    g.chips = [
      g.pago_en_abonos && g.abono1_monto != null ? { label: '1.er abono', valor: g.abono1_monto } : null,
      segundo ? { label: '2.º abono', valor: segundo.monto } : null,
      g.monto_total != null ? { label: 'Monto final', valor: g.monto_total, final: true } : null,
    ].filter(Boolean);
  });

  return (
    <>
      <PageHeader
        title="Facturas y pagos"
        subtitle="Todas las facturas y comprobantes de pago subidos en los procesos, en un solo lugar"
      />

      {error && (
        <div className="mb-4">
          <ErrorAlert message={error} />
        </div>
      )}

      {/* Dos vistas: lo que ya se subió y lo que todavía falta. */}
      <div role="tablist" className="mb-4 inline-flex rounded-xl border border-[#CBD6E8] bg-white p-1 shadow-sm">
        <button
          type="button"
          role="tab"
          aria-selected={vista === 'subidos'}
          onClick={() => setVista('subidos')}
          className={`rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${
            vista === 'subidos' ? 'bg-[#144193] text-white' : 'text-[#144193] hover:bg-[#F4F7FC]'
          }`}
        >
          Subidos <span className="opacity-80">({filas.length})</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={vista === 'faltan'}
          onClick={() => setVista('faltan')}
          className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${
            vista === 'faltan' ? 'bg-red-700 text-white' : 'text-red-800 hover:bg-red-50'
          }`}
        >
          <AlertTriangle size={15} aria-hidden="true" />
          Faltan <span className="opacity-90">({faltantes.length})</span>
        </button>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          cargar();
        }}
        className="mb-4 rounded-xl border border-[#CBD6E8] bg-[#F4F7FC] p-3"
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-2">
          <div className="xl:col-span-2">
            <InputField
              label="Buscar"
              value={filters.q}
              onChange={(e) => setFilters({ ...filters, q: e.target.value })}
              placeholder="Proceso, N.º de acta, parte, mediador o archivo..."
            />
          </div>
          {vista === 'subidos' && (
          <SelectField
            label="Tipo"
            value={filters.tipo}
            onChange={(e) => setFilters({ ...filters, tipo: e.target.value })}
          >
            <option value="">Todos</option>
            {TIPOS.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </SelectField>
          )}
          {isAdmin && (
            <SelectField
              label="Sucursal"
              value={filters.sucursal_id}
              onChange={(e) => setFilters({ ...filters, sucursal_id: e.target.value })}
            >
              <option value="">Todas</option>
              {sucursales.map((s) => (
                <option key={s.id} value={s.id}>{s.nombre}</option>
              ))}
            </SelectField>
          )}
          {isAdmin && (
            <SelectField
              label="Mediador"
              value={filters.usuario_id}
              onChange={(e) => setFilters({ ...filters, usuario_id: e.target.value })}
            >
              <option value="">Todos</option>
              {mediadores.map((u) => (
                <option key={u.id} value={u.id}>{u.nombre} {u.apellido}</option>
              ))}
            </SelectField>
          )}
          {vista === 'subidos' && (
            <>
              <InputField
                label="Desde"
                type="date"
                value={filters.fecha_desde}
                onChange={(e) => setFilters({ ...filters, fecha_desde: e.target.value })}
              />
              <InputField
                label="Hasta"
                type="date"
                value={filters.fecha_hasta}
                onChange={(e) => setFilters({ ...filters, fecha_hasta: e.target.value })}
              />
            </>
          )}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="submit"
            className="rounded-lg bg-[#144193] px-4 py-2 text-sm font-semibold text-white hover:bg-[#0A2A62] transition-colors"
          >
            Filtrar
          </button>
          <button
            type="button"
            onClick={limpiarFiltros}
            className="rounded-lg border border-[#CBD6E8] bg-white px-4 py-2 text-sm font-semibold text-[#144193] hover:bg-[#F4F7FC] transition-colors"
          >
            Limpiar
          </button>
          {vista === 'subidos' && (
          <button
            type="button"
            onClick={exportar}
            disabled={exportando || filas.length === 0}
            className="ml-auto inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50 transition-colors"
          >
            <FileSpreadsheet size={16} />
            {exportando ? 'Exportando...' : 'Exportar Excel'}
          </button>
          )}
        </div>
      </form>

      {loading ? (
        <Spinner />
      ) : vista === 'faltan' ? (
        faltantes.length === 0 ? (
          <div className="flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-4 text-sm font-semibold text-emerald-900">
            <CheckCircle2 size={20} aria-hidden="true" />
            No falta ninguna factura ni comprobante con estos filtros.
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-[#4A5B78]">
              Procesos a los que todavía les falta algún documento. Las facturas se esperan una vez
              subida el acta firmada. Entra al proceso para subir lo que falta.
            </p>
            {faltantes.map((g) => (
              <section
                key={g.proceso_id}
                className="rounded-xl border border-red-200 bg-white px-4 py-3 shadow-[0_8px_20px_-18px_rgba(127,29,29,0.7)]"
              >
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <Link href={`/procesos/${g.proceso_id}`} className="text-base font-bold text-[#0A2A62] hover:underline">
                    {g.codigo_proceso}
                  </Link>
                  {g.numero_acta && (
                    <span className="rounded-full bg-[#144193] px-2.5 py-0.5 text-xs font-semibold text-white">
                      Acta {g.numero_acta}
                    </span>
                  )}
                  {g.dias_desde_acta_firmada != null && (
                    <span className="text-xs font-semibold text-red-800">
                      {g.dias_desde_acta_firmada === 0
                        ? 'Acta firmada hoy'
                        : `${g.dias_desde_acta_firmada} día${g.dias_desde_acta_firmada === 1 ? '' : 's'} desde el acta firmada`}
                    </span>
                  )}
                  <span className="text-xs text-[#4A5B78] sm:ml-auto">
                    {g.sucursal}{g.ciudad ? ` · ${g.ciudad}` : ''}
                  </span>
                </div>
                <div className="mt-2 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-3">
                  <p><span className="text-[#6B7C99]">Solicitante: </span><span className="font-medium text-[#0A2A62]">{g.demandante || '—'}</span></p>
                  <p><span className="text-[#6B7C99]">Invitado: </span><span className="font-medium text-[#0A2A62]">{g.demandado || '—'}</span></p>
                  <p><span className="text-[#6B7C99]">Mediador: </span><span className="font-medium text-[#0A2A62]">{g.mediador}</span></p>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {(g.faltan || []).map((t: string) => (
                    <span
                      key={t}
                      className="inline-flex items-center gap-1.5 rounded-md bg-red-50 px-2.5 py-1 text-xs font-semibold text-red-800 ring-1 ring-red-200"
                    >
                      <AlertTriangle size={13} aria-hidden="true" />
                      Falta: {t}
                    </span>
                  ))}
                  <Link
                    href={`/procesos/${g.proceso_id}`}
                    className="ml-auto inline-flex items-center gap-1 rounded-lg border border-[#CBD6E8] px-2.5 py-1.5 text-xs font-semibold text-[#144193] hover:bg-[#F4F7FC]"
                  >
                    <Eye size={14} /> Ir al proceso
                  </Link>
                </div>
              </section>
            ))}
          </div>
        )
      ) : filas.length === 0 ? (
        <EmptyState
          icon="🧾"
          message="Aún no hay facturas ni comprobantes con estos filtros. Aparecerán aquí cuando se suban dentro de los procesos."
        />
      ) : (
        <div className="space-y-4">
          {grupos.map((g) => (
            <section
              key={g.proceso_id}
              className="overflow-hidden rounded-xl border border-[#CBD6E8] bg-white shadow-[0_8px_20px_-18px_rgba(11,39,89,0.7)]"
            >
              <div className="border-b border-[#DCE5F3] bg-[#F4F7FC] px-4 py-3">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <Link href={`/procesos/${g.proceso_id}`} className="text-base font-bold text-[#0A2A62] hover:underline">
                    {g.codigo_proceso}
                  </Link>
                  {g.numero_acta ? (
                    <span className="rounded-full bg-[#144193] px-2.5 py-0.5 text-xs font-semibold text-white">
                      Acta {g.numero_acta}
                    </span>
                  ) : (
                    <span className="rounded-full border border-[#CBD6E8] bg-white px-2.5 py-0.5 text-xs font-medium text-[#6B7C99]">
                      Sin número de acta
                    </span>
                  )}
                  <span className="text-xs text-[#4A5B78] sm:ml-auto">
                    {g.sucursal}{g.ciudad ? ` · ${g.ciudad}` : ''}
                  </span>
                </div>
                <div className="mt-2 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-3">
                  <p><span className="text-[#6B7C99]">Solicitante: </span><span className="font-medium text-[#0A2A62]">{g.demandante || '—'}</span></p>
                  <p><span className="text-[#6B7C99]">Invitado: </span><span className="font-medium text-[#0A2A62]">{g.demandado || '—'}</span></p>
                  <p><span className="text-[#6B7C99]">Mediador: </span><span className="font-medium text-[#0A2A62]">{g.mediador}</span></p>
                </div>
                {(g.chips || []).length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-2 text-xs">
                    {g.chips.map((c: any) => (
                      <span
                        key={c.label}
                        className={
                          c.final
                            ? 'rounded-md bg-[#144193] px-2 py-1 font-semibold text-white'
                            : 'rounded-md bg-white px-2 py-1 font-semibold text-[#0A2A62] ring-1 ring-[#CBD6E8]'
                        }
                      >
                        {c.label}: {dinero(c.valor)}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <ul className="divide-y divide-[#E3EAF5]">
                {g.items.map((f: any) => (
                  <li key={f.clave} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5 text-sm">
                    <span className="w-56 shrink-0">
                      <Badge label={f.tipo_etiqueta} variant={f.tipo.startsWith('factura') ? 'enviado' : 'aprobado'} />
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[#4A5B78]" title={f.nombre || ''}>{f.nombre || '—'}</span>
                    {f.monto != null && (
                      <span className="font-semibold text-[#0A2A62]">{dinero(f.monto)}</span>
                    )}
                    <span className="whitespace-nowrap text-xs text-[#6B7C99]">{formatearFecha(f.fecha)}</span>
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
            </section>
          ))}
        </div>
      )}
    </>
  );
}
