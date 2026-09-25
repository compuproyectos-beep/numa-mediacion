'use client';

import { useEffect, useState } from 'react';
import { PageHeader, SelectField, Spinner, EmptyState } from '@/components/ui';
import CalendarioAgendaMediador from '@/components/citas/CalendarioAgendaMediador';
import { getUsuarios } from '@/lib/services';
import { useAuth } from '@/hooks/useAuth';

export default function AgendaPage() {
  const { user, isAdmin, isLoading: loadingUser } = useAuth();

  const [mediadores, setMediadores] = useState<any[]>([]);
  const [loadingMediadores, setLoadingMediadores] = useState(isAdmin);
  const [mediadorSeleccionadoId, setMediadorSeleccionadoId] = useState('');

  useEffect(() => {
    if (!isAdmin) return;

    (async () => {
      setLoadingMediadores(true);

      try {
        const data = await getUsuarios();
        setMediadores(data.filter((u: any) => u.rol === 'mediador' && u.activo));
      } catch (err) {
        console.error(err);
        setMediadores([]);
      } finally {
        setLoadingMediadores(false);
      }
    })();
  }, [isAdmin]);

  if (loadingUser || !user) {
    return <Spinner />;
  }

  const mediadorActivo = isAdmin
    ? mediadores.find((m) => String(m.id) === mediadorSeleccionadoId)
    : null;

  // Agrupa a los mediadores por sucursal para que el admin sepa
  // de dónde es cada uno, incluso con muchos mediadores en la lista.
  const gruposPorSucursal = mediadores.reduce((acc: Record<string, any[]>, m) => {
    const clave = m.sucursal || 'Sin sucursal asignada';
    if (!acc[clave]) acc[clave] = [];
    acc[clave].push(m);
    return acc;
  }, {});

  const nombresSucursales = Object.keys(gruposPorSucursal).sort((a, b) =>
    a.localeCompare(b)
  );

  return (
    <>
      <PageHeader
        title="Agenda"
        subtitle={
          isAdmin
            ? 'Consulta y gestiona el estado de las invitaciones de cualquier mediador'
            : 'Consulta y gestiona el estado de tus invitaciones asignadas'
        }
      />

      {isAdmin && (
        <div className="card p-4 mb-6 max-w-sm">
          <SelectField
            label="Mediador"
            value={mediadorSeleccionadoId}
            onChange={(e) => setMediadorSeleccionadoId(e.target.value)}
          >
            <option value="">Selecciona un mediador</option>

            {nombresSucursales.map((sucursal) => (
              <optgroup
                key={sucursal}
                label={`${sucursal}${
                  gruposPorSucursal[sucursal][0]?.ciudad
                    ? ` — ${gruposPorSucursal[sucursal][0].ciudad}`
                    : ''
                }`}
              >
                {gruposPorSucursal[sucursal]
                  .slice()
                  .sort((a, b) =>
                    `${a.nombre} ${a.apellido}`.localeCompare(`${b.nombre} ${b.apellido}`)
                  )
                  .map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.nombre} {m.apellido}
                    </option>
                  ))}
              </optgroup>
            ))}
          </SelectField>

          {mediadorActivo && (
            <p className="text-xs text-numa-500 mt-2">
              {mediadorActivo.sucursal}
              {mediadorActivo.ciudad && ` — ${mediadorActivo.ciudad}`}
              {mediadorActivo.provincia && `, ${mediadorActivo.provincia}`}
            </p>
          )}
        </div>
      )}

      <div className="card p-5">
        {isAdmin ? (
          loadingMediadores ? (
            <Spinner />
          ) : !mediadorSeleccionadoId ? (
            <EmptyState message="Selecciona un mediador para ver su agenda." />
          ) : (
            <CalendarioAgendaMediador
              key={mediadorSeleccionadoId}
              usuarioId={Number(mediadorSeleccionadoId)}
              mediadorNombre={
                mediadorActivo ? `${mediadorActivo.nombre} ${mediadorActivo.apellido}` : undefined
              }
              permitirCrear={false}
            />
          )
        ) : (
          <CalendarioAgendaMediador
            usuarioId={user.id}
            mediadorNombre={user.username}
            permitirCrear={false}
          />
        )}
      </div>
    </>
  );
}
