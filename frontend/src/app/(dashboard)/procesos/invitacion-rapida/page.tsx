'use client';

import { useRouter } from 'next/navigation';
import BotonVolver from '@/components/layout/BotonVolver';
import { PageHeader } from '@/components/ui';
import AgendaPanel from '@/components/citas/AgendaPanel';

// Invitación rápida desde Procesos ("Nuevo" → "Invitación rápida"): la misma
// agenda de siempre, en una página propia dentro de la sección Procesos.
// Al pulsar "Crear el proceso" en la invitación, se vuelve a Procesos con el
// formulario abierto y las partes ya llenas.
export default function InvitacionRapidaPage() {
  const router = useRouter();
  return (
    <>
      <BotonVolver onClick={() => router.push('/procesos')}>Volver a Procesos</BotonVolver>
      <PageHeader
        title="Nueva invitación rápida"
        subtitle="Agenda la reunión primero; el proceso se crea después, desde la misma invitación"
      />
      <AgendaPanel embebido />
    </>
  );
}
