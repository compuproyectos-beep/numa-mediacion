'use client';

import { useEffect, useMemo, useState } from 'react';
import { Receipt, Pencil, AlertTriangle } from 'lucide-react';
import { Modal, ErrorAlert, InputField, SelectField } from '@/components/ui';
import {
  getFacturacionProceso,
  guardarFacturacionProceso,
  getPartesProceso,
  DatosFacturacion
} from '@/lib/services';

interface Props {
  procesoId: number;
  // El mediador puede editar hasta subir el acta firmada; el admin siempre.
  editable: boolean;
  // Avisa al padre si ya hay datos (se exigen antes de subir el acta).
  onEstado?: (tieneDatos: boolean) => void;
  // El acta ya se subió (procesos anteriores a esta regla pueden no tener datos).
  finalizado?: boolean;
  // Estado del proceso: el aviso amarillo solo sale cuando ya se cerró con acuerdo.
  estado?: string;
}

interface Opcion {
  clave: string; // "c:<cliente_id>" o "tercero"
  etiqueta: string;
  datos?: Omit<DatosFacturacion, 'origen'>;
}


const cedulaValida = (cedula: string) => {
  if (!/^\d{10}$/.test(cedula)) return false;
  const provincia = parseInt(cedula.slice(0, 2), 10);
  if (provincia < 1 || provincia > 24) return false;
  if (parseInt(cedula[2], 10) >= 6) return false;
  const coef = [2, 1, 2, 1, 2, 1, 2, 1, 2];
  let suma = 0;
  for (let i = 0; i < 9; i++) {
    let v = parseInt(cedula[i], 10) * coef[i];
    if (v >= 10) v -= 9;
    suma += v;
  }
  return (10 - (suma % 10)) % 10 === parseInt(cedula[9], 10);
};

// Devuelve el mensaje de error del número de identificación, o '' si está bien.
const errorIdentificacion = (tipo: string, num: string): string => {
  if (!num) return '';
  if (tipo === 'cedula') {
    if (!/^\d+$/.test(num)) return 'Solo números';
    if (num.length < 10) return '';
    return cedulaValida(num) ? '' : 'Cédula inválida';
  }
  if (tipo === 'ruc') {
    if (!/^\d+$/.test(num)) return 'Solo números';
    if (num.length < 13) return '';
    if (num.endsWith('000')) return 'RUC inválido';
    if (parseInt(num[2], 10) < 6 && !cedulaValida(num.slice(0, 10))) return 'RUC inválido';
    return '';
  }
  if (!/^[A-Za-z0-9]{5,20}$/.test(num)) return 'Pasaporte: 5 a 20 letras o números';
  return '';
};

const correoValido = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim());

const soloDigitos = (v: string, max: number) => v.replace(/\D/g, '').slice(0, max);

const TIPOS = { cedula: 'Cédula', ruc: 'RUC', pasaporte: 'Pasaporte' } as const;

const VACIO: DatosFacturacion = {
  origen: 'tercero',
  cliente_id: null,
  tipo_identificacion: 'cedula',
  identificacion: '',
  nombre: '',
  direccion: '',
  email: '',
  telefono: ''
};

