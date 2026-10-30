'use client';
import BotonVolver from '@/components/layout/BotonVolver';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { KeyRound, ArrowLeft } from 'lucide-react';
import { PasswordField, ErrorAlert, SuccessAlert, PageHeader } from '@/components/ui';
import { cambiarPassword } from '@/lib/services';
import { clearAuth } from '@/lib/auth';

export default function CambiarPasswordPage() {
  const router = useRouter();

  const [passwordActual, setPasswordActual] = useState('');
  const [passwordNueva, setPasswordNueva] = useState('');
  const [passwordConfirmar, setPasswordConfirmar] = useState('');

  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [saving, setSaving] = useState(false);

  const handleGuardar = async () => {
    setError('');
    setSuccessMessage('');

    if (!passwordActual.trim() || !passwordNueva.trim() || !passwordConfirmar.trim()) {
      setError('Completa todos los campos');
      return;
    }

    if (passwordNueva.length < 8) {
      setError('La nueva contraseña debe tener al menos 8 caracteres');
      return;
    }

    if (passwordNueva !== passwordConfirmar) {
      setError('La nueva contraseña y su confirmación no coinciden');
      return;
    }

    if (passwordNueva === passwordActual) {
      setError('La nueva contraseña debe ser distinta a la actual');
      return;
    }

    setSaving(true);

    try {
      await cambiarPassword(passwordActual, passwordNueva);

      setSuccessMessage('Contraseña actualizada. Vas a salir del sistema para que ingreses con tu nueva contraseña...');
      setPasswordActual('');
      setPasswordNueva('');
      setPasswordConfirmar('');

      // El usuario y sus datos guardados en el navegador quedan desactualizados
      // (siguen diciendo que "debe cambiar contraseña"), así que se cierra la
      // sesión y se manda a iniciar sesión de nuevo con los datos correctos.
      setTimeout(() => {
        clearAuth();
        router.push('/login?password_actualizada=1');
      }, 2000);
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'No se pudo actualizar la contraseña');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <BotonVolver onClick={() => router.back()}>Volver</BotonVolver>

      <PageHeader
        title="Cambiar contraseña"
        subtitle="Actualiza la contraseña de tu propia cuenta"
      />

      <div className="max-w-md">
        <div className="card p-6">
          <div className="flex items-center gap-3 mb-5">
            <div className="w-10 h-10 rounded-full bg-numa-100 flex items-center justify-center shrink-0">
              <KeyRound className="w-5 h-5 text-numa-600" />
            </div>
            <p className="text-sm text-numa-600">
              Por seguridad, necesitas confirmar tu contraseña actual antes de establecer una nueva.
            </p>
          </div>

          {error && (
            <div className="mb-4">
              <ErrorAlert message={error} />
            </div>
          )}

          {successMessage && (
            <div className="mb-4">
              <SuccessAlert message={successMessage} />
            </div>
          )}

          <div className="space-y-4">
            <PasswordField
              label="Contraseña actual"
              value={passwordActual}
              onChange={(e) => setPasswordActual(e.target.value)}
            />

            <PasswordField
              label="Nueva contraseña"
              value={passwordNueva}
              onChange={(e) => setPasswordNueva(e.target.value)}
            />

            <PasswordField
              label="Confirmar nueva contraseña"
              value={passwordConfirmar}
              onChange={(e) => setPasswordConfirmar(e.target.value)}
            />
          </div>

          <div className="mt-6">
            <button
              onClick={handleGuardar}
              disabled={saving}
              className="btn-primary w-full justify-center"
            >
              {saving ? 'Guardando...' : 'Actualizar contraseña'}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
