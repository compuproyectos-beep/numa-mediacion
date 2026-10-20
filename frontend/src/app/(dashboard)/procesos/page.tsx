'use client';

import { mayusInicial } from '@/lib/texto';
import { etapaActaBadge } from '@/lib/etapaActa';
import { conActa } from '@/lib/actaProceso';
import { estadoLabelProceso, estadoPill, estadoFranja } from '@/lib/estados';
import { useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Plus, Check, ChevronRight } from 'lucide-react';
import {
  PageHeader,
  Spinner,
  EmptyState,
  Modal,
  SelectField,
  TextareaField,
  InputField,
  ErrorAlert,
  Pill
} from '@/components/ui';

import {
  getProcesos,
  createProceso,
  getClientes,
  createCliente,
  getUsuarios,
  getCitas
} from '@/lib/services';
import { getCiudadesCached, getSucursalesCached } from '@/lib/catalogCache';

import { isAdmin, getUser } from '@/lib/auth';
import { accionProceso, hoyEcuador } from '@/lib/accionProceso';

// Qué le toca hacer a quien mira la lista en este proceso (el botón lo dice
// en vez de un "Gestionar" genérico).
const accionDe = (p: any) => accionProceso(p, isAdmin());

// Parte de la invitación rápida que se registrará en Clientes al crear el proceso.
function NuevoClienteBox({
  etiqueta,
  n,
  onChange,
  onQuitar
}: {
  etiqueta: string;
  n: {
    tipo: 'persona' | 'empresa';
    cedula: string;
    nombre: string;
    apellido: string;
    razon_social?: string;
    ruc?: string;
    representante_nombre?: string;
    representante_cedula?: string;
  };
  onChange: (n: any) => void;
  onQuitar: () => void;
}) {
  return (
    <div className="rounded-sm border border-amber-300 bg-amber-50 p-3 space-y-2">
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs font-bold uppercase tracking-wider text-amber-900">
          {etiqueta} · cliente nuevo
        </p>
        <button type="button" onClick={onQuitar} className="text-xs underline text-numa-700">
          Elegir otro cliente
        </button>
      </div>
      {n.tipo === 'empresa' ? (
        <p className="text-sm text-numa-800">
          <b>{n.razon_social}</b> · RUC {n.ruc} · rep. legal {n.representante_nombre} (C.I.{' '}
          {n.representante_cedula}). Se registrará con estos datos.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <InputField
              label="Nombres"
              value={n.nombre}
              onChange={(e) => onChange({ ...n, nombre: e.target.value })}
            />
            <InputField
              label="Apellidos"
              value={n.apellido}
              onChange={(e) => onChange({ ...n, apellido: e.target.value })}
            />
          </div>
          <p className="text-xs text-numa-600">Cédula {n.cedula} (no se puede cambiar aquí).</p>
        </>
      )}
      <p className="text-xs text-numa-600">
        Se registra en Clientes al crear el proceso. El teléfono y el correo se completan después.
      </p>
    </div>
  );
}

export default function ProcesosPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Permite llegar aquí con un filtro de estado ya aplicado, por ejemplo
  // desde las tarjetas del dashboard (/procesos?estado=cerrado_con_acuerdo).
  const estadoDesdeUrl = searchParams?.get('estado') || '';

  // Igual con la búsqueda: desde Clientes se llega con la cédula ya escrita
  // (/procesos?q=1712345675) para ver todos los procesos de esa persona.
  const busquedaDesdeUrl = searchParams?.get('q') || '';

  // Permite llegar aquí con la intención de crear de una vez, por ejemplo
  // desde el botón "Crear tu primer proceso" del dashboard cuando un
  // mediador nuevo todavía no tiene ningún proceso.
  const crearDesdeUrl = searchParams?.get('crear') === '1';

  // Llegar con ?cita=ID (desde la Agenda) deja elegida esa invitación rápida.
  const citaDesdeUrl = searchParams?.get('cita') || '';
  const citaAplicada = useRef(false);

  const [procesos, setProcesos] = useState<any[]>([]);
  const [clientes, setClientes] = useState<any[]>([]);
  const [sucursales, setSucursales] = useState<any[]>([]);
  const [ciudades, setCiudades] = useState<any[]>([]);
  const [mediadores, setMediadores] = useState<any[]>([]);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const [showCreate, setShowCreate] = useState(false);

  // El formulario de "Nuevo Proceso" se muestra como flujo por pasos, para
  // que un mediador nuevo no se enfrente a un formulario largo de una sola
  // vez: 1) partes involucradas, 2) tema, 3) confirmación con resumen.
  const PASOS_CREAR = [
    { numero: 1, titulo: 'Partes' },
    { numero: 2, titulo: 'Tema' },
    { numero: 3, titulo: 'Confirmar' }
  ] as const;
  const [paso, setPaso] = useState(1);

  // Filtros rápidos (un clic) sobre la lista ya cargada.
  const [rapido, setRapido] = useState<'' | 'pendientes' | 'hoy' | 'acta'>('');

  const [filters, setFilters] = useState({
    q: busquedaDesdeUrl,
    estado: estadoDesdeUrl,
    ciudad_id: '',
    sucursal_id: '',
    usuario_id: '',
    fecha_desde: '',
    fecha_hasta: ''
  });

  const [form, setForm] = useState({
    cliente_demandante_id: '',
    cliente_demandado_id: '',
    sucursal_id: '',
    tema: '',
    cita_rapida_id: ''
  });

  // Invitaciones rápidas de la Agenda que todavía no tienen proceso.
  const [citasRapidas, setCitasRapidas] = useState<any[]>([]);
  const [avisoCitaRapida, setAvisoCitaRapida] = useState('');
  // Partes de la invitación rápida que aún no están en Clientes: se registran
  // solas al crear el proceso. El nombre y el apellido se pueden corregir aquí.
  type NuevoCliente = {
    tipo: 'persona' | 'empresa';
    cedula: string;
    nombre: string;
    apellido: string;
    razon_social?: string;
    ruc?: string;
    representante_nombre?: string;
    representante_cedula?: string;
  };
  const [nuevos, setNuevos] = useState<{ sol: NuevoCliente | null; inv: NuevoCliente | null }>({
    sol: null,
    inv: null
  });

  const visibles = procesos.filter((p) =>
    rapido === 'pendientes'
      ? accionDe(p).urgente
      : rapido === 'hoy'
      ? String(p.proxima_cita_fecha || '').slice(0, 10) === hoyEcuador()
      : rapido === 'acta'
      ? conActa(p) &&
        (p.etapa_acta === 'falta_acta' || p.etapa_acta === 'falta_firmada')
      : true
  );

  const load = async () => {
    setLoading(true);

    try {
      const data = await getProcesos({
        q: filters.q || undefined,
        estado: filters.estado || undefined,
        ciudad_id: filters.ciudad_id || undefined,
        sucursal_id: filters.sucursal_id || undefined,
        usuario_id: filters.usuario_id || undefined,
        fecha_desde: filters.fecha_desde || undefined,
        fecha_hasta: filters.fecha_hasta || undefined
      });

      setProcesos(data);
    } catch {
      setError('Error al cargar procesos');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();

    getClientes().then(setClientes).catch(() => setClientes([]));
    getSucursalesCached().then(setSucursales).catch(() => setSucursales([]));
    getCiudadesCached(true).then(setCiudades).catch(() => setCiudades([]));
    if (isAdmin()) getUsuarios().then(setMediadores).catch(() => setMediadores([]));

    const yo = getUser();
    if (yo) {
      getCitas({ usuario_id: yo.id })
        .then((cs) =>
          setCitasRapidas(
            cs.filter((c: any) => !c.proceso_id && c.partes_rapidas && c.estado !== 'cancelada')
          )
        )
        .catch(() => setCitasRapidas([]));
    }

    if (crearDesdeUrl) abrirCrear();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const limpiarFiltros = () => {
    setRapido("");
    setFilters({
      q: '',
      estado: '',
      ciudad_id: '',
      sucursal_id: '',
      usuario_id: '',
      fecha_desde: '',
      fecha_hasta: ''
    });

    getProcesos().then(setProcesos);
  };

  const abrirCrear = () => {
    setNuevos({ sol: null, inv: null });
    setForm({
      cliente_demandante_id: '',
      cliente_demandado_id: '',
      sucursal_id: '',
      tema: '',
      cita_rapida_id: ''
    });
    setAvisoCitaRapida('');
    setPaso(1);
    setError('');
    setShowCreate(true);
  };

  // Busca en Clientes a la parte de la invitación rápida (por cédula, o por
  // RUC / cédula del representante si es empresa).
  const buscarCliente = (x: any) => {
    if (x.tipo === 'empresa') {
      return clientes.find(
        (c: any) =>
          c.tipo === 'empresa' &&
          ((x.ruc && c.ruc === x.ruc) ||
            (x.representante_cedula && c.representante_cedula === x.representante_cedula))
      );
    }
    return clientes.find((c: any) => c.tipo !== 'empresa' && c.cedula === x.cedula);
  };

  const nombreParteRapida = (x: any) =>
    x.tipo === 'empresa'
      ? `${x.razon_social} (rep. legal ${x.representante_nombre}, C.I. ${x.representante_cedula})`
      : `${x.nombre} (C.I. ${x.cedula})`;

  // Parte de la invitación rápida -> datos para registrarla como cliente.
  // El nombre completo se reparte en nombres y apellidos (se puede corregir).
  // Una empresa sin RUC no se puede registrar sola (el RUC es obligatorio).
  const nuevoDesdeParte = (x: any): NuevoCliente | null => {
    if (x.tipo === 'empresa') {
      if (!x.ruc) return null;
      return {
        tipo: 'empresa',
        cedula: '',
        nombre: x.razon_social || '',
        apellido: '',
        razon_social: x.razon_social,
        ruc: x.ruc,
        representante_nombre: x.representante_nombre,
        representante_cedula: x.representante_cedula
      };
    }
    const palabras = String(x.nombre || '').trim().split(/\s+/).filter(Boolean);
    const corte = Math.floor(palabras.length / 2);
    return {
      tipo: 'persona',
      cedula: x.cedula,
      nombre: palabras.slice(0, corte || 1).join(' '),
      apellido: palabras.slice(corte || 1).join(' ')
    };
  };

  // Al elegir una invitación rápida se llenan solos los datos que ya se
  // escribieron en la Agenda. Las partes que aún no están en Clientes se avisan.
  const elegirCitaRapida = (id: string) => {
    if (!id) {
      setForm((f) => ({ ...f, cita_rapida_id: '' }));
      setAvisoCitaRapida('');
      setNuevos({ sol: null, inv: null });
      return;
    }
    const cita = citasRapidas.find((c: any) => String(c.id) === String(id));
    if (!cita) return;

    const sol = cita.partes_rapidas?.solicitantes || [];
    const inv = cita.partes_rapidas?.invitados || [];
    const cSol = sol.length ? buscarCliente(sol[0]) : undefined;
    const cInv = inv.length ? buscarCliente(inv[0]) : undefined;
    const nuevoSol = sol.length && !cSol ? nuevoDesdeParte(sol[0]) : null;
    const nuevoInv = inv.length && !cInv ? nuevoDesdeParte(inv[0]) : null;
    setNuevos({ sol: nuevoSol, inv: nuevoInv });
    // Solo se avisa de lo que NO se registrará solo: las demás personas de
    // cada lado y las empresas sin RUC.
    const faltan = [
      ...sol.slice(nuevoSol || cSol ? 1 : 0),
      ...inv.slice(nuevoInv || cInv ? 1 : 0)
    ].filter((x: any) => !buscarCliente(x));

    setForm((f) => ({
      ...f,
      cita_rapida_id: String(cita.id),
      sucursal_id: String(cita.sucursal_id),
      cliente_demandante_id: cSol ? String(cSol.id) : '',
      cliente_demandado_id: cInv ? String(cInv.id) : '',
      // El tema se sugiere con el asunto escrito en el documento de la invitación
      // (o el tema con que se agendó); se puede corregir.
      tema: !f.tema
        ? cita.documento_asunto || (cita.tema && cita.tema !== 'Invitación rápida' ? cita.tema : '')
        : f.tema
    }));

    const avisos: string[] = [];
    if (faltan.length) {
      avisos.push(
        `Aún no están en Clientes y no se registran solos: ${faltan.map(nombreParteRapida).join('; ')}. Regístralos en "Clientes" (las empresas necesitan el RUC) para poder usarlos en el proceso.`
      );
    }
    if (nuevoSol || nuevoInv) {
      avisos.push(
        'Lo que aún no está en Clientes se registrará solo al crear el proceso; revisa los nombres abajo. El teléfono y el correo se completan después en Clientes.'
      );
    }
    if (sol.length > 1 || inv.length > 1) {
      avisos.push(
        'La invitación tiene varias personas en un lado: elige aquí a la principal y agrega las demás desde la pantalla del proceso.'
      );
    }
    setAvisoCitaRapida(avisos.join(' '));
  };

  // Llegada desde la Agenda con ?cita=ID: se elige esa invitación en cuanto
  // cargan las invitaciones y los clientes.
  useEffect(() => {
    if (!citaDesdeUrl || citaAplicada.current) return;
    if (!citasRapidas.length || !clientes.length) return;
    citaAplicada.current = true;
    elegirCitaRapida(citaDesdeUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [citasRapidas, clientes, citaDesdeUrl]);

  const cerrarCrear = () => {
    setShowCreate(false);
    setError('');
    setPaso(1);
  };

  // Paso 1: sucursal (solo admin) + solicitante + invitado.
  const validarPaso1 = () => {
    if (
      (!form.cliente_demandante_id && !nuevos.sol) ||
      (!form.cliente_demandado_id && !nuevos.inv) ||
      (isAdmin() && !form.sucursal_id)
    ) {
      setError('Completa sucursal, solicitante e invitado');
      return false;
    }

    for (const n of [nuevos.sol, nuevos.inv]) {
      if (n && n.tipo === 'persona' && (!n.nombre.trim() || !n.apellido.trim())) {
        setError('Escribe los nombres y los apellidos de la persona que se va a registrar');
        return false;
      }
    }

    if (
      nuevos.sol && nuevos.inv &&
      (nuevos.sol.tipo === 'empresa' ? nuevos.sol.ruc : nuevos.sol.cedula) ===
        (nuevos.inv.tipo === 'empresa' ? nuevos.inv.ruc : nuevos.inv.cedula)
    ) {
      setError('Solicitante e invitado no pueden ser iguales');
      return false;
    }

    if (form.cliente_demandante_id && form.cliente_demandante_id === form.cliente_demandado_id) {
      setError('Solicitante e invitado no pueden ser iguales');
      return false;
    }

    setError('');
    return true;
  };

  // Paso 2: tema del proceso.
  const validarPaso2 = () => {
    if (!form.tema.trim()) {
      setError('Describe el tema del proceso');
      return false;
    }

    setError('');
    return true;
  };

  const irSiguientePaso = () => {
    if (paso === 1 && !validarPaso1()) return;
    if (paso === 2 && !validarPaso2()) return;

    setPaso((p) => Math.min(p + 1, PASOS_CREAR.length));
  };

  const irPasoAnterior = () => {
    setError('');
    setPaso((p) => Math.max(p - 1, 1));
  };

  const etiquetaCliente = (c: any) =>
    c.tipo === 'empresa'
      ? `${c.nombre} (empresa · RUC ${c.ruc || '—'})`
      : `${c.nombre} ${c.apellido}`;

  const nombreCliente = (id: string) =>
    clientes.find((c: any) => String(c.id) === String(id));

  const nombreSucursal = (id: string) =>
    sucursales.find((s: any) => String(s.id) === String(id));

  const handleCreate = async () => {
    setError('');

    // Si algo quedó incompleto (por ejemplo, se llegó aquí saltando pasos),
    // se regresa al paso correspondiente en vez de solo mostrar el error
    // con el usuario ya en el paso de confirmación.
    if (!validarPaso1()) {
      setPaso(1);
      return;
    }

    if (!validarPaso2()) {
      setPaso(2);
      return;
    }

    setSaving(true);

    try {
      // Primero se registran en Clientes las partes de la invitación que
      // faltaban. Cada una se quita de la lista apenas se crea, para que un
      // reintento no la cree dos veces.
      let idSol = form.cliente_demandante_id;
      let idInv = form.cliente_demandado_id;
      const registrar = async (n: NuevoCliente) => {
        const c: any = await createCliente(
          (n.tipo === 'empresa'
            ? {
                tipo: 'empresa',
                razon_social: n.razon_social,
                ruc: n.ruc,
                representante_nombre: n.representante_nombre,
                representante_cedula: n.representante_cedula
              }
            : { tipo: 'persona', cedula: n.cedula, nombre: n.nombre.trim(), apellido: n.apellido.trim() }) as any
        );
        return String(c.id);
      };
      if (nuevos.sol) {
        idSol = await registrar(nuevos.sol);
        setNuevos((a) => ({ ...a, sol: null }));
        setForm((f) => ({ ...f, cliente_demandante_id: idSol }));
      }
      if (nuevos.inv) {
        idInv = await registrar(nuevos.inv);
        setNuevos((a) => ({ ...a, inv: null }));
        setForm((f) => ({ ...f, cliente_demandado_id: idInv }));
      }
      if (nuevos.sol || nuevos.inv) getClientes().then(setClientes).catch(() => {});

      const nuevoProceso = await createProceso({
        cliente_demandante_id: Number(idSol),
        cliente_demandado_id: Number(idInv),
        tema: form.tema,
        ...(isAdmin() ? { sucursal_id: Number(form.sucursal_id) } : {}),
        ...(form.cita_rapida_id ? { cita_rapida_id: Number(form.cita_rapida_id) } : {})
      });

      setShowCreate(false);
      setPaso(1);

      setForm({
        cliente_demandante_id: '',
        cliente_demandado_id: '',
        sucursal_id: '',
        tema: '',
        cita_rapida_id: ''
      });

      // Se navega directo al proceso recién creado en vez de depender de
      // que el usuario lo encuentre y le dé clic en la lista: así se evita
      // el problema de que la fila nueva no respondiera al primer clic.
      if (nuevoProceso?.id) {
        router.push(`/procesos/${nuevoProceso.id}`);
      } else {
        load();
      }
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'Error al crear proceso');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Procesos de Mediación"
        subtitle="Gestión de procesos, invitaciones y avances"
        action={
          <button onClick={abrirCrear} className="btn-primary">
            <Plus className="w-4 h-4" />
            Nuevo Proceso
          </button>
        }
      />

      {error && !showCreate && (
        <div className="mb-4">
          <ErrorAlert message={error} />
        </div>
      )}

      {(() => {
        const hoy = hoyEcuador();
        const cumple = (p: any, f: string) =>
          f === 'pendientes'
            ? accionDe(p).urgente
            : f === 'hoy'
            ? String(p.proxima_cita_fecha || '').slice(0, 10) === hoy
            : f === 'acta'
            ? conActa(p) &&
              (p.etapa_acta === 'falta_acta' || p.etapa_acta === 'falta_firmada')
            : true;
        const chips: { id: '' | 'pendientes' | 'hoy' | 'acta'; texto: string }[] = [
          { id: '', texto: 'Todos' },
          { id: 'pendientes', texto: isAdmin() ? 'Requieren acción' : 'Mis pendientes' },
          { id: 'hoy', texto: 'Invitación hoy' },
          { id: 'acta', texto: 'Actas pendientes (en fila)' }
        ];
        return (
          <div className="flex flex-wrap gap-1.5 mb-3" role="group" aria-label="Filtros rápidos">
            {chips.map((c) => {
              const n = procesos.filter((p) => cumple(p, c.id)).length;
              const activo = rapido === c.id;
              return (
                <button
                  key={c.id || 'todos'}
                  type="button"
                  onClick={() => setRapido(c.id)}
                  aria-pressed={activo}
                  className={`min-h-[32px] px-3 rounded-full border text-[13px] font-medium transition-colors ${
                    activo
                      ? 'bg-numa-900 border-numa-900 text-white'
                      : 'bg-white border-numa-200 text-numa-700 hover:border-gold-400'
                  }`}
                >
                  {c.texto}{' '}
                  <span className={activo ? 'text-gold-300' : 'text-numa-400'}>{n}</span>
                </button>
              );
            })}
          </div>
        );
      })()}

      <div className="card px-3 py-2.5 mb-3">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            load();
          }}
        >
          {/* Fila 1: buscar + los filtros de "dónde" / "qué estado" */}
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-2">
            <div className="xl:col-span-2">
              <InputField
                label="Buscar"
                value={filters.q}
                onChange={(e) => setFilters({ ...filters, q: e.target.value })}
                placeholder="Código, cliente, cédula o tema..."
              />
            </div>

            <SelectField
              label="Estado"
              value={filters.estado}
              onChange={(e) => setFilters({ ...filters, estado: e.target.value })}
            >
              <option value="">Todos</option>
              <option value="en_negociacion">En negociación</option>
              <option value="cerrado_con_acuerdo">Cerrado con acuerdo</option>
              <option value="cerrado_sin_acuerdo">Cerrado sin acuerdo</option>
              <option value="archivado">Archivado</option>
              <option value="anulado">Anulado</option>
            </SelectField>

            {isAdmin() && (
              <SelectField
                label="Ciudad"
                value={filters.ciudad_id}
                onChange={(e) =>
                  setFilters({
                    ...filters,
                    ciudad_id: e.target.value,
                    sucursal_id: ''
                  })
                }
              >
                <option value="">Todas</option>
                {ciudades.map((c: any) => (
                  <option key={c.id} value={c.id}>
                    {c.nombre}
                  </option>
                ))}
              </SelectField>
            )}

            {isAdmin() && (
              <SelectField
                label="Sucursal"
                value={filters.sucursal_id}
                onChange={(e) =>
                  setFilters({ ...filters, sucursal_id: e.target.value })
                }
              >
                <option value="">Todas</option>
                {sucursales
                  .filter((s: any) =>
                    filters.ciudad_id
                      ? String(s.ciudad_id) === String(filters.ciudad_id)
                      : true
                  )
                  .map((s: any) => (
                    <option key={s.id} value={s.id}>
                      {s.nombre}
                    </option>
                  ))}
              </SelectField>
            )}

            {isAdmin() && (
              <SelectField
                label="Mediador"
                value={filters.usuario_id}
                onChange={(e) => setFilters({ ...filters, usuario_id: e.target.value })}
              >
                <option value="">Todos</option>
                {mediadores
                  .filter((m: any) => m.activo !== false)
                  .map((m: any) => (
                    <option key={m.id} value={m.id}>
                      {m.nombre} {m.apellido}
                      {m.rol === 'administrador' ? ' (administrador)' : ''}
                    </option>
                  ))}
              </SelectField>
            )}
          </div>

          {/* Fila 2: las dos fechas juntas, lado a lado, y los botones —
              antes podían quedar una arriba y otra abajo según cuántos
              filtros de ciudad/sucursal se mostraran en la fila 1. */}
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-6 gap-2 mt-2">
            <InputField
              label="Fecha desde"
              type="date"
              value={filters.fecha_desde}
              onChange={(e) =>
                setFilters({ ...filters, fecha_desde: e.target.value })
              }
            />

            <InputField
              label="Fecha hasta"
              type="date"
              value={filters.fecha_hasta}
              onChange={(e) =>
                setFilters({ ...filters, fecha_hasta: e.target.value })
              }
            />

            <div className="flex items-end gap-2">
              <button type="submit" className="btn-primary">
                Buscar
              </button>

              <button type="button" onClick={limpiarFiltros} className="btn-secondary">
                Limpiar
              </button>
            </div>
          </div>
        </form>
      </div>

      <div className="mb-2 text-[13px] text-numa-500">
        {loading ? (
          'Cargando procesos...'
        ) : (
          <>
            Mostrando <span className="font-semibold text-numa-800">{visibles.length}</span>{' '}
            {visibles.length === 1 ? 'proceso' : 'procesos'}
          </>
        )}
      </div>

      <div className="space-y-2">
        {loading ? (
          <Spinner />
        ) : visibles.length === 0 ? (
          <div className="card p-6">
            {(() => {
              const hayFiltrosActivos = Object.values(filters).some((v) => !!v) || !!rapido;
              return (
                <EmptyState
                  message={
                    rapido === 'pendientes' && procesos.length > 0
                      ? 'Estás al día: no tienes procesos pendientes.'
                      : rapido === 'hoy' && procesos.length > 0
                      ? 'No tienes invitaciones programadas para hoy.'
                      : rapido === 'acta' && procesos.length > 0
                      ? 'Ningún proceso está esperando acta.'
                      : hayFiltrosActivos
                      ? 'No hay procesos que coincidan con estos filtros.'
                      : 'Todavía no tienes procesos registrados.'
                  }
                  actionLabel={hayFiltrosActivos ? undefined : 'Crear tu primer proceso'}
                  onAction={hayFiltrosActivos ? undefined : abrirCrear}
                />
              );
            })()}
          </div>
        ) : (
          visibles.map((p) => (
            <div
              key={p.id}
              onClick={() => router.push(`/procesos/${p.id}`)}
              className={`card card-lift px-3 py-2 border-l-4 ${estadoFranja(p.estado)} cursor-pointer`}
            >
              <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-2">
                <div className="space-y-0.5 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="code-text text-numa-500">{p.codigo_proceso}</span>
                    <Pill label={estadoLabelProceso(p.estado, p.requiere_acta_no_acuerdo)} {...estadoPill(p.estado)} />
                    {/* Un proceso "cerrado con acuerdo" no significa que ya
                        esté todo listo: se muestra qué falta (o si espera
                        su turno en la fila del mediador). */}
                    {etapaActaBadge(p) && <Pill {...etapaActaBadge(p)!} />}
                  </div>

                  <p className="text-sm font-semibold text-numa-900 leading-snug">
                    {p.demandante}
                    {p.total_solicitantes > 1 && (
                      <span className="font-normal text-numa-400"> y {p.total_solicitantes - 1} más</span>
                    )}{' '}
                    <span className="font-normal text-numa-400">vs</span> {p.demandado}
                    {p.total_invitados > 1 && (
                      <span className="font-normal text-numa-400"> y {p.total_invitados - 1} más</span>
                    )}
                  </p>

                  <p className="text-[13px] text-numa-700 line-clamp-1">{mayusInicial(p.tema)}</p>

                  <p className="text-[11px] text-numa-500 flex flex-wrap gap-x-3 gap-y-0">
                    <span>{p.ciudad || '—'} · {p.sucursal || '—'}</span>
                    <span>Mediador: {p.usuario || '—'}</span>
                    <span>
                      Abierto el{' '}
                      {p.fecha_creacion
                        ? new Date(p.fecha_creacion).toLocaleDateString('es-EC')
                        : '—'}
                    </span>
                    <span className="code-text text-[11px] text-numa-400">
                      {p.demandante_cedula || '—'} · {p.demandado_cedula || '—'}
                    </span>
                  </p>
                </div>

                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    router.push(`/procesos/${p.id}`);
                  }}
                  className={`${
                    accionDe(p).urgente && !isAdmin() ? 'btn-primary' : 'btn-secondary'
                  } btn-sm shrink-0 self-start lg:self-center`}
                >
                  {accionDe(p).texto}
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      <Modal open={showCreate} onClose={cerrarCrear} title="Nuevo Proceso de Mediación" size="lg">
        {/* Indicador de pasos: le muestra al mediador dónde está y qué falta,
            para que un formulario de varias secciones no se sienta como un
            solo bloque largo y confuso. */}
        <div className="flex items-center gap-2 mb-6">
          {PASOS_CREAR.map((p, idx) => (
            <div key={p.numero} className="flex items-center flex-1 last:flex-none">
              <div className="flex items-center gap-2">
                <div
                  className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold shrink-0 ${
                    paso === p.numero
                      ? 'bg-gold-500 text-numa-950'
                      : paso > p.numero
                      ? 'bg-green-50 text-green-700'
                      : 'bg-numa-100 text-numa-400'
                  }`}
                >
                  {paso > p.numero ? <Check className="w-3.5 h-3.5" /> : p.numero}
                </div>

                <span
                  className={`text-xs font-medium hidden sm:inline ${
                    paso === p.numero ? 'text-numa-800' : 'text-numa-400'
                  }`}
                >
                  {p.titulo}
                </span>
              </div>

              {idx < PASOS_CREAR.length - 1 && (
                <div
                  className={`flex-1 h-px mx-3 ${
                    paso > p.numero ? 'bg-green-200' : 'bg-numa-100'
                  }`}
                />
              )}
            </div>
          ))}
        </div>

        {error && showCreate && (
          <div className="mb-4">
            <ErrorAlert message={error} />
          </div>
        )}

        {paso === 1 && (
          <div className="space-y-4 animate-fade-in">
            <p className="text-xs text-numa-500">
              Paso 1 de {PASOS_CREAR.length}: elige quiénes participan en el proceso.
            </p>

            {citasRapidas.length > 0 && (
              <div>
                <SelectField
                  label="Traer de una invitación rápida (opcional)"
                  value={form.cita_rapida_id}
                  onChange={(e) => elegirCitaRapida(e.target.value)}
                >
                  <option value="">No, empezar de cero</option>
                  {citasRapidas.map((c: any) => (
                    <option key={c.id} value={c.id}>
                      {String(c.fecha).slice(0, 10).split('-').reverse().join('/')}{' '}
                      {String(c.hora).slice(0, 5)} · {c.demandante} vs {c.demandado}
                    </option>
                  ))}
                </SelectField>
                {form.cita_rapida_id && (
                  <p className="text-xs text-numa-500 mt-1">
                    El proceso quedará enlazado a esa invitación.
                  </p>
                )}
                {avisoCitaRapida && (
                  <p className="text-xs mt-2 rounded-sm border border-amber-300 bg-amber-50 text-amber-800 px-2 py-1">
                    {avisoCitaRapida}
                  </p>
                )}
              </div>
            )}

            {isAdmin() && (
              <SelectField
                label="Sucursal"
                value={form.sucursal_id}
                onChange={(e) => setForm({ ...form, sucursal_id: e.target.value })}
              >
                <option value="">Seleccione una sucursal</option>

                {sucursales.map((s: any) => (
                  <option key={s.id} value={s.id}>
                    {s.ciudad_nombre || s.ciudad || ''} - {s.nombre}
                  </option>
                ))}
              </SelectField>
            )}

            {nuevos.sol && (
              <NuevoClienteBox
                etiqueta="Solicitante"
                n={nuevos.sol}
                onChange={(n) => setNuevos((a) => ({ ...a, sol: n }))}
                onQuitar={() => setNuevos((a) => ({ ...a, sol: null }))}
              />
            )}
            {!nuevos.sol && (
            <SelectField
              label="Solicitante"
              value={form.cliente_demandante_id}
              onChange={(e) =>
                setForm({ ...form, cliente_demandante_id: e.target.value })
              }
            >
              <option value="">Seleccione</option>

              {clientes.map((c: any) => (
                <option key={c.id} value={c.id}>
                  {etiquetaCliente(c)}
                </option>
              ))}
            </SelectField>
            )}

            {nuevos.inv && (
              <NuevoClienteBox
                etiqueta="Invitado"
                n={nuevos.inv}
                onChange={(n) => setNuevos((a) => ({ ...a, inv: n }))}
                onQuitar={() => setNuevos((a) => ({ ...a, inv: null }))}
              />
            )}
            {!nuevos.inv && (
            <SelectField
              label="Invitado"
              value={form.cliente_demandado_id}
              onChange={(e) =>
                setForm({ ...form, cliente_demandado_id: e.target.value })
              }
            >
              <option value="">Seleccione</option>

              {clientes.map((c: any) => (
                <option key={c.id} value={c.id}>
                  {etiquetaCliente(c)}
                </option>
              ))}
            </SelectField>
            )}

            {clientes.length === 0 && (
              <p className="text-xs text-numa-400">
                Todavía no hay clientes registrados. Ve a &quot;Clientes&quot; para
                registrar al solicitante y al invitado antes de continuar.
              </p>
            )}
          </div>
        )}

        {paso === 2 && (
          <div className="space-y-4 animate-fade-in">
            <p className="text-xs text-numa-500">
              Paso 2 de {PASOS_CREAR.length}: describe el motivo del proceso.
            </p>

            <TextareaField
              label="Tema / Motivo del proceso"
              rows={5}
              value={form.tema}
              onChange={(e) => setForm({ ...form, tema: e.target.value })}
              placeholder="Ejemplo: Mediación por acuerdo de pago..."
            />
          </div>
        )}

        {paso === 3 && (
          <div className="space-y-4 animate-fade-in">
            <p className="text-xs text-numa-500">
              Paso 3 de {PASOS_CREAR.length}: revisa los datos antes de crear el proceso.
            </p>

            <div className="card bg-numa-50 p-4 space-y-2 text-sm">
              {isAdmin() && (
                <div>
                  <span className="text-numa-400">Sucursal: </span>
                  <span className="font-medium text-numa-800">
                    {nombreSucursal(form.sucursal_id)?.nombre || '—'}
                  </span>
                </div>
              )}

              <div>
                <span className="text-numa-400">Solicitante: </span>
                <span className="font-medium text-numa-800">
                  {nuevos.sol
                    ? `${nuevos.sol.nombre} ${nuevos.sol.apellido}`.trim() + ' (se registrará como cliente nuevo)'
                    : `${nombreCliente(form.cliente_demandante_id)?.nombre} ${nombreCliente(form.cliente_demandante_id)?.apellido}`}
                </span>
              </div>

              <div>
                <span className="text-numa-400">Invitado: </span>
                <span className="font-medium text-numa-800">
                  {nuevos.inv
                    ? `${nuevos.inv.nombre} ${nuevos.inv.apellido}`.trim() + ' (se registrará como cliente nuevo)'
                    : `${nombreCliente(form.cliente_demandado_id)?.nombre} ${nombreCliente(form.cliente_demandado_id)?.apellido}`}
                </span>
              </div>

              <div>
                <span className="text-numa-400">Tema: </span>
                <span className="text-numa-700">{form.tema}</span>
              </div>
            </div>

            <div className="bg-blue-50 border border-blue-200 rounded-sm p-3">
              <p className="text-xs text-blue-700">
                Al crear el proceso irás directo a su pantalla, donde podrás
                agendar invitaciones, registrar avances y, cuando se cierre,
                subir los documentos del acta.
              </p>
            </div>
          </div>
        )}

        <div className="flex justify-between gap-3 mt-6">
          <div>
            {paso > 1 && (
              <button onClick={irPasoAnterior} className="btn-secondary">
                Atrás
              </button>
            )}
          </div>

          <div className="flex gap-3">
            <button onClick={cerrarCrear} className="btn-secondary">
              Cancelar
            </button>

            {paso < PASOS_CREAR.length ? (
              <button onClick={irSiguientePaso} className="btn-primary">
                Siguiente
              </button>
            ) : (
              <button onClick={handleCreate} disabled={saving} className="btn-primary">
                {saving ? 'Guardando...' : 'Crear Proceso'}
              </button>
            )}
          </div>
        </div>
      </Modal>
    </>
  );
}