// Bloque "Datos de facturación": a nombre de quién se emite la factura (la
// factura se hace en el sistema propio del centro; aquí solo se guardan los
// datos). Obligatorio antes de subir la documentación y el comprobante.
export default function FacturacionProceso({ procesoId, editable, onEstado, finalizado, estado }: Props) {
  const [datos, setDatos] = useState<DatosFacturacion | null>(null);
  const [partes, setPartes] = useState<any[]>([]);
  const [cargando, setCargando] = useState(true);

  const [abierto, setAbierto] = useState(false);
  const [form, setForm] = useState<DatosFacturacion>(VACIO);
  const [seleccion, setSeleccion] = useState('');
  const [error, setError] = useState('');
  const [guardando, setGuardando] = useState(false);

  const cargar = async () => {
    try {
      const [f, p] = await Promise.all([
        getFacturacionProceso(procesoId),
        getPartesProceso(procesoId).catch(() => [])
      ]);
      setDatos(f);
      setPartes(p);
      onEstado?.(!!f);
    } catch {
      setDatos(null);
      onEstado?.(false);
    } finally {
      setCargando(false);
    }
  };

  useEffect(() => {
    cargar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [procesoId]);

  // Opciones de "Facturar a": cada parte y cada empresa que representan.
  const opciones: Opcion[] = useMemo(() => {
    const vistas = new Set<number>();
    const lista: Opcion[] = [];
    for (const p of partes) {
      const rol = p.rol === 'solicitante' ? 'solicitante' : 'invitado';
      if (!vistas.has(p.cliente_id)) {
        vistas.add(p.cliente_id);
        const esEmpresa = p.tipo === 'empresa';
        lista.push({
          clave: `c:${p.cliente_id}`,
          etiqueta: esEmpresa
            ? `${p.nombre} (empresa · ${rol})`
            : `${p.nombre} ${p.apellido || ''}`.trim() + ` (${rol})`,
          datos: {
            cliente_id: p.cliente_id,
            tipo_identificacion: esEmpresa ? 'ruc' : 'cedula',
            identificacion: (esEmpresa ? p.ruc : p.cedula) || '',
            nombre: esEmpresa ? p.nombre : `${p.nombre} ${p.apellido || ''}`.trim(),
            direccion: p.direccion || '',
            email: p.email || '',
            telefono: p.telefono || ''
          }
        });
      }
      if (p.empresa_representada_id && !vistas.has(p.empresa_representada_id)) {
        vistas.add(p.empresa_representada_id);
        lista.push({
          clave: `c:${p.empresa_representada_id}`,
          etiqueta: `${p.empresa_nombre} (empresa que representa ${p.nombre})`,
          datos: {
            cliente_id: p.empresa_representada_id,
            tipo_identificacion: 'ruc',
            identificacion: p.empresa_ruc || '',
            nombre: p.empresa_nombre || '',
            direccion: p.empresa_direccion || '',
            email: p.empresa_email || '',
            telefono: p.empresa_telefono || ''
          }
        });
      }
    }
    lista.push({ clave: 'tercero', etiqueta: 'Otra persona o empresa (no es parte del proceso)' });
    return lista;
  }, [partes]);

  const abrir = () => {
    setError('');
    getPartesProceso(procesoId).then(setPartes).catch(() => {});
    if (datos) {
      setForm({ ...VACIO, ...datos, telefono: datos.telefono || '' });
      setSeleccion(datos.origen === 'parte' && datos.cliente_id ? `c:${datos.cliente_id}` : 'tercero');
    } else {
      setForm(VACIO);
      setSeleccion('');
    }
    setAbierto(true);
  };

  const elegir = (clave: string) => {
    setSeleccion(clave);
    const op = opciones.find((o) => o.clave === clave);
    if (!op) return;
    if (op.datos) {
      setForm({ origen: 'parte', ...op.datos });
    } else {
      setForm({ ...VACIO, origen: 'tercero' });
    }
  };

  const cambiar = (campo: keyof DatosFacturacion, valor: string) =>
    setForm((f) => ({ ...f, [campo]: valor }));

  const guardar = async () => {
    if (!seleccion) {
      setError('Elige a nombre de quién va la factura');
      return;
    }
    const t = form.tipo_identificacion;
    const num = (form.identificacion || '').trim();
    if (!num) return setError('Escribe el número de identificación');
    if (t === 'cedula' && num.length !== 10) return setError('La cédula debe tener 10 dígitos');
    if (t === 'ruc' && num.length !== 13) return setError('El RUC debe tener 13 dígitos');
    const eId = errorIdentificacion(t, num);
    if (eId) return setError(eId);
    if (!(form.nombre || '').trim()) return setError('Escribe el nombre o razón social');
    if ((form.direccion || '').trim().length < 3) return setError('La dirección debe tener al menos 3 caracteres');
    if (!correoValido(form.email || '')) return setError('Escribe un correo válido');
    if (form.telefono && !/^\d{7,10}$/.test(form.telefono))
      return setError('El teléfono debe tener entre 7 y 10 dígitos');
    setGuardando(true);
    setError('');
    try {
      const nuevo = await guardarFacturacionProceso(procesoId, form);
      setDatos(nuevo);
      onEstado?.(true);
      setAbierto(false);
    } catch (e: any) {
      setError(e?.response?.data?.detail || 'No se pudieron guardar los datos de facturación');
    } finally {
      setGuardando(false);
    }
  };

  if (cargando) return null;

  return (
    <div className="card p-4 mb-4">
      <div className="flex items-center justify-between gap-3 flex-wrap mb-2">
        <h3 className="text-base font-bold text-numa-900 inline-flex items-center gap-2">
          <Receipt className="w-4 h-4 text-numa-800" /> Datos de facturación
        </h3>
        {editable && (
          <button type="button" onClick={abrir} className="btn-secondary btn-sm">
            <Pencil className="w-3.5 h-3.5" /> {datos ? 'Editar' : 'Completar datos'}
          </button>
        )}
      </div>

      {datos ? (
        <div className="text-sm text-numa-800 grid sm:grid-cols-2 gap-x-6 gap-y-1">
          <p>
            <span className="text-numa-800">Facturar a: </span>
            <strong>{datos.nombre}</strong>
            {datos.origen === 'tercero' && (
              <span className="text-xs text-numa-700"> (no es parte del proceso)</span>
            )}
          </p>
          <p>
            <span className="text-numa-800">{TIPOS[datos.tipo_identificacion]}: </span>
            {datos.identificacion}
          </p>
          <p>
            <span className="text-numa-800">Dirección: </span>
            {datos.direccion}
          </p>
          <p>
            <span className="text-numa-800">Correo: </span>
            {datos.email}
          </p>
          {datos.telefono && (
            <p>
              <span className="text-numa-800">Teléfono: </span>
              {datos.telefono}
            </p>
          )}
        </div>
      ) : finalizado ? (
        <p className="text-sm text-numa-800">
          No se registraron datos de facturación para este proceso.
        </p>
      ) : estado !== 'cerrado_con_acuerdo' ? (
        <p className="text-sm text-numa-800">
          Aún no se indica a nombre de quién va la factura. Puedes completarlo ahora o más
          adelante; es obligatorio antes de subir la documentación.
        </p>
      ) : (
        <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-sm px-3 py-2 inline-flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          Falta indicar a nombre de quién va la factura. Es obligatorio antes de subir la documentación y
          el comprobante de pago.
        </p>
      )}

      <Modal open={abierto} onClose={() => setAbierto(false)} title="Datos de facturación">
        {error && (
          <div className="mb-4">
            <ErrorAlert message={error} />
          </div>
        )}
        <div className="space-y-3">
          <SelectField label="Facturar a" value={seleccion} onChange={(e) => elegir(e.target.value)}>
            <option value="">Seleccione</option>
            {opciones.map((o) => (
              <option key={o.clave} value={o.clave}>
                {o.etiqueta}
              </option>
            ))}
          </SelectField>

          {seleccion && (
            <>
              <div className="grid grid-cols-3 gap-3">
                <SelectField
                  label="Identificación"
                  value={form.tipo_identificacion}
                  onChange={(e) => setForm((f) => ({ ...f, tipo_identificacion: e.target.value as any, identificacion: '' }))}
                >
                  <option value="cedula">Cédula</option>
                  <option value="ruc">RUC</option>
                  <option value="pasaporte">Pasaporte</option>
                </SelectField>
                <div className="col-span-2">
                  <InputField
                    label="Número"
                    value={form.identificacion}
                    onChange={(e) =>
                      cambiar(
                        'identificacion',
                        form.tipo_identificacion === 'pasaporte'
                          ? e.target.value.replace(/[^A-Za-z0-9]/g, '').slice(0, 20)
                          : soloDigitos(e.target.value, form.tipo_identificacion === 'ruc' ? 13 : 10)
                      )
                    }
                    inputMode={form.tipo_identificacion === 'pasaporte' ? undefined : 'numeric'}
                    error={errorIdentificacion(form.tipo_identificacion, form.identificacion || '') || undefined}
                  />
                </div>
              </div>
              <InputField
                label="Nombre o razón social"
                value={form.nombre}
                onChange={(e) => cambiar('nombre', e.target.value)}
              />
              <InputField
                label="Dirección (puede ser solo la ciudad)"
                value={form.direccion}
                onChange={(e) => cambiar('direccion', e.target.value)}
              />
              <div className="grid sm:grid-cols-2 gap-3">
                <InputField
                  label="Correo (ahí llega la factura)"
                  type="email"
                  value={form.email}
                  onChange={(e) => cambiar('email', e.target.value.slice(0, 100))}
                  error={form.email && !correoValido(form.email) ? 'Correo no válido' : undefined}
                />
                <InputField
                  label="Teléfono (opcional)"
                  value={form.telefono || ''}
                  inputMode="numeric"
                  onChange={(e) => cambiar('telefono', soloDigitos(e.target.value, 10))}
                />
              </div>
              {form.origen === 'parte' && (
                <p className="text-xs text-numa-800">
                  Los datos se copian de la ficha del cliente. Si los cambias aquí, solo cambian
                  para esta factura, no en la ficha del cliente.
                </p>
              )}
            </>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => setAbierto(false)} className="btn-secondary">
              Cancelar
            </button>
            <button type="button" onClick={guardar} disabled={guardando} className="btn-primary">
              {guardando ? 'Guardando...' : 'Guardar'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
