'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { PageHeader, Spinner, EmptyState, ErrorAlert } from '@/components/ui';
import { getAuditoria, RegistroAuditoria } from '@/lib/services';
import { isAdmin } from '@/lib/auth';

// Colores del badge por tipo de acción — para que sea fácil detectar de un
// vistazo lo negativo (login fallido, desactivaciones) de lo neutral.
function claseAccion(accion: string): string {
  if (accion === 'login_fallido' || accion === 'cuenta_bloqueada' || accion.includes('desactivad') || accion.includes('anula') || accion.includes('suspendid')) {
    return 'bg-red-50 text-red-700 border-red-200';
  }
  if (accion.includes('creado') || accion.includes('creada') || accion.includes('activad') || accion.includes('reactiva')) {
    return 'bg-green-50 text-green-700 border-green-200';
  }
  return 'bg-numa-100 text-numa-600 border-numa-200';
}

function etiquetaAccion(accion: string): string {
  const etiquetas: Record<string, string> = {
    cuenta_bloqueada: 'Cuenta bloqueada por intentos fallidos',
    login_fallido: 'Intento de ingreso fallido',
    usuario_creado: 'Usuario creado',
    usuario_editado: 'Usuario editado',
    usuario_activado: 'Usuario activado',
    usuario_desactivado: 'Usuario desactivado',
    cliente_creado: 'Cliente creado',
    cliente_editado: 'Cliente editado',
    sucursal_creada: 'Sucursal creada',
    sucursal_editada: 'Sucursal editada',
    sucursal_activada: 'Sucursal activada',
    sucursal_desactivada: 'Sucursal desactivada',
    proceso_anulado: 'Proceso anulado',
    pedir_numero_acta: 'Número de acta pedido',
    efectivo_depositado: 'Efectivo marcado como depositado',
    sin_factura_marcado: 'Cliente sin factura (marcado)',
    sin_factura_quitado: 'Cliente sin factura (quitado)',
    anular_numero_acta: 'Número de acta anulado por el administrador',
    reactivar_numero_acta: 'Número de acta reactivado',
    acta_firmada_subida: 'Acta firmada subida',
    acta_no_acuerdo_solicitada: 'Acta de no acuerdo pedida',
    acuerdo_corregido: 'Acuerdo corregido',
    guardar_facturacion: 'Facturación guardada',
    factura_subida: 'Factura subida',
    factura_reemplazada: 'Factura reemplazada',
    proceso_suspendido: 'Proceso suspendido',
    proceso_reactivado: 'Proceso reactivado',
    proceso_parte_agregada: 'Parte agregada al proceso',
    proceso_parte_quitada: 'Parte quitada del proceso',
    proceso_responsable_cambiado: 'Responsable cambiado',
  };
  return etiquetas[accion] || accion;
}

export default function AuditoriaPage() {
  const router = useRouter();
  const admin = isAdmin();

  const [registros, setRegistros] = useState<RegistroAuditoria[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [accion, setAccion] = useState('');
  const [fechaDesde, setFechaDesde] = useState('');
  const [fechaHasta, setFechaHasta] = useState('');

  useEffect(() => {
    if (!admin) {
      router.replace('/dashboard');
    }
  }, [admin, router]);

  const cargar = () => {
    setLoading(true);
    setError('');
    getAuditoria({
      accion: accion || undefined,
      fecha_desde: fechaDesde || undefined,
      fecha_hasta: fechaHasta || undefined,
      limite: 200,
    })
      .then(setRegistros)
      .catch(() => setError('No se pudo cargar el registro de auditoría.'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (!admin) return;
    cargar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [admin]);

  if (!admin) return null;

  return (
    <>
      <PageHeader
        title="Auditoría"
        subtitle="Quién hizo qué en el sistema — usuarios, clientes, sucursales, procesos anulados e intentos de login"
      />

      {error && (
        <div className="mb-4">
          <ErrorAlert message={error} />
        </div>
      )}

      <div className="card p-4 mb-4">
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
          <div>
            <label className="block text-xs font-medium text-numa-700 mb-1">Acción</label>
            <select
              value={accion}
              onChange={(e) => setAccion(e.target.value)}
              className="input-field"
            >
              <option value="">Todas</option>
              <option value="cuenta_bloqueada">Cuenta bloqueada por intentos fallidos</option>
              <option value="login_fallido">Intento de ingreso fallido (historial)</option>
              <option value="usuario_creado">Usuario creado</option>
              <option value="usuario_editado">Usuario editado</option>
              <option value="usuario_activado">Usuario activado</option>
              <option value="usuario_desactivado">Usuario desactivado</option>
              <option value="cliente_creado">Cliente creado</option>
              <option value="cliente_editado">Cliente editado</option>
              <option value="sucursal_creada">Sucursal creada</option>
              <option value="sucursal_editada">Sucursal editada</option>
              <option value="sucursal_activada">Sucursal activada</option>
              <option value="sucursal_desactivada">Sucursal desactivada</option>
              <option value="proceso_anulado">Proceso anulado</option>
              <option value="anular_numero_acta">Número de acta anulado</option>
              <option value="reactivar_numero_acta">Número de acta reactivado</option>
              <option value="acuerdo_corregido">Acuerdo corregido</option>
              <option value="factura_reemplazada">Factura reemplazada</option>
              <option value="proceso_suspendido">Proceso suspendido</option>
              <option value="proceso_reactivado">Proceso reactivado</option>
              <option value="proceso_responsable_cambiado">Responsable cambiado</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-numa-700 mb-1">Desde</label>
            <input
              type="date"
              value={fechaDesde}
              onChange={(e) => setFechaDesde(e.target.value)}
              className="input-field"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-numa-700 mb-1">Hasta</label>
            <input
              type="date"
              value={fechaHasta}
              onChange={(e) => setFechaHasta(e.target.value)}
              className="input-field"
            />
          </div>

          <div className="flex items-end">
            <button onClick={cargar} className="btn-primary w-full justify-center">
              Filtrar
            </button>
          </div>
        </div>
      </div>

      <div className="card overflow-hidden">
        {loading ? (
          <Spinner />
        ) : registros.length === 0 ? (
          <EmptyState message="No hay registros de auditoría con estos filtros." />
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full">
              <thead className="bg-numa-50 border-b border-numa-100">
                <tr>
                  <th className="table-header table-cell-sticky !bg-numa-50">Fecha</th>
                  <th className="table-header">Usuario</th>
                  <th className="table-header">Acción</th>
                  <th className="table-header">Detalle</th>
                </tr>
              </thead>

              <tbody>
                {registros.map((r) => (
                  <tr key={r.id} className="table-row">
                    <td className="table-cell table-cell-sticky text-numa-700 whitespace-nowrap">
                      {new Date(r.fecha_creacion).toLocaleString('es-EC', {
                        dateStyle: 'short',
                        timeStyle: 'short',
                      })}
                    </td>

                    <td className="table-cell font-medium">
                      {r.usuario_nombre || 'Desconocido'}
                    </td>

                    <td className="table-cell">
                      <span
                        className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold border whitespace-nowrap ${claseAccion(
                          r.accion
                        )}`}
                      >
                        {etiquetaAccion(r.accion)}
                      </span>
                    </td>

                    <td className="table-cell text-numa-600">
                      {r.detalle || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
