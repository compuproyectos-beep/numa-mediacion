'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { User } from '@/types';
import { getToken, getUser, setToken, setUser, clearAuth } from '@/lib/auth';
import { login as loginService, getMe } from '@/lib/services';

export function useAuth() {
  const router = useRouter();
  const [user, setUserState] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const token = getToken();
    const storedUser = getUser();
    if (token && storedUser) {
      setUserState(storedUser);
    }
    setIsLoading(false);
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    const data = await loginService(username, password);
    setToken(data.access_token);

    // Decode basic user info from token or use a placeholder
    const userData = await getMe();

    const realUser: User = {
     id: userData.id,
     username: userData.email,
     email: userData.email,
     rol: userData.rol,
     activo: userData.activo,
     debe_cambiar_password: userData.debe_cambiar_password,
     sucursal_id: userData.sucursal_id,
      sucursal: userData.sucursal,
     ciudad: userData.ciudad,
     provincia: userData.provincia,
};

setUser(realUser);
setUserState(realUser);
    return data;
  }, []);

  const logout = useCallback(() => {
    clearAuth();
    setUserState(null);
    router.push('/');
  }, [router]);

  const isAuthenticated = !!getToken();
  const isAdmin = user?.rol === 'administrador';

  return { user, isLoading, isAuthenticated, isAdmin, login, logout };
}
