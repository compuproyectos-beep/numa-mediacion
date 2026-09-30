import api from './api';
import {
  AuthResponse,
  DashboardStats,
  Ciudad,
  CreateCiudadPayload,
  Sucursal,
  CreateSucursalPayload,
  Cliente,
  CreateClientePayload,
  ProcesoMediacion,
  CreateProcesoPayload,

} from '@/types';

// ── AUTH ──────────────────────────────────────────────────────────────────────
export async function login(username: string, password: string): Promise<AuthResponse> {
  const form = new URLSearchParams();
  form.append('username', username);
  form.append('password', password);

  const res = await api.post<AuthResponse>('/login', form, {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });
  return res.data;
}

export async function solicitarRecuperacion(email: string): Promise<{ mensaje: string }> {
  const form = new URLSearchParams();
  form.append('email', email);

  const res = await api.post('/auth/olvide-password', form, {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });
  return res.data;
}

export async function restablecerPassword(
  token: string,
  nuevaPassword: string
): Promise<{ mensaje: string }> {
  const form = new URLSearchParams();
  form.append('token', token);
  form.append('nueva_password', nuevaPassword);

  const res = await api.post('/auth/restablecer-password', form, {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });
  return res.data;
}

// ── DASHBOARD ─────────────────────────────────────────────────────────────────
export async function getDashboard(): Promise<DashboardStats> {
  const res = await api.get<DashboardStats>('/dashboard');
  return res.data;
}

export async function getUsoAlmacenamiento(): Promise<any> {
  const res = await api.get('/admin/almacenamiento');
  return res.data;
}

export async function enviarRespaldoManual(): Promise<{
  ok: boolean;
  motivo: string;
  destinatario?: string;
  tamano_mb?: number;
  tablas?: number;
}> {
  const res = await api.post('/admin/respaldo-manual');
  return res.data;
}

// ── ACTAS ─────────────────────────────────────────────────────────────────────
// ── PROVINCIAS ────────────────────────────────────────────────────────────────
export async function getProvincias(): Promise<any[]> {
  const res = await api.get('/provincias');
  return res.data;
}

// ── CIUDADES ──────────────────────────────────────────────────────────────────
export async function getCiudades(soloConSucursal = false): Promise<Ciudad[]> {
  const res = await api.get<Ciudad[]>('/ciudades', {
    params: {
      solo_con_sucursal: soloConSucursal,
    },
  });

  return res.data;
}

export async function createCiudad(payload: any): Promise<Ciudad> {
  const res = await api.post<Ciudad>('/ciudades', null, {
    params: {
      nombre: payload.nombre,
      provincia_id: payload.provincia_id,
      prefijo: payload.prefijo,
    },
  });

  return res.data;
}

export async function cambiarEstadoCiudad(
  id: number,
  activo: boolean
): Promise<Ciudad> {
  const res = await api.put<Ciudad>(`/ciudades/${id}/estado`, null, {
    params: { activo },
  });

  return res.data;
}

export async function updateCiudad(id: number, payload: any): Promise<Ciudad> {
  const res = await api.put<Ciudad>(`/ciudades/${id}`, null, {
    params: {
      nombre: payload.nombre,
      provincia_id: payload.provincia_id,
      prefijo: payload.prefijo,
    },
  });
  return res.data;
}

export async function deleteCiudad(id: number): Promise<void> {
  await api.delete(`/ciudades/${id}`);
}

// ── SUCURSALES ────────────────────────────────────────────────────────────────
export async function getSucursales(activo?: boolean): Promise<Sucursal[]> {
  const res = await api.get<Sucursal[]>('/sucursales', {
    params: {
      activo: activo === undefined ? undefined : activo,
    },
  });
  return res.data;
}

export async function createSucursal(payload: CreateSucursalPayload): Promise<Sucursal> {
  const res = await api.post<Sucursal>('/sucursales', null, {
    params: {
      ciudad_id: payload.ciudad_id,
      nombre: payload.nombre,
      codigo: payload.codigo,
      prefijo: payload.prefijo,
      direccion: payload.direccion,
      telefono: payload.telefono,
    },
  });

  return res.data;
}

export async function updateSucursal(id: number, payload: CreateSucursalPayload): Promise<Sucursal> {
  const res = await api.put<Sucursal>(`/sucursales/${id}`, null, {
    params: {
      ciudad_id: payload.ciudad_id,
      nombre: payload.nombre,
      direccion: payload.direccion,
      telefono: payload.telefono,
    },
  });
  return res.data;
}

export async function deleteSucursal(id: number): Promise<void> {
  await api.delete(`/sucursales/${id}`);
}

export async function cambiarEstadoSucursal(
  id: number,
  activo: boolean
): Promise<Sucursal> {
  const res = await api.put<Sucursal>(`/sucursales/${id}/estado`, null, {
    params: { activo },
  });

  return res.data;
}



