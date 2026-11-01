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
export async function getDashboard(soloMios = false): Promise<DashboardStats> {
  const res = await api.get<DashboardStats>('/dashboard', {
    params: soloMios ? { solo_mios: true } : undefined,
  });
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
  // timeout de 45s: generar el respaldo y enviarlo por correo puede tardar
  // unos segundos, pero si el servidor SMTP no responde en absoluto (puerto
  // bloqueado, host mal configurado), esto evita que el botón se quede
  // "Enviando..." para siempre sin decir nada.
  const res = await api.post('/admin/respaldo-manual', null, { timeout: 45000 });
  return res.data;
}

export interface RegistroAuditoria {
  id: number;
  usuario_id: number | null;
  usuario_nombre: string | null;
  accion: string;
  entidad: string;
  entidad_id: number | null;
  detalle: string | null;
  fecha_creacion: string;
}

export async function getAuditoria(filters?: {
  fecha_desde?: string;
  fecha_hasta?: string;
  usuario_id?: number;
  accion?: string;
  limite?: number;
}): Promise<RegistroAuditoria[]> {
  const res = await api.get<RegistroAuditoria[]>('/admin/auditoria', {
    params: filters,
  });
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
      admin_telefono: payload.admin_telefono || undefined,
      admin_email: payload.admin_email || undefined,
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
      admin_telefono: payload.admin_telefono || undefined,
      admin_email: payload.admin_email || undefined,
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
      tipo: payload.tipo || 'persona',
      cedula: payload.tipo === 'empresa' ? undefined : payload.cedula,
      nombre: payload.tipo === 'empresa' ? undefined : payload.nombre,
      apellido: payload.tipo === 'empresa' ? undefined : payload.apellido,
      razon_social: payload.razon_social,
      ruc: payload.ruc,
      representante_nombre: payload.representante_nombre,
      representante_cedula: payload.representante_cedula,
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
      tipo: payload.tipo || 'persona',
      cedula: payload.tipo === 'empresa' ? undefined : payload.cedula,
      nombre: payload.tipo === 'empresa' ? undefined : payload.nombre,
      apellido: payload.tipo === 'empresa' ? undefined : payload.apellido,
      razon_social: payload.razon_social,
      ruc: payload.ruc,
      representante_nombre: payload.representante_nombre,
      representante_cedula: payload.representante_cedula,
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
      telefono: payload.telefono,
      es_coordinador: !!payload.es_coordinador,
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
      telefono: payload.telefono,
      es_coordinador: !!payload.es_coordinador,
    },
  });

  return res.data;
}

export async function desbloquearUsuario(id: number): Promise<any> {
  const res = await api.post(`/usuarios/${id}/desbloquear`);
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

// Todas las invitaciones del proceso al que pertenece esta (historial).
export async function getHistorialInvitaciones(citaId: number): Promise<any[]> {
  const res = await api.get(`/citas/${citaId}/historial`);
  return res.data;
}

export async function cambiarEstadoCita(
  id: number,
  estado: string,
  motivo?: string
): Promise<any> {
  const res = await api.put(`/citas/${id}/estado`, null, {
    params: { estado, motivo: motivo || undefined },
  });

  return res.data;
}

// ── REUNIONES DE MEDIADORES Y SECRETARIA ─────────────────────────────────────
export async function getMediadoresSucursal(): Promise<any[]> {
  const res = await api.get('/sucursal/mediadores');
  return res.data;
}

export async function getReuniones(filters?: {
  fecha_desde?: string;
  fecha_hasta?: string;
  sucursal_id?: number;
}): Promise<any[]> {
  const res = await api.get('/reuniones', { params: filters });
  return res.data;
}

export async function crearReunion(payload: {
  fecha: string;
  hora_inicio: string;
  hora_fin: string;
  titulo?: string;
  detalle?: string;
}): Promise<{ reunion: any; conflictos: any[] }> {
  const res = await api.post('/reuniones', payload);
  return res.data;
}

export async function editarReunion(
  id: number,
  payload: {
    fecha: string;
    hora_inicio: string;
    hora_fin: string;
    titulo?: string;
    detalle?: string;
  }
): Promise<{ reunion: any; conflictos: any[] }> {
  const res = await api.put(`/reuniones/${id}`, payload);
  return res.data;
}

export async function cancelarReunion(id: number, motivo?: string): Promise<any> {
  const res = await api.put(`/reuniones/${id}/cancelar`, null, {
    params: { motivo: motivo || undefined },
  });
  return res.data;
}

// ── NOTIFICACIONES ───────────────────────────

export async function getNotificaciones(): Promise<any[]> {
  const res = await api.get('/notificaciones');
  return res.data;
}

export async function getTotalNoLeidas(): Promise<number> {
  const res = await api.get('/notificaciones/no-leidas');
  return res.data.total;
}

export async function getNotificacionesUrgentes(): Promise<any[]> {
  const res = await api.get('/notificaciones/urgentes');
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
  suspendido?: boolean;
  proceso_id?: number;
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
      empresa_solicitante_id: payload.empresa_solicitante_id,
      empresa_invitado_id: payload.empresa_invitado_id,
      cita_rapida_id: payload.cita_rapida_id,
      mediador_id: payload.mediador_id,
    },
  });

  return res.data;
}

// ── PARTES DEL PROCESO (varios solicitantes / invitados) ─────────────────────
export async function getPartesProceso(procesoId: number): Promise<any[]> {
  const res = await api.get(`/procesos/${procesoId}/partes`);
  return res.data;
}

export async function agregarParteProceso(
  procesoId: number,
  payload: { rol: 'solicitante' | 'invitado'; cliente_id: number; empresa_representada_id?: number }
): Promise<any[]> {
  const res = await api.post(`/procesos/${procesoId}/partes`, null, { params: payload });
  return res.data;
}

export async function cambiarResponsableParte(procesoId: number, parteId: number): Promise<any[]> {
  const res = await api.put(`/procesos/${procesoId}/partes/${parteId}/responsable`);
  return res.data;
}

export async function quitarParteProceso(procesoId: number, parteId: number): Promise<any[]> {
  const res = await api.delete(`/procesos/${procesoId}/partes/${parteId}`);
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


// ── INVITACIÓN RÁPIDA (desde la Agenda, sin proceso) ─────────────────────────
export async function crearInvitacionRapida(payload: {
  fecha: string;
  hora: string;
  observaciones: string;
  tema?: string;
  usuario_id?: number;
  solicitantes: any[];
  invitados: any[];
}): Promise<any> {
  const res = await api.post('/citas/rapida', payload);
  return res.data;
}

export async function getDatosInvitacionRapida(citaId: number): Promise<any> {
  const res = await api.get(`/citas/${citaId}/invitacion-datos`);
  return res.data;
}

export async function guardarDocumentoInvitacionRapida(
  citaId: number,
  documento: Record<string, string>
): Promise<any> {
  const res = await api.put(`/citas/${citaId}/documento`, documento);
  return res.data;
}

export async function guardarDocumentoInvitacion(
  procesoId: number,
  citaId: number,
  documento: Record<string, string>
): Promise<any> {
  const res = await api.put(`/procesos/${procesoId}/citas/${citaId}/documento`, documento);
  return res.data;
}

export async function leerInvitacionLlena(
  procesoId: number,
  archivo: File
): Promise<any> {
  const form = new FormData();
  form.append('archivo', archivo);
  const res = await api.post(`/procesos/${procesoId}/invitacion-leer`, form, {
    headers: { 'Content-Type': 'multipart/form-data' }
  });
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


export async function anularProceso(procesoId: number, motivo: string): Promise<any> {
  const res = await api.put(`/procesos/${procesoId}/anular`, null, { params: { motivo } });

  return res.data;
}

export interface PagoActaFinal {
  modo: 'completo' | 'abonos';
  fecha?: string;
  montoTotal?: number;
  montoAbono?: number;
}

export async function subirActaFinalProceso(
  procesoId: number,
  file: File,
  comprobantePago: File,
  pago?: PagoActaFinal,
  numeroActaId?: number
): Promise<any> {
  const formData = new FormData();
  formData.append('archivo', file);
  formData.append('comprobante_pago', comprobantePago);
  formData.append('confirmo', 'true');
  if (numeroActaId) formData.append('numero_acta_id', String(numeroActaId));
  formData.append('pago_modo', pago?.modo || 'completo');
  if (pago?.fecha) formData.append('fecha_pago', pago.fecha);
  if (pago?.modo === 'abonos') {
    formData.append('monto_total', String(pago.montoTotal ?? ''));
    formData.append('monto_abono', String(pago.montoAbono ?? ''));
  }

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
  dias_minimo?: string | number;
}

export interface ResumenReporte {
  total_creados: number;
  en_negociacion: number;
  cerrados_con_acuerdo: number;
  cerrados_sin_acuerdo: number;
  archivados: number;
  total_resueltos: number;
  tasa_acuerdo: number | null;
  promedio_dias_resolucion: number | null;
}

export async function getReporteResumen(
  filters?: FiltrosReporte
): Promise<ResumenReporte> {
  const res = await api.get('/reportes/resumen', {
    params: filters,
  });

  return res.data;
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
export async function getReporteOperativo(
  tipo: 'agenda' | 'sin-avance' | 'actas-pendientes' | 'facturas-pendientes',
  filters?: FiltrosReporte
): Promise<any[]> {
  const res = await api.get(`/reportes/operativos/${tipo}`, { params: filters });

  return res.data;
}

export async function descargarReporteExcel(
  tipo:
    | 'procesos'
    | 'productividad'
    | 'actas'
    | 'sucursales'
    | 'clientes'
    | 'agenda'
    | 'sin-avance'
    | 'actas-pendientes'
    | 'facturas-pendientes',
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


// ── ACTA FIRMADA / ACUERDO / SUSPENSIÓN (Fase 3) ─────────────────────────────
export async function subirActaFirmada(
  procesoId: number,
  file: File | null,
  segundoPago?: { comprobante: File; fecha?: string } | null
): Promise<any> {
  const formData = new FormData();
  if (file) formData.append('archivo', file);
  formData.append('confirmo', 'true');
  if (segundoPago?.comprobante) {
    formData.append('comprobante_final', segundoPago.comprobante);
    if (segundoPago.fecha) formData.append('fecha_pago_final', segundoPago.fecha);
  }

  const res = await api.post(`/procesos/${procesoId}/acta-firmada`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });

  return res.data;
}

export async function descargarActaFirmada(procesoId: number): Promise<Blob> {
  const res = await api.get(`/procesos/${procesoId}/acta-firmada`, { responseType: 'blob' });
  return res.data;
}

// ── FACTURAS DEL ACTA ────────────────────────────────────────────────────────
export async function getFacturasProceso(procesoId: number): Promise<any> {
  const res = await api.get(`/procesos/${procesoId}/facturas`);
  return res.data;
}

export async function subirFacturaProceso(
  procesoId: number,
  tipo: 'cliente' | 'mediador',
  file: File
): Promise<any> {
  const formData = new FormData();
  formData.append('tipo', tipo);
  formData.append('archivo', file);
  const res = await api.post(`/procesos/${procesoId}/facturas`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return res.data;
}

export async function verFacturaProceso(procesoId: number, facturaId: number): Promise<Blob> {
  const res = await api.get(`/procesos/${procesoId}/facturas/${facturaId}/archivo`, {
    responseType: 'blob',
  });
  return res.data;
}

export async function corregirAcuerdo(procesoId: number, texto: string, motivo: string): Promise<any> {
  const res = await api.put(`/procesos/${procesoId}/acuerdo`, null, { params: { texto, motivo } });
  return res.data;
}

export async function getHistorialAcuerdo(procesoId: number): Promise<any[]> {
  const res = await api.get(`/procesos/${procesoId}/acuerdo/historial`);
  return res.data;
}

export async function solicitarActaNoAcuerdo(procesoId: number): Promise<any> {
  const res = await api.post(`/procesos/${procesoId}/solicitar-acta-no-acuerdo`);
  return res.data;
}

export async function marcarActaImpresa(procesoId: number): Promise<void> {
  await api.post(`/procesos/${procesoId}/acta-impresa`);
}

export async function descargarComprobanteFinal(procesoId: number): Promise<Blob> {
  const res = await api.get(`/procesos/${procesoId}/comprobante-final`, { responseType: 'blob' });
  return res.data;
}

export async function suspenderProceso(procesoId: number, motivo: string, baja = false): Promise<any> {
  const res = await api.put(`/procesos/${procesoId}/suspender`, null, { params: { motivo, baja } });
  return res.data;
}

export async function reactivarProceso(procesoId: number): Promise<any> {
  const res = await api.put(`/procesos/${procesoId}/reactivar`);
  return res.data;
}

export async function getDatosActa(procesoId: number): Promise<any> {
  const res = await api.get(`/procesos/${procesoId}/acta-datos`);
  return res.data;
}

export async function getDatosInvitacion(procesoId: number): Promise<any> {
  const res = await api.get(`/procesos/${procesoId}/invitacion-datos`);
  return res.data;
}

export async function getResumenActasMes(mes?: string): Promise<any> {
  const res = await api.get('/actas/resumen-mes', { params: mes ? { mes } : {} });
  return res.data;
}

export async function getActasAtrasadas(): Promise<any[]> {
  const res = await api.get('/actas/atrasadas');
  return res.data;
}

// ── Datos de facturación del proceso ──────────────────────────────────────────
export interface DatosFacturacion {
  origen: 'parte' | 'tercero';
  cliente_id?: number | null;
  tipo_identificacion: 'cedula' | 'ruc' | 'pasaporte';
  identificacion: string;
  nombre: string;
  direccion: string;
  email: string;
  telefono?: string | null;
  fecha_actualizacion?: string;
  actualizado_por?: string;
}

export async function getFacturacionProceso(procesoId: number): Promise<DatosFacturacion | null> {
  const res = await api.get(`/procesos/${procesoId}/facturacion`);
  return res.data || null;
}

export async function guardarFacturacionProceso(
  procesoId: number,
  datos: DatosFacturacion
): Promise<DatosFacturacion> {
  const res = await api.put(`/procesos/${procesoId}/facturacion`, null, {
    params: {
      origen: datos.origen,
      cliente_id: datos.origen === 'parte' ? datos.cliente_id : undefined,
      tipo_identificacion: datos.tipo_identificacion,
      identificacion: datos.identificacion,
      nombre: datos.nombre,
      direccion: datos.direccion,
      email: datos.email,
      telefono: datos.telefono || undefined
    }
  });
  return res.data;
}

// ── NÚMERO DE ACTA ───────────────────────────────────────────────────────────
export async function getMiNumeroActa(): Promise<any> {
  const res = await api.get('/numeros-acta/mio');
  return res.data;
}

// Con citaId, el número queda ligado a esa invitación rápida.
export async function pedirNumeroActa(citaId?: number): Promise<any> {
  const res = await api.post('/numeros-acta', null, {
    params: citaId ? { cita_id: citaId } : undefined,
  });
  return res.data;
}

// Pide el número de acta de un proceso (queda ligado a él).
export async function pedirNumeroActaProceso(procesoId: number): Promise<any> {
  const res = await api.post(`/procesos/${procesoId}/numero-acta`);
  return res.data;
}

// Solo administrador: devuelve un número anulado al mediador para que continúe con el mismo.
export async function reactivarNumeroActa(id: number): Promise<any> {
  const res = await api.post(`/numeros-acta/${id}/reactivar`);
  return res.data;
}

// Solo administrador: desbloquea un acta que pasó las 48 horas.
export async function desbloquearActa(bloqueoId: number): Promise<any> {
  const res = await api.post(`/bloqueos-acta/${bloqueoId}/desbloquear`);
  return res.data;
}

export async function getNumerosActaAdmin(): Promise<{ pendientes: any[]; anulados: any[]; bloqueados: any[] }> {
  const res = await api.get('/numeros-acta');
  return res.data;
}

export async function getAnulacionesNumeros(): Promise<any[]> {
  const res = await api.get('/numeros-acta/anulaciones');
  return res.data;
}

export async function pedirAnulacionNumeroActa(id: number, motivo: string): Promise<any> {
  const formData = new FormData();
  formData.append('motivo', motivo);
  const res = await api.post(`/numeros-acta/${id}/pedir-anulacion`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return res.data;
}

export async function anularNumeroActa(id: number, motivo: string): Promise<any> {
  const formData = new FormData();
  formData.append('motivo', motivo);
  const res = await api.post(`/numeros-acta/${id}/anular`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return res.data;
}

// Lista central de facturas y comprobantes de pago ya subidos en los procesos.
export interface FiltrosFacturasPagos {
  q?: string;
  tipo?: string;
  usuario_id?: number | string;
  sucursal_id?: number | string;
  fecha_desde?: string;
  fecha_hasta?: string;
  cliente_id?: number | string;
}

export async function getFacturasPagos(filters?: FiltrosFacturasPagos): Promise<any[]> {
  const res = await api.get('/facturas-pagos', { params: filters });
  return res.data;
}

export async function getFacturasPagosFaltantes(filters?: { q?: string; sucursal_id?: string; usuario_id?: string }): Promise<any[]> {
  const res = await api.get('/facturas-pagos/faltantes', { params: filters });
  return res.data;
}

export async function descargarFacturasPagosExcel(filters?: FiltrosFacturasPagos): Promise<Blob> {
  const res = await api.get('/facturas-pagos/exportar-excel', {
    params: filters,
    responseType: 'blob',
  });
  return res.data;
}

// Ficha del cliente: datos, procesos donde participa y sus citas.
export async function getFichaCliente(id: number | string): Promise<any> {
  const res = await api.get(`/clientes/${id}/ficha`);
  return res.data;
}

// El administrador pasa un proceso a otro mediador de la sucursal (o a sí mismo).
export async function reasignarMediadorProceso(procesoId: number, nuevoUsuarioId: number) {
  const res = await api.post(`/procesos/${procesoId}/reasignar-mediador`, null, {
    params: { nuevo_usuario_id: nuevoUsuarioId },
  });
  return res.data;
}
