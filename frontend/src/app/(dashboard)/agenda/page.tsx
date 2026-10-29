'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import AgendaPanel from '@/components/citas/AgendaPanel';

// Si ya estás en la Agenda y abres otra invitación desde una notificación,
// la dirección solo cambia en sus parámetros (?cita=…&mediador=…) y la pantalla
// no se vuelve a armar sola: se quedaba mostrando la invitación anterior. La
// clave obliga a reiniciarla cada vez que cambia la invitación o el mediador.
export default function AgendaPage() {
  return (
    <Suspense fallback={null}>
      <AgendaConClave />
    </Suspense>
  );
}

function AgendaConClave() {
  const sp = useSearchParams();
  return <AgendaPanel key={`${sp?.get('cita') || ''}-${sp?.get('mediador') || ''}`} />;
}