// ── CLIENTES ──────────────────────────────────────────────────────────────────
export async function getClientes(): Promise<Cliente[]> {
  const res = await api.get<Cliente[]>('/clientes');
  return res.data;
}

export async function createCliente(payload: CreateClientePayload): Promise<Cliente> {
  const res = await api.post<Cliente>('/clientes', null, {
    params: {
      cedula: payload.cedula,
      nombre: payload.nombre,
      apellido: payload.apellido,
      telefono: payload.telefono,
      email: payload.email,
      ciudad_id: payload.ciudad_id,
      direccion: payload.direccion,
    },
  });

  return res.data;
}

export async function updateCliente(
  id: number,
  payload: CreateClientePayload
): Promise<Cliente> {
  const res = await api.put<Cliente>(`/clientes/${id}`, null, {
    params: {
      cedula: payload.cedula,
      nombre: payload.nombre,
      apellido: payload.apellido,
      telefono: payload.telefono,
      email: payload.email,
      ciudad_id: payload.ciudad_id,
      direccion: payload.direccion,
    },
  });

  return res.data;
}

export async function deleteCliente(id: number): Promise<void> {
  await api.delete(`/clientes/${id}`);
}


export async function getUsuarios(): Promise<any[]> {
  const res = await api.get('/usuarios');
  return res.data;
}

export async function createUsuario(payload: any): Promise<any> {
  const res = await api.post('/usuarios', null, {
    params: {
      nombre: payload.nombre,
      apellido: payload.apellido,
       cedula: payload.cedula,
      email: payload.email,
      password: payload.password,
      rol: payload.rol,
      sucursal_id: payload.sucursal_id,
    },
  });

  return res.data;
}

export async function updateUsuario(id: number, payload: any): Promise<any> {
  const res = await api.put(`/usuarios/${id}`, null, {
    params: {
      nombre: payload.nombre,
      apellido: payload.apellido,
      cedula: payload.cedula,
      email: payload.email,
      rol: payload.rol,
      sucursal_id: payload.sucursal_id,
    },
  });

  return res.data;
}

export async function cambiarEstadoUsuario(
  id: number,
  activo: boolean
): Promise<any> {
  const res = await api.put(`/usuarios/${id}/estado`, null, {
    params: { activo },
  });

  return res.data;
}


export async function cambiarPassword(
  password_actual: string,
  password_nueva: string
): Promise<any> {
  const res = await api.put('/usuarios/cambiar-password', null, {
    params: {
      password_actual,
      password_nueva,
    },
  });

  return res.data;
}

export async function getMe(): Promise<any> {
  const res = await api.get('/me');
  return res.data;
}

// ── CITAS ─────────────────────────────────────────────────────────────────────
export async function getCitas(filters?: {
  estado?: string;
  fecha_desde?: string;
  fecha_hasta?: string;
  usuario_id?: number;
}): Promise<any[]> {
  const res = await api.get('/citas', {
    params: filters,
  });

  return res.data;
}

export async function cambiarEstadoCita(
  id: number,
  estado: string
): Promise<any> {
  const res = await api.put(`/citas/${id}/estado`, null, {
    params: { estado },
  });

  return res.data;
}

// ── NOTIFICACIONES ───────────────────────────

export async function getNotificaciones(): Promise<any[]> {
  const res = await api.get('/notificaciones');
  return res.data;
}

export async function marcarNotificacionLeida(id: number): Promise<any> {
  const res = await api.put(`/notificaciones/${id}/leer`);
  return res.data;
}

export async function marcarTodasNotificacionesLeidas(): Promise<any> {
  const res = await api.put('/notificaciones/leer-todas');
  return res.data;
}

// ── RECORDATORIOS ───────────────────────────
export async function generarRecordatoriosCitas(): Promise<any> {
  const res = await api.post('/notificaciones/generar-recordatorios-citas');
  return res.data;
}

export async function getProcesos(filters?: {
  q?: string;
  estado?: string;
  ciudad_id?: string | number;
  sucursal_id?: string | number;
  usuario_id?: string | number;
  cliente_id?: string | number;
  fecha_desde?: string;
  fecha_hasta?: string;
}): Promise<ProcesoMediacion[]> {
  const res = await api.get('/procesos', {
    params: filters,
  });

  return res.data;
}

export async function createProceso(
  payload: CreateProcesoPayload
): Promise<ProcesoMediacion> {
  const res = await api.post('/procesos', null, {
    params: {
      cliente_demandante_id: payload.cliente_demandante_id,
      cliente_demandado_id: payload.cliente_demandado_id,
      sucursal_id: payload.sucursal_id,
      tema: payload.tema,
    },
  });

  return res.data;
}


export async function getCitasProceso(
  procesoId: number
): Promise<any[]> {
  const res = await api.get(`/procesos/${procesoId}/citas`);
  return res.data;
}

