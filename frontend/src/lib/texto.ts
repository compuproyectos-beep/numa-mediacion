// La primera letra en mayúscula; el resto se deja como se escribió.
export const mayusInicial = (t?: string | null): string => {
  const s = (t || '').trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
};
