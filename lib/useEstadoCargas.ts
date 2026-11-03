'use client';

import { useCallback, useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import type { EstadoCargas } from '@/types';

interface UseEstadoCargasResult {
  /** null mientras carga o si la consulta falló: no se sabe, no es "pendiente". */
  estado: EstadoCargas | null;
  recargar: () => void;
}

/** Trae qué archivos del último mes cerrado ya están cargados. */
export function useEstadoCargas(): UseEstadoCargasResult {
  const [estado, setEstado] = useState<EstadoCargas | null>(null);
  const [version, setVersion] = useState(0);
  const pathname = usePathname();
  const apiBase = pathname?.startsWith('/demo') ? '/api/demo' : '/api';

  useEffect(() => {
    // Dos cargas seguidas pueden pedir el estado casi juntas: gana la última.
    let vigente = true;
    fetch(`${apiBase}/estado-cargas`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((json) => {
        if (json.error) throw new Error(json.error);
        if (vigente) setEstado(json as EstadoCargas);
      })
      .catch(() => { if (vigente) setEstado(null); });
    return () => { vigente = false; };
  }, [apiBase, version]);

  const recargar = useCallback(() => setVersion((v) => v + 1), []);

  return { estado, recargar };
}
