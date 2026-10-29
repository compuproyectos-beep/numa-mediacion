'use client';

import { useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
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
      <button
        type="button"
        onClick={() => router.push('/procesos')}
        className="mb-3 inline-flex items-center gap-1.5 text-sm font-semibold text-numa-700 hover:text-numa-900"
      >
        <ArrowLeft className="w-4 h-4" />
        Volver a Procesos
      </button>
      <PageHeader
        title="Nueva invitación rápida"
        subtitle="Agenda la reunión primero; el proceso se crea después, desde la misma invitación"
      />
      <AgendaPanel embebido />
    </>
  );
}
