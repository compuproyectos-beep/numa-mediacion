'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Eye, FileSpreadsheet, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { PageHeader, Spinner, EmptyState, InputField, SelectField, ErrorAlert } from '@/components/ui';
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

// Cada faltante del servidor se traduce al mismo "tipo" que usan las filas subidas.
const FALTAS: { flag: string; tipo: string; etiqueta: string }[] = [
  { flag: 'falta_comprobante_pago', tipo: 'pago_acta', etiqueta: 'Comprobante de pago' },
  { flag: 'falta_comprobante_saldo', tipo: 'pago_final', etiqueta: 'Comprobante del segundo pago (saldo)' },
  { flag: 'falta_factura_cliente', tipo: 'factura_cliente', etiqueta: 'Factura de NUMA al cliente' },
  { flag: 'falta_factura_mediador', tipo: 'factura_mediador', etiqueta: 'Factura del mediador a NUMA' },
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
  // Lo que todavía falta por subir: se muestra dentro de la tarjeta de cada proceso.
  const [faltantes, setFaltantes] = useState<any[]>([]);
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
      setFaltantes([]);
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

  // Un cuadro por proceso: arriba sus datos, luego lo subido y, en el mismo cuadro, lo que falta.
  const grupos: any[] = [];
  const porProceso = new Map<number, any>();
  const grupoDe = (base: any) => {
    let g = porProceso.get(base.proceso_id);
    if (!g) {
      g = { ...base, items: [], faltan: [] };
      porProceso.set(base.proceso_id, g);
      grupos.push(g);
    }
    return g;
  };
  filas.forEach((f) => grupoDe(f).items.push(f));

  // Si se filtra por un tipo, solo se muestran las faltas de ese tipo; con fechas, los procesos
  // que no tienen nada subido en ese rango no aparecen solo por tener algo pendiente.
  const hayFechas = !!(filters.fecha_desde || filters.fecha_hasta);
  faltantes.forEach((fp) => {
    const faltas = FALTAS.filter((x) => fp[x.flag] && (!filters.tipo || filters.tipo === x.tipo));
    if (faltas.length === 0) return;
    if (hayFechas && !porProceso.has(fp.proceso_id)) return;
    const g = grupoDe({
      proceso_id: fp.proceso_id,
      codigo_proceso: fp.codigo_proceso,
      numero_acta: fp.numero_acta,
      sucursal: fp.sucursal,
      ciudad: fp.ciudad,
      mediador: fp.mediador,
      demandante: fp.demandante,
      demandado: fp.demandado,
    });
    g.faltan = faltas;
    g.dias_desde_acta_firmada = fp.dias_desde_acta_firmada;
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
  // Primero los procesos a los que les falta algo; dentro de cada grupo, el orden original.
  grupos.sort((a, b) => (b.faltan.length > 0 ? 1 : 0) - (a.faltan.length > 0 ? 1 : 0));
  const conFaltas = grupos.filter((g) => g.faltan.length > 0).length;

  return (
    <>
      <PageHeader
        title="Facturas y pagos"
        subtitle="Lo subido y lo que todavía falta de cada proceso, en un solo lugar"
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
        className="card mb-5 p-4"
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
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
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button type="submit" className="btn-primary btn-sm">Filtrar</button>
          <button type="button" onClick={limpiarFiltros} className="btn-secondary btn-sm">Limpiar</button>
          <button
            type="button"
            onClick={exportar}
            disabled={exportando || filas.length === 0}
            className="btn-secondary btn-sm ml-auto disabled:opacity-50"
          >
            <FileSpreadsheet size={16} />
            {exportando ? 'Exportando...' : 'Exportar Excel'}
          </button>
        </div>
      </form>

      {loading ? (
        <Spinner />
      ) : grupos.length === 0 ? (
        <EmptyState
          icon="🧾"
          message="Aún no hay facturas ni comprobantes con estos filtros. Aparecerán aquí cuando se suban dentro de los procesos."
        />
      ) : (
        <>
          {conFaltas > 0 && (
            <p className="mb-3 flex items-center gap-2 text-sm font-semibold text-red-800">
              <AlertTriangle size={16} aria-hidden="true" />
              {conFaltas === 1
                ? '1 proceso tiene documentos por subir'
                : `${conFaltas} procesos tienen documentos por subir`}
              <span className="font-normal text-numa-800">(aparecen primero, marcados en rojo)</span>
            </p>
          )}
          <div className="space-y-5">
            {grupos.map((g) => (
              <section
                key={g.proceso_id}
                className="card overflow-hidden"
              >
                <div className="px-4 pt-3 pb-3 border-b border-numa-200">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <Link href={`/procesos/${g.proceso_id}`} className="text-base font-bold text-numa-900 hover:underline">
                      {g.codigo_proceso}
                    </Link>
                    {g.numero_acta ? (
                      <span className="rounded-full bg-numa-800 px-2.5 py-0.5 text-xs font-semibold text-white">
                        Acta {g.numero_acta}
                      </span>
                    ) : (
                      <span className="rounded-full border border-numa-300 px-2.5 py-0.5 text-xs font-medium text-numa-700">
                        Sin número de acta
                      </span>
                    )}
                    {g.faltan.length > 0 && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-red-700 px-2.5 py-0.5 text-xs font-semibold text-white">
                        <AlertTriangle size={12} aria-hidden="true" />
                        Faltan {g.faltan.length === 1 ? 'un documento' : `${g.faltan.length} documentos`}
                      </span>
                    )}
                    <span className="text-xs text-numa-700 sm:ml-auto">
                      {g.sucursal}{g.ciudad ? ` · ${g.ciudad}` : ''}
                    </span>
                  </div>
                  <div className="mt-2 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-3">
                    <p><span className="text-numa-700">Solicitante: </span><span className="font-medium text-numa-900">{g.demandante || '—'}</span></p>
                    <p><span className="text-numa-700">Invitado: </span><span className="font-medium text-numa-900">{g.demandado || '—'}</span></p>
                    <p><span className="text-numa-700">Mediador: </span><span className="font-medium text-numa-900">{g.mediador}</span></p>
                  </div>
                  {(g.chips || []).length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-2 text-xs">
                      {g.chips.map((c: any) => (
                        <span
                          key={c.label}
                          className={
                            c.final
                              ? 'rounded-md bg-numa-800 px-2 py-1 font-semibold text-white'
                              : 'rounded-md px-2 py-1 font-semibold text-numa-900 ring-1 ring-numa-300'
                          }
                        >
                          {c.label}: {dinero(c.valor)}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                <ul className="divide-y divide-numa-200">
                  {g.items.map((f: any) => (
                    <li key={f.clave} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5 text-sm">
                      <span className="inline-flex w-60 shrink-0 items-center gap-1.5 font-semibold text-numa-900">
                        <CheckCircle2 size={15} className="text-emerald-600 shrink-0" aria-hidden="true" />
                        {f.tipo_etiqueta}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-numa-800" title={f.nombre || ''}>{f.nombre || '—'}</span>
                      {f.monto != null && (
                        <span className="font-semibold text-numa-900">{dinero(f.monto)}</span>
                      )}
                      <span className="whitespace-nowrap text-xs text-numa-700">{formatearFecha(f.fecha)}</span>
                      <button type="button" onClick={() => abrir(f)} className="btn-primary btn-sm">
                        <Eye size={14} /> Abrir
                      </button>
                    </li>
                  ))}

                  {/* Lo que todavía no se ha subido, en la misma tarjeta. */}
                  {g.faltan.map((x: any) => (
                    <li
                      key={x.tipo}
                      className="flex flex-wrap items-center gap-x-4 gap-y-1 bg-red-50 px-4 py-2.5 text-sm"
                    >
                      <span className="inline-flex w-60 shrink-0 items-center gap-1.5 font-semibold text-red-900">
                        <AlertTriangle size={15} className="shrink-0" aria-hidden="true" />
                        {x.etiqueta}
                      </span>
                      <span className="min-w-0 flex-1 font-semibold text-red-800">
                        Falta subir
                        {g.dias_desde_acta_firmada != null && x.tipo.startsWith('factura')
                          ? ` · ${g.dias_desde_acta_firmada === 0 ? 'acta firmada hoy' : `${g.dias_desde_acta_firmada} día${g.dias_desde_acta_firmada === 1 ? '' : 's'} desde el acta firmada`}`
                          : ''}
                      </span>
                      <Link href={`/procesos/${g.proceso_id}`} className="btn-secondary btn-sm">
                        Ir al proceso
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </>
      )}
    </>
  );
}
