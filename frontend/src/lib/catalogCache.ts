import { getCiudades, getSucursales } from './services';

// Cache en memoria para catálogos que casi no cambian (ciudades, sucursales).
// Vive mientras la pestaña del navegador esté abierta: al recargar la página
// por completo (F5) se reinicia solo. Si algo cambia estas listas (crear,
// editar o desactivar una ciudad/sucursal), hay que llamar a la función de
// invalidación correspondiente para que la próxima consulta traiga datos
// frescos en vez de la copia guardada.

const ciudadesCache: Record<string, any[]> = {};
const ciudadesPromises: Record<string, Promise<any[]>> = {};

export async function getCiudadesCached(soloConSucursal = false): Promise<any[]> {
  const key = soloConSucursal ? 'con_sucursal' : 'todas';

  if (ciudadesCache[key]) {
    return ciudadesCache[key];
  }

  if (!ciudadesPromises[key]) {
    ciudadesPromises[key] = getCiudades(soloConSucursal)
      .then((data) => {
        ciudadesCache[key] = data;
        delete ciudadesPromises[key];
        return data;
      })
      .catch((err) => {
        delete ciudadesPromises[key];
        throw err;
      });
  }

  return ciudadesPromises[key];
}

export function invalidateCiudadesCache() {
  delete ciudadesCache['todas'];
  delete ciudadesCache['con_sucursal'];
}

let sucursalesCache: any[] | null = null;
let sucursalesPromise: Promise<any[]> | null = null;

export async function getSucursalesCached(): Promise<any[]> {
  if (sucursalesCache) {
    return sucursalesCache;
  }

  if (!sucursalesPromise) {
    sucursalesPromise = getSucursales(true)
      .then((data) => {
        sucursalesCache = data;
        sucursalesPromise = null;
        return data;
      })
      .catch((err) => {
        sucursalesPromise = null;
        throw err;
      });
  }

  return sucursalesPromise;
}

export function invalidateSucursalesCache() {
  sucursalesCache = null;
  // Qué ciudades "tienen sucursal" puede cambiar si se crea/desactiva una.
  delete ciudadesCache['con_sucursal'];
}