export async function crearInvitacionProceso(
  procesoId: number,
  payload: {
    fecha: string;
    hora: string;
    observaciones?: string;
  }
): Promise<any> {
  const res = await api.post(
    `/procesos/${procesoId}/citas`,
    null,
    {
      params: {
        fecha: payload.fecha,
        hora: payload.hora,
        observaciones: payload.observaciones || undefined
      }
    }
  );

  return res.data;
}


export async function getAvancesProceso(
  procesoId: number
): Promise<any[]> {
  const res = await api.get(`/procesos/${procesoId}/avances`);
  return res.data;
}

export async function crearAvanceProceso(
  procesoId: number,
  payload: {
    resultado: string;
    observacion: string;
    proxima_fecha?: string;
    proxima_hora?: string;
    proxima_observaciones?: string;
  }
): Promise<any> {
  const res = await api.post(
    `/procesos/${procesoId}/avances`,
    null,
    {
      params: {
        resultado: payload.resultado,
        observacion: payload.observacion,
        proxima_fecha: payload.proxima_fecha || undefined,
        proxima_hora: payload.proxima_hora || undefined,
        proxima_observaciones: payload.proxima_observaciones || undefined,
      },
    }
  );

  return res.data;
}


export async function subirActaFinalProceso(
  procesoId: number,
  file: File,
  comprobantePago: File
): Promise<any> {
  const formData = new FormData();
  formData.append('archivo', file);
  formData.append('comprobante_pago', comprobantePago);

  const res = await api.post(
    `/procesos/${procesoId}/acta-final`,
    formData,
    {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    }
  );

  return res.data;
}


export async function getActasFinales(filters?: {
  q?: string;
  ciudad_id?: string | number;
  sucursal_id?: string | number;
  usuario_id?: string | number;
  fecha_desde?: string;
  fecha_hasta?: string;
}): Promise<any[]> {
  const res = await api.get('/actas-finales', {
    params: filters,
  });

  return res.data;
}


export interface FiltrosReporte {
  fecha_desde?: string;
  fecha_hasta?: string;
  ciudad_id?: string | number;
  sucursal_id?: string | number;
  usuario_id?: string | number;
}

export async function getReporteProductividad(
  filters?: FiltrosReporte
): Promise<any[]> {
  const res = await api.get('/reportes/productividad', {
    params: filters,
  });

  return res.data;
}

export async function getReporteSucursales(
  filters?: FiltrosReporte
): Promise<any[]> {
  const res = await api.get('/reportes/sucursales', {
    params: filters,
  });

  return res.data;
}

export async function getReporteClientes(
  filters?: FiltrosReporte
): Promise<any[]> {
  const res = await api.get('/reportes/clientes', {
    params: filters,
  });

  return res.data;
}

// Descarga el reporte (procesos, productividad, actas, sucursales o
// clientes) como archivo .xlsx, generado en el backend con los mismos
// filtros que se ven en pantalla.
export async function descargarReporteExcel(
  tipo: 'procesos' | 'productividad' | 'actas' | 'sucursales' | 'clientes',
  filters?: FiltrosReporte
): Promise<Blob> {
  const res = await api.get('/reportes/exportar-excel', {
    params: { tipo, ...filters },
    responseType: 'blob',
  });

  return res.data;
}

export function getPdfActaFinalUrl(actaId: number): string {
  return `${process.env.NEXT_PUBLIC_API_URL}/actas-finales/${actaId}/pdf`;
}

export async function descargarPdfActaFinal(actaId: number): Promise<Blob> {
  const res = await api.get(`/actas-finales/${actaId}/pdf`, {
    responseType: 'blob',
  });

  return res.data;
}

export async function descargarComprobantePagoActaFinal(actaId: number): Promise<Blob> {
  const res = await api.get(`/actas-finales/${actaId}/comprobante`, {
    responseType: 'blob',
  });

  return res.data;
}


export async function reemplazarPdfActaFinal(
  actaId: number,
  file: File,
  motivo: string
): Promise<any> {
  const formData = new FormData();

  formData.append('archivo', file);
  formData.append('motivo', motivo);

  const res = await api.post(
    `/actas-finales/${actaId}/reemplazar`,
    formData,
    {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    }
  );

  return res.data;
}

export async function getHistorialActaFinal(
  actaId: number
): Promise<any> {
  const res = await api.get(`/actas-finales/${actaId}/historial`);
  return res.data;
}

export async function exportarActasFinalesZip(filters?: {
  ciudad_id?: string | number;
  sucursal_id?: string | number;
  fecha_desde?: string;
  fecha_hasta?: string;
}): Promise<Blob> {
  const res = await api.get('/actas-finales/exportar-pdfs', {
    params: filters,
    responseType: 'blob',
  });

  return res.data;
}


export async function getExpedienteProceso(
  procesoId: number
): Promise<any> {
  const res = await api.get(`/procesos/${procesoId}/expediente`);
  return res.data;
}