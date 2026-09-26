// Auth
export interface LoginCredentials {
  username: string;
  password: string;
}

export interface AuthResponse {
  access_token: string;
  token_type: string;
}

export interface User {
  id: number;
  username: string;
  nombre?: string;
  apellido?: string;
  email: string;
  rol: 'administrador' | 'usuario';
  activo: boolean;
  debe_cambiar_password?: boolean;

  sucursal_id?: number;
  sucursal?: string;
  ciudad?: string;
  provincia?: string;
}

// Dashboard
export interface DashboardStats {
  total_actas: number;
  por_estado: {
    borrador: number;
    enviado: number;
    aprobado: number;
    rechazado: number;
  };
}

// Actas
export type EstadoActa = 'borrador' | 'enviado' | 'aprobado' | 'rechazado';

export interface CreateActaPayload {
  codigo_acta?: string;
  sucursal_id?: number;
  descripcion: string;
  cliente_demandante_id: number;
  cliente_demandado_id: number;
}

export interface ActaHistorial {
  id: number;
  estado_anterior: EstadoActa;
  estado_nuevo: EstadoActa;
  fecha: string;
  usuario: string;
  observacion?: string;
  accion?: string;
  fecha_registro?: string;
}

export interface UpdateEstadoPayload {
  estado: EstadoActa;
  observacion?: string;
}

// Ciudades
export interface Ciudad {
  id: number;
  nombre: string;
  provincia: string;
  activa: boolean;
}

export interface CreateCiudadPayload {
  nombre: string;
  provincia: string;
}

// Sucursales
export interface Sucursal {
  id: number;
  nombre: string;
  direccion: string;
  telefono: string;
  ciudad_id: number;
  ciudad_nombre?: string;
  activa: boolean;
}

export interface CreateSucursalPayload {
  nombre: string;
  direccion: string;
  telefono: string;
  ciudad_id: number;
   codigo?: string;
  prefijo?: string;
}

// Clientes
export interface Cliente {
  id: number;
  nombre: string;
  apellido: string;
  cedula: string;
  email: string;
  telefono: string;
  ciudad_id?: number;
  direccion?: string;
  ciudad?: string;
  provincia?: string;
  activo: boolean;
}

export interface CreateClientePayload {
  nombre: string;
  apellido: string;
  cedula: string;
  email: string;
  telefono: string;
  ciudad_id?: number;
  direccion?: string;
}

// Generic API response
export interface ApiError {
  detail: string;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  size: number;
}

export interface Acta {
  id: number;
  codigo_acta?: string;
  sucursal_id?: number;
  descripcion: string;
  estado: EstadoActa;
  fecha_creacion: string;
  usuario: string;
  ciudad?: string;
  provincia?: string;
  sucursal?: string;
}


export interface ProcesoMediacion {
  id: number;
  codigo_proceso: string;
  sucursal_id: number;
  tema: string;
  estado: string;
  fecha_creacion: string;
  demandante: string;
  demandante_cedula: string;
  demandado: string;
  demandado_cedula: string;
  sucursal: string;
  ciudad: string;
  usuario: string;
  usuario_id: number;
  finalizado?: boolean;
  fecha_acuerdo?: string | null;
  acta_final_id?: number | null;
  // true cuando este es el proceso "cerrado con acuerdo" más antiguo sin
  // acta subida de su mediador — el único que se puede subir de inmediato
  // (ver la fila FIFO de subir_acta_final_proceso en el backend). Los
  // demás pendientes del mismo mediador quedan bloqueados hasta que se
  // suba este.
  acta_primero_en_fila?: boolean;
}

export interface CreateProcesoPayload {
  cliente_demandante_id: number;
  cliente_demandado_id: number;
  sucursal_id?: number;
  tema: string;
}