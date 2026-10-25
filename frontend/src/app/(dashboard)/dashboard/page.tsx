'use client';

import { etapaActaBadge } from '@/lib/etapaActa';
import { useEffect, useRef, useState } from 'react';
import {
  FileText,
  CheckCircle,
  Clock,
  Archive,
  FileCheck,
  PauseCircle,
  LayoutDashboard,
  HardDrive,
  ChevronDown,
  DatabaseBackup,
  ArrowRight
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Spinner, ErrorAlert, Badge, EmptyState, Pill } from '@/components/ui';
import { getDashboard, getUsoAlmacenamiento, getProcesos, getActasFinales, enviarRespaldoManual } from '@/lib/services';
import { useAuth } from '@/hooks/useAuth';
import { GuiaBienvenida, useGuiaBienvenida } from '@/components/dashboard/GuiaBienvenida';
import ResumenActasMes from '@/components/dashboard/ResumenActasMes';
import AlertaActasAtrasadas from '@/components/dashboard/AlertaActasAtrasadas';
import MiDia from '@/components/dashboard/MiDia';

// Cada tarjeta clickeable del resumen corresponde a un filtro de estado de
// procesos, salvo "actas_finales" que no es un estado de proceso sino la
// lista de actas ya subidas.
// Colores de cada categoría del panel: la caja de arriba y el panel que se
// despliega al hacer clic usan la misma familia de color.
const TEMA_CATEGORIA: Record<
  string,
  { caja: string; icono: string; texto: string; panel: string; item: string; titulo: string }
> = {
  en_negociacion: {
    caja: 'bg-sky-100 border-sky-300',
    icono: 'bg-sky-600 text-white',
    texto: 'text-sky-900',
    panel: 'bg-sky-50 border-sky-200',
    item: 'border-sky-200 border-t-4 border-t-sky-500 hover:border-sky-300',
    titulo: 'text-sky-800'
  },
  cerrado_con_acuerdo: {
    caja: 'bg-emerald-100 border-emerald-300',
    icono: 'bg-emerald-600 text-white',
    texto: 'text-emerald-900',
    panel: 'bg-emerald-50 border-emerald-200',
    item: 'border-emerald-200 border-t-4 border-t-emerald-500 hover:border-emerald-300',
    titulo: 'text-emerald-800'
  },
  cerrado_sin_acuerdo: {
    caja: 'bg-stone-200/70 border-stone-300',
    icono: 'bg-stone-600 text-white',
    texto: 'text-stone-900',
    panel: 'bg-stone-100 border-stone-200',
    item: 'border-stone-200 border-t-4 border-t-stone-500 hover:border-stone-300',
    titulo: 'text-stone-700'
  },
  archivado: {
    caja: 'bg-slate-200/70 border-slate-300',
    icono: 'bg-slate-500 text-white',
    texto: 'text-slate-900',
    panel: 'bg-slate-100 border-slate-200',
    item: 'border-slate-200 border-t-4 border-t-slate-400 hover:border-slate-300',
    titulo: 'text-slate-700'
  },
  suspendido: {
    caja: 'bg-rose-100 border-rose-300',
    icono: 'bg-rose-600 text-white',
    texto: 'text-rose-900',
    panel: 'bg-rose-50 border-rose-200',
    item: 'border-rose-200 border-t-4 border-t-rose-500 hover:border-rose-300',
    titulo: 'text-rose-800'
  },
  actas_acuerdo: {
    caja: 'bg-amber-100 border-amber-300',
    icono: 'bg-numa-900 text-gold-400',
    texto: 'text-numa-900',
    panel: 'bg-amber-50 border-amber-200',
    item: 'border-amber-200 border-t-4 border-t-gold-500 hover:border-amber-300',
    titulo: 'text-amber-800'
  },
  actas_no_acuerdo: {
    caja: 'bg-orange-100 border-orange-300',
    icono: 'bg-orange-700 text-white',
    texto: 'text-orange-950',
    panel: 'bg-orange-50 border-orange-200',
    item: 'border-orange-200 border-t-4 border-t-orange-500 hover:border-orange-300',
    titulo: 'text-orange-800'
  }
};

// Las dos tarjetas de actas muestran actas subidas (no procesos).
const esCategoriaActas = (c: string | null) => c === 'actas_acuerdo' || c === 'actas_no_acuerdo';

const CATEGORIAS: Record<
  string,
  { titulo: string; estadoProceso?: string; verTodoHref: string }
> = {
  en_negociacion: {
    titulo: 'Procesos en negociación',
    estadoProceso: 'en_negociacion',
    verTodoHref: '/procesos?estado=en_negociacion'
  },
  cerrado_con_acuerdo: {
    titulo: 'Procesos con acuerdo',
    estadoProceso: 'cerrado_con_acuerdo',
    verTodoHref: '/procesos?estado=cerrado_con_acuerdo'
  },
  cerrado_sin_acuerdo: {
    titulo: 'Procesos sin acuerdo',
    estadoProceso: 'cerrado_sin_acuerdo',
    verTodoHref: '/procesos?estado=cerrado_sin_acuerdo'
  },
  archivado: {
    titulo: 'Procesos archivados',
    estadoProceso: 'archivado',
    verTodoHref: '/procesos?estado=archivado'
  },
  suspendido: {
    titulo: 'Procesos suspendidos',
    verTodoHref: '/procesos'
  },
  actas_acuerdo: {
    titulo: 'Actas finales de acuerdo',
    verTodoHref: '/actas-finales'
  },
  actas_no_acuerdo: {
    titulo: 'Actas finales de no acuerdo',
    verTodoHref: '/actas-finales'
  }
};

// Texto legible para el estado de cada proceso (la base guarda el código
// técnico, p. ej. "cerrado_sin_acuerdo").
const ETIQUETAS_ESTADO: Record<string, string> = {
  en_negociacion: 'En negociación',
  cerrado_con_acuerdo: 'Cerrado con acuerdo',
  cerrado_sin_acuerdo: 'Cerrado sin acuerdo',
  archivado: 'Archivado',
  anulado: 'Anulado'
};

// ── Tarjetas de resumen con número animado ─────────────────────────────────
// Cuenta desde 0 hasta el valor al cargar y cada vez que cambia (por ejemplo
// al pasar de "Mi gestión" a "Todos"). Con "reducir movimiento" salta directo.
function useContador(valor: number) {
  const [mostrado, setMostrado] = useState(0);
  const anterior = useRef(0);
  useEffect(() => {
    const reducir =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reducir) {
      setMostrado(valor);
      anterior.current = valor;
      return;
    }
    const desde = anterior.current;
    const ini = performance.now();
    let raf = 0;
    const paso = (ahora: number) => {
      const t = Math.min(1, (ahora - ini) / 1100);
      const e = 1 - Math.pow(1 - t, 3);
      setMostrado(Math.round(desde + (valor - desde) * e));
      if (t < 1) raf = requestAnimationFrame(paso);
      else anterior.current = valor;
    };
    raf = requestAnimationFrame(paso);
    return () => cancelAnimationFrame(raf);
  }, [valor]);
  return mostrado;
}

// Colores de cada tarjeta (fondo, texto, acento de la barra).
const ESTILO_TARJETA: Record<
  string,
  { caja: string; texto: string; sub: string; acento: string; pista: string; icono: string }
> = {
  actas_acuerdo: { caja: 'bg-white border-[#CBD6E8]', texto: 'text-numa-900', sub: 'text-numa-500', acento: 'bg-numa-700', pista: 'bg-numa-100', icono: 'bg-numa-100 text-numa-700' },
  actas_no_acuerdo: { caja: 'bg-white border-[#CBD6E8]', texto: 'text-numa-900', sub: 'text-numa-500', acento: 'bg-orange-500', pista: 'bg-numa-100', icono: 'bg-orange-100 text-orange-700' },
  en_negociacion: { caja: 'bg-white border-[#CBD6E8]', texto: 'text-numa-900', sub: 'text-numa-500', acento: 'bg-amber-500', pista: 'bg-numa-100', icono: 'bg-amber-100 text-amber-700' },
  cerrado_con_acuerdo: { caja: 'bg-white border-[#CBD6E8]', texto: 'text-numa-900', sub: 'text-numa-500', acento: 'bg-emerald-500', pista: 'bg-numa-100', icono: 'bg-emerald-100 text-emerald-700' },
  cerrado_sin_acuerdo: { caja: 'bg-white border-[#CBD6E8]', texto: 'text-numa-900', sub: 'text-numa-500', acento: 'bg-slate-500', pista: 'bg-numa-100', icono: 'bg-slate-100 text-slate-600' },
  archivado: { caja: 'bg-white border-[#CBD6E8]', texto: 'text-numa-900', sub: 'text-numa-500', acento: 'bg-numa-400', pista: 'bg-numa-100', icono: 'bg-numa-100 text-numa-600' },
  suspendido: { caja: 'bg-white border-[#CBD6E8]', texto: 'text-numa-900', sub: 'text-numa-500', acento: 'bg-rose-500', pista: 'bg-numa-100', icono: 'bg-rose-100 text-rose-700' }
};

// Estilo de la tarjeta que se elige (dorada); las demás van en blanco.
const ESTILO_ELEGIDA = { caja: 'bg-gradient-to-br from-gold-300 to-gold-500 border-transparent', texto: 'text-numa-950', sub: 'text-numa-900', acento: 'bg-numa-900', pista: 'bg-numa-950/15', icono: 'bg-numa-950/15 text-numa-900' };

function TarjetaResumen({
  clave,
  label,
  value,
  maximo,
  icon: Icon,
  onClick,
  active,
  porDefecto,
  orden
}: {
  clave: string;
  label: string;
  value: number;
  maximo: number;
  icon: React.ComponentType<{ className?: string }>;
  onClick: () => void;
  active: boolean;
  porDefecto: boolean;
  orden: number;
}) {
  // Solo la tarjeta elegida se pinta dorada; al abrir el panel ninguna lo está.
  const e = active ? ESTILO_ELEGIDA : ESTILO_TARJETA[clave];
  const mostrado = useContador(value);
  const porcentaje = maximo > 0 ? Math.max(value > 0 ? 8 : 0, (value / maximo) * 100) : 0;
  return (
    <button
      type="button"
      onClick={onClick}
      style={{ animationDelay: `${0.08 + orden * 0.06}s` }}
      className={`tarjeta-resumen tile-in group w-full text-left rounded-2xl border p-3.5 shadow-[0_10px_22px_-16px_rgba(11,39,89,.45)] cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-400 focus-visible:ring-offset-2 ${e.caja} ${
        active ? 'ring-2 ring-gold-500/60 ring-offset-2 -translate-y-0.5' : ''
      }`}
    >
      <div className="flex items-start justify-between">
        <span className={`w-8 h-8 rounded-xl flex items-center justify-center ${e.icono}`}>
          <Icon className="w-5 h-5" />
        </span>
        <ArrowRight className={`w-4 h-4 opacity-0 -translate-x-2 transition-all duration-200 group-hover:opacity-100 group-hover:translate-x-0 ${e.sub}`} />
      </div>
      <p className={`mt-2.5 text-3xl font-extrabold tracking-tight tabular-nums leading-none ${e.texto}`}>{mostrado}</p>
      <div className={`mt-3 h-1.5 rounded-full ${e.pista}`}>
        <div className={`h-1.5 rounded-full transition-all duration-1000 ease-out ${e.acento}`} style={{ width: `${porcentaje}%` }} />
      </div>
      <p className={`mt-2.5 text-[11px] leading-tight uppercase tracking-wide font-semibold ${e.sub}`}>{label}</p>
    </button>
  );
}

function saludoSegunHora() {
  const h = new Date().getHours();
  return h < 12 ? 'Buenos días' : h < 19 ? 'Buenas tardes' : 'Buenas noches';
}

function fechaLarga() {
  const f = new Date().toLocaleDateString('es-EC', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  return f.charAt(0).toUpperCase() + f.slice(1);
}

export default function DashboardPage() {
  const router = useRouter();
  const { user, isAdmin } = useAuth();
  const { mostrar: mostrarGuia, cerrarGuia, abrirGuia } = useGuiaBienvenida();
  const [stats, setStats] = useState<any | null>(null);
  // Solo el administrador: ver el panorama de todos o solo lo suyo.
  const [vista, setVista] = useState<'todos' | 'mios'>('todos');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [almacenamiento, setAlmacenamiento] = useState<any | null>(null);
  const [loadingAlmacenamiento, setLoadingAlmacenamiento] = useState(isAdmin);

  const [enviandoRespaldo, setEnviandoRespaldo] = useState(false);
  const [resultadoRespaldo, setResultadoRespaldo] = useState<{
    ok: boolean;
    mensaje: string;
  } | null>(null);

  const handleEnviarRespaldo = async () => {
    setEnviandoRespaldo(true);
    setResultadoRespaldo(null);
    try {
      const data = await enviarRespaldoManual();
      setResultadoRespaldo({
        ok: true,
        mensaje: `${data.motivo} (${data.tamano_mb} MB, ${data.tablas} tablas)`,
      });
    } catch (err: any) {
      const esTimeout = err?.code === 'ECONNABORTED';
      setResultadoRespaldo({
        ok: false,
        mensaje: esTimeout
          ? 'El servidor no respondió a tiempo (45s). Probablemente el servidor de correo (SMTP) no está respondiendo — revisa que SMTP_USER/SMTP_PASSWORD estén bien configurados en Railway, o si el proveedor de correo está bloqueando la conexión.'
          : err?.response?.data?.detail ||
            'No se pudo generar/enviar el respaldo. Intenta de nuevo.',
      });
    } finally {
      setEnviandoRespaldo(false);
    }
  };

  // Tarjeta clickeada actualmente (una de las claves de CATEGORIAS), la
  // lista que trae y su estado de carga.
  const [categoriaAbierta, setCategoriaAbierta] = useState<string | null>(null);
  const [listaCategoria, setListaCategoria] = useState<any[]>([]);
  const [loadingCategoria, setLoadingCategoria] = useState(false);
  const [errorCategoria, setErrorCategoria] = useState('');

  // El panel de resultados aparece más abajo, debajo de las tarjetas — en
  // un celular (o incluso en una pantalla chica) queda fuera de la vista
  // y no se nota que hay que bajar para verlo. Igual que en el calendario
  // de Agenda, se baja la pantalla sola hasta ahí apenas se abre.
  const panelCategoriaRef = useRef<HTMLDivElement>(null);

  const bajarAPanelCategoria = () => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        panelCategoriaRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      });
    });
  };

  const toggleCategoria = async (clave: string) => {
    if (categoriaAbierta === clave) {
      setCategoriaAbierta(null);
      return;
    }

    setCategoriaAbierta(clave);
    setListaCategoria([]);
    setErrorCategoria('');
    setLoadingCategoria(true);
    bajarAPanelCategoria();

    try {
      const info = CATEGORIAS[clave];
      let data: any[];
      if (clave === 'suspendido') {
        data = await getProcesos({
          suspendido: true,
          ...(isAdmin && vista === 'mios' ? { usuario_id: user?.id } : {})
        });
      } else if (info.estadoProceso) {
        data = await getProcesos({
          estado: info.estadoProceso,
          suspendido: false,
          ...(isAdmin && vista === 'mios' ? { usuario_id: user?.id } : {})
        });
      } else {
        const todas = await getActasFinales(
          isAdmin && vista === 'mios' ? { usuario_id: user?.id } : undefined
        );
        // Cada acta guarda su tipo: 'acuerdo' o 'no_acuerdo'.
        data = todas.filter((a: any) =>
          clave === 'actas_no_acuerdo' ? a.tipo === 'no_acuerdo' : a.tipo !== 'no_acuerdo'
        );
      }

      setListaCategoria(data);
    } catch {
      setErrorCategoria('No se pudo cargar la lista.');
    } finally {
      setLoadingCategoria(false);
    }
  };

  useEffect(() => {
    // Con el interruptor del administrador se recargan las cifras; la lista
    // abierta de una tarjeta se cierra porque ya no corresponde.
    setCategoriaAbierta(null);
    getDashboard(isAdmin && vista === 'mios')
      .then((d) => {
        setStats(d);
        setError('');
      })
      .catch(() =>
        setError('No se pudo cargar el dashboard. Verifique la conexión con el servidor.')
      )
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin, vista]);

  useEffect(() => {
    if (!isAdmin) return;

    getUsoAlmacenamiento()
      .then(setAlmacenamiento)
      .catch(() => setAlmacenamiento(null))
      .finally(() => setLoadingAlmacenamiento(false));
  }, [isAdmin]);

  const procesos = stats?.procesos || {};

  return (
    <>
      <section className="hero-banner relative overflow-hidden rounded-3xl bg-gradient-to-br from-[#0A2A62] via-[#144193] to-[#2358C9] px-6 sm:px-8 pt-5 pb-14 text-white shadow-[0_28px_48px_-28px_rgba(11,39,89,.75)]">
        <div className="hero-float-a pointer-events-none absolute -top-40 -right-16 w-[420px] h-[420px] rounded-full border-[56px] border-white/10" />
        <div className="hero-float-b pointer-events-none absolute -bottom-40 right-40 w-[340px] h-[340px] rounded-full border-[44px] border-white/[0.08]" />

        <div className="relative flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-gold-300">{fechaLarga()}</p>
            <h1 className="mt-1.5 text-2xl sm:text-4xl font-extrabold tracking-tight leading-[1.05]">
              {saludoSegunHora()}, {String(user?.nombre || '').split(' ')[0] || 'bienvenido'}.
            </h1>
            <p className="mt-1.5 text-sm sm:text-base text-blue-100 max-w-xl">
              {isAdmin
                ? 'Resumen práctico del sistema. Lo que toca hoy está justo debajo.'
                : `${user?.sucursal || 'Sucursal'} · ${user?.ciudad || 'Ciudad'}. Lo que toca hoy está justo debajo.`}
            </p>
            <div className="mt-4 flex flex-wrap gap-2.5">
              <Link
                href="/agenda"
                className="inline-flex items-center gap-2 rounded-xl bg-gold-400 px-4 py-2 text-sm font-bold text-numa-950 shadow-[0_10px_22px_-10px_rgba(224,184,74,.9)] transition hover:bg-gold-300 active:scale-[0.97]"
              >
                Ir a la agenda
              </Link>
              <button
                type="button"
                onClick={mostrarGuia ? cerrarGuia : abrirGuia}
                className="rounded-xl border border-white/30 bg-white/10 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/20 active:scale-[0.97]"
              >
                ¿Cómo funciona?
              </button>
            </div>
          </div>

          {isAdmin && (
            <div className="inline-flex gap-1 rounded-full bg-white/15 p-1 text-xs font-semibold">
              {(
                [
                  ['mios', 'Mi gestión'],
                  ['todos', 'Todos los mediadores']
                ] as const
              ).map(([clave, texto]) => (
                <button
                  key={clave}
                  type="button"
                  onClick={() => setVista(clave)}
                  className={`rounded-full px-4 py-2 transition ${
                    vista === clave ? 'bg-white text-numa-900' : 'text-white hover:bg-white/15'
                  }`}
                >
                  {texto}
                </button>
              ))}
            </div>
          )}
        </div>
      </section>

      <GuiaBienvenida open={mostrarGuia} onClose={cerrarGuia} />

      {error && <ErrorAlert message={error} />}

      {loading ? (
        <Spinner />
      ) : stats ? (
        <div className="space-y-4 animate-fade-in">
          {/* Las cajas van directo sobre el fondo de la página: sus colores
              suaves ya las distinguen, sin franja detrás. */}
          <div className="relative -mt-9 sm:-mt-10 mx-2 sm:mx-6 grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-3">
            {(
              [
                ['actas_acuerdo', stats.actas_acuerdo ?? 0, stats.actas_acuerdo === 1 ? 'acta de acuerdo' : 'actas de acuerdo', FileCheck],
                ['actas_no_acuerdo', stats.actas_no_acuerdo ?? 0, stats.actas_no_acuerdo === 1 ? 'acta de no acuerdo' : 'actas de no acuerdo', FileCheck],
                ['en_negociacion', procesos.en_negociacion ?? 0, procesos.en_negociacion === 1 ? 'proceso en negociación' : 'procesos en negociación', Clock],
                ['cerrado_con_acuerdo', procesos.cerrados_con_acuerdo ?? 0, procesos.cerrados_con_acuerdo === 1 ? 'proceso con acuerdo' : 'procesos con acuerdo', CheckCircle],
                ['cerrado_sin_acuerdo', procesos.cerrados_sin_acuerdo ?? 0, procesos.cerrados_sin_acuerdo === 1 ? 'proceso sin acuerdo' : 'procesos sin acuerdo', FileText],
                ['archivado', procesos.archivados ?? 0, procesos.archivados === 1 ? 'proceso archivado' : 'procesos archivados', Archive],
                ['suspendido', procesos.suspendidos ?? 0, procesos.suspendidos === 1 ? 'proceso suspendido' : 'procesos suspendidos', PauseCircle]
              ] as const
            ).map(([clave, valor, etiqueta, icono], i, todas) => (
              <TarjetaResumen
                key={clave}
                clave={clave}
                label={etiqueta}
                value={valor}
                maximo={Math.max(...todas.map((t) => t[1] as number), 1)}
                icon={icono}
                onClick={() => toggleCategoria(clave)}
                active={categoriaAbierta === clave}
                porDefecto={false}
                orden={i}
              />
            ))}
          </div>

          {isAdmin && <AlertaActasAtrasadas />}

          {/* Lo que toca hoy (mediador y administrador), antes que las cifras. */}
          <MiDia esAdmin={isAdmin} miId={user?.id} vista={vista} />

          {/* Panel que se despliega al hacer clic en una de las tarjetas de
              arriba: muestra los procesos (o actas) de esa categoría, cada
              uno clickeable para ir directo a su proceso, y un botón para
              ver la lista completa con el filtro ya aplicado. */}
          {categoriaAbierta && (
            <div
              ref={panelCategoriaRef}
              className={`rounded-lg border p-3 shadow-sm animate-fade-in ${TEMA_CATEGORIA[categoriaAbierta].panel}`}
            >

              <div className="flex items-center justify-between mb-2">
                <h2 className={`text-sm font-bold uppercase tracking-wider flex items-center gap-2 ${TEMA_CATEGORIA[categoriaAbierta].titulo}`}>
                  <ChevronDown className="w-4 h-4" />
                  {CATEGORIAS[categoriaAbierta].titulo}
                </h2>

                <button
                  type="button"
                  onClick={() => router.push(CATEGORIAS[categoriaAbierta].verTodoHref)}
                  className="btn-secondary btn-sm !py-1"
                >
                  Mostrar todo
                </button>
              </div>

              {loadingCategoria ? (
                <Spinner />
              ) : errorCategoria ? (
                <ErrorAlert message={errorCategoria} />
              ) : listaCategoria.length === 0 ? (
                <EmptyState message="No hay registros en esta categoría." />
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  {listaCategoria.slice(0, 10).map((item: any) => (
                    <div
                      key={item.id}
                      onClick={() =>
                        router.push(
                          `/procesos/${
                            esCategoriaActas(categoriaAbierta) ? item.proceso_id : item.id
                          }`
                        )
                      }
                      className={`px-3 py-2 border rounded-md bg-white cursor-pointer card-lift shadow-sm hover:shadow-md ${TEMA_CATEGORIA[categoriaAbierta].item}`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 flex-wrap min-w-0">
                          <p className="font-semibold text-numa-900 code-text">
                            {esCategoriaActas(categoriaAbierta)
                              ? item.codigo_acta
                              : item.codigo_proceso}
                          </p>
                          {/* Un proceso "cerrado con acuerdo" no significa que ya
                              esté todo listo: se muestra qué le falta. */}
                          {(categoriaAbierta === 'cerrado_con_acuerdo' || categoriaAbierta === 'cerrado_sin_acuerdo' || categoriaAbierta === 'suspendido') && etapaActaBadge(item) && (
                            <Pill {...etapaActaBadge(item)!} />
                          )}
                        </div>
                        <span className="text-xs text-numa-600 shrink-0">
                          {(item.fecha_creacion || item.fecha_subida)
                            ? new Date(
                                item.fecha_creacion || item.fecha_subida
                              ).toLocaleDateString('es-EC')
                            : '—'}
                        </span>
                      </div>

                      <p className="text-sm font-medium text-numa-800 mt-0.5 line-clamp-1">
                        {item.demandante} <span className="font-normal text-numa-600">y</span> {item.demandado}
                      </p>

                      <p className="text-xs text-numa-700 mt-0.5 flex flex-wrap gap-x-3">
                        {esCategoriaActas(categoriaAbierta) && <span>Proceso: {item.codigo_proceso}</span>}
                        <span>{item.ciudad || '—'} · {item.sucursal || '—'}</span>
                        {isAdmin && <span>Mediador: {item.usuario || '—'}</span>}
                      </p>
                      {categoriaAbierta === 'suspendido' && item.motivo_suspension && (
                        <p className="text-xs text-rose-700 mt-0.5 line-clamp-1">
                          Motivo: {item.motivo_suspension}
                        </p>
                      )}
                    </div>
                  ))}

                  {listaCategoria.length > 10 && (
                    <p className="text-xs text-numa-600 text-center pt-1 md:col-span-2">
                      Mostrando 10 de {listaCategoria.length}. Usa &quot;Mostrar todo&quot;
                      para ver la lista completa.
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

          <div className="grid grid-cols-1 gap-4">
            <div className="card p-4">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold text-numa-700 uppercase tracking-wider">
                  Actas finales recientes
                </h2>

                <Link href="/actas-finales" className="text-xs text-gold-600 hover:text-gold-700">
                  Ver todas
                </Link>
              </div>

              {stats.actas_recientes?.length ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  {stats.actas_recientes.map((a: any) => (
                    <div
                      key={a.id}
                      onClick={() => router.push(`/procesos/${a.proceso_id}`)}
                      className="px-3 py-2.5 border border-numa-100 rounded-sm bg-numa-50 cursor-pointer hover:shadow-md transition-shadow duration-200"
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <p className="font-semibold text-numa-800">
                            {a.codigo_acta}
                          </p>

                          <p className="text-sm text-numa-600 mt-0.5">
                            {a.demandante} y {a.demandado}
                          </p>

                          <p className="text-xs text-numa-600 mt-0.5">
                            Proceso: {a.codigo_proceso} · {a.ciudad || '—'} · {a.sucursal || '—'}
                          </p>

                          <p className="text-xs text-numa-600 mt-0.5">
                            Subida por: {a.subida_por || '—'}
                            {isAdmin && a.usuario && a.usuario !== a.subida_por
                              ? ` · Mediador del proceso: ${a.usuario}`
                              : ''}
                          </p>
                        </div>

                        <div className="text-right">
                          <Badge label="Finalizada" variant="aprobado" />

                          <p className="text-xs text-numa-600 mt-2">
                            {a.fecha_subida
                              ? new Date(a.fecha_subida).toLocaleDateString('es-EC')
                              : '—'}
                          </p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState message="Todavía no hay actas finales subidas." />
              )}
            </div>
          </div>

          <ResumenActasMes />

          {isAdmin && (
            <div className="card p-6">
              <div className="flex items-center justify-between mb-5">
                <h2 className="text-sm font-semibold text-numa-700 uppercase tracking-wider flex items-center gap-2">
                  <HardDrive className="w-4 h-4 text-numa-600" />
                  Almacenamiento de archivos
                </h2>
              </div>

              {loadingAlmacenamiento ? (
                <Spinner />
              ) : !almacenamiento ? (
                <p className="text-sm text-numa-600">
                  No se pudo consultar el uso de almacenamiento en este momento.
                </p>
              ) : (
                <div>
                  <div className="flex items-end justify-between mb-2">
                    <p className="text-2xl font-bold text-numa-900">
                      {almacenamiento.total_mb} MB
                      <span className="text-sm font-normal text-numa-600 ml-1">
                        de {almacenamiento.limite_gb} GB
                      </span>
                    </p>

                    <p
                      className={`text-sm font-semibold ${
                        almacenamiento.porcentaje_usado >= 90
                          ? 'text-red-600'
                          : almacenamiento.porcentaje_usado >= 70
                          ? 'text-amber-600'
                          : 'text-numa-700'
                      }`}
                    >
                      {almacenamiento.porcentaje_usado}% usado
                    </p>
                  </div>

                  <div className="w-full h-2.5 bg-numa-100 rounded-full overflow-hidden mb-5">
                    <div
                      className={`h-full rounded-full ${
                        almacenamiento.porcentaje_usado >= 90
                          ? 'bg-red-500'
                          : almacenamiento.porcentaje_usado >= 70
                          ? 'bg-amber-500'
                          : 'bg-gold-400'
                      }`}
                      style={{ width: `${Math.min(almacenamiento.porcentaje_usado, 100)}%` }}
                    />
                  </div>

                  <p className="text-xs text-numa-600 mb-4">
                    {almacenamiento.total_archivos} archivo(s) en total
                  </p>

                  {almacenamiento.por_carpeta?.length > 0 && (
                    <div className="space-y-2">
                      {almacenamiento.por_carpeta.map((c: any) => (
                        <div
                          key={c.carpeta}
                          className="flex items-center justify-between text-sm border-t border-numa-100 pt-2"
                        >
                          <span className="text-numa-600">{c.carpeta}</span>
                          <span className="text-numa-800 font-medium">{c.mb} MB</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {isAdmin && (
            <div className="card p-6">
              <div className="flex items-center justify-between mb-5">
                <h2 className="text-sm font-semibold text-numa-700 uppercase tracking-wider flex items-center gap-2">
                  <DatabaseBackup className="w-4 h-4 text-numa-600" />
                  Respaldo de la base de datos
                </h2>
              </div>

              <p className="text-sm text-numa-700 mb-4">
                Genera y envía por correo el mismo respaldo que el sistema manda automáticamente
                todos los días a las 3am — úsalo para confirmar ahora mismo si el envío está
                funcionando, sin esperar a la madrugada.
              </p>

              <button
                onClick={handleEnviarRespaldo}
                disabled={enviandoRespaldo}
                className="btn-primary text-sm px-4 py-2 disabled:opacity-60"
              >
                {enviandoRespaldo ? 'Enviando respaldo...' : 'Enviar respaldo ahora'}
              </button>

              {resultadoRespaldo && (
                <div
                  className={`mt-4 text-sm rounded-lg p-3 border ${
                    resultadoRespaldo.ok
                      ? 'bg-green-50 text-green-700 border-green-200'
                      : 'bg-red-50 text-red-700 border-red-200'
                  }`}
                >
                  {resultadoRespaldo.mensaje}
                </div>
              )}
            </div>
          )}
        </div>
      ) : (
        !error && (
          <div className="card p-10 text-center">
            <LayoutDashboard className="w-10 h-10 text-numa-200 mx-auto mb-3" />
            <p className="text-sm text-numa-600">Sin datos disponibles</p>
          </div>
        )
      )}
    </>
  );
}