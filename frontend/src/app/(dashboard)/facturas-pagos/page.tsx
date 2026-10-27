'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Eye, FileSpreadsheet } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { PageHeader, Spinner, EmptyState, Badge, InputField, SelectField, ErrorAlert } from '@/components/ui';
import {
  getFacturasPagos,
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [exportando, setExportando] = useState(false);
  const [filters, setFilters] = useState(VACIO);
  const [sucursales, setSucursales] = useState<any[]>([]);
  const [mediadores, setMediadores] = useState<any[]>([]);

  const cargar = async (f = filters) => {
    setLoading(true);
    try {
      setFilas(await getFacturasPagos(limpiar(f)));
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
          <button
            type="button"
            onClick={exportar}
            disabled={exportando || filas.length === 0}
            className="ml-auto inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50 transition-colors"
          >
            <FileSpreadsheet size={16} />
            {exportando ? 'Exportando...' : 'Exportar Excel'}
          </button>
        </div>
      </form>

      {loading ? (
        <Spinner />
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
                {(g.monto_total != null || (g.pago_en_abonos && g.abono1_monto != null)) && (
                  <div className="mt-2 flex flex-wrap gap-2 text-xs">
                    {g.monto_total != null && (
                      <span className="rounded-md bg-white px-2 py-1 font-semibold text-[#0A2A62] ring-1 ring-[#CBD6E8]">
                        Monto total: {dinero(g.monto_total)}
                      </span>
                    )}
                    {g.pago_en_abonos && g.abono1_monto != null && (
                      <span className="rounded-md bg-white px-2 py-1 font-semibold text-[#0A2A62] ring-1 ring-[#CBD6E8]">
                        1.er abono: {dinero(g.abono1_monto)}
                      </span>
                    )}
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
