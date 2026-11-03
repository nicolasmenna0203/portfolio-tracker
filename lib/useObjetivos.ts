'use client';

// Objetivos de % de cartera por dimensión: carga desde el Sheet, migración desde
// localStorage y guardado con debounce. La vista Rebalanceo los muestra sobre sus
// barras (`components/RebalanceoTab.tsx`); acá queda solo el estado, para que la
// vista no cargue con la lógica de persistencia.

import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { usePathname } from 'next/navigation';
import type { TenenciaActual } from '@/types';
import { DIMENSIONES, participacionPorCategoria, type Dimension } from '@/lib/dimensiones';

/** % objetivo (0-100) por categoría, con la categoría ya resuelta a su etiqueta. */
export interface ObjetivoDim {
  [categoria: string]: number;
}

// Redondea porcentajes garantizando que sumen exactamente 100 (largest remainder)
function initObjetivosDim(tenencias: TenenciaActual[], dim: Dimension): ObjetivoDim {
  const real = participacionPorCategoria(tenencias, dim);
  const entries = Object.entries(real);
  if (entries.length === 0) return {};

  const floors = entries.map(([cat, pct]) => ({ cat, floor: Math.floor(pct), remainder: pct - Math.floor(pct) }));
  const totalFloor = floors.reduce((s, e) => s + e.floor, 0);
  const deficit = 100 - totalFloor;

  // Distribuir el déficit a las categorías con mayor remainder
  const sorted = [...floors].sort((a, b) => b.remainder - a.remainder);
  const result: ObjetivoDim = {};
  for (let i = 0; i < floors.length; i++) {
    result[sorted[i].cat] = sorted[i].floor + (i < deficit ? 1 : 0);
  }
  return result;
}

// Clave del localStorage donde vivían los objetivos antes de mudarlos al Sheet.
// Se sigue leyendo una única vez para migrar lo que el usuario ya había cargado
// (ver ADR 0017); una vez subido al Sheet, se borra.
const STORAGE_KEY = 'proyecciones_objetivos_v1';

export type EstadoGuardado = 'inicial' | 'guardando' | 'guardado' | 'error';

// Guardados en vuelo, compartidos entre montajes: cambiar de vista desmonta el
// componente, y al volver el GET no puede adelantarse a un POST todavía en curso
// (el Sheet tarda segundos) o traería los valores de antes del cambio.
let guardadosEnCurso: Promise<unknown> = Promise.resolve();

function postObjetivos(apiBase: string, objetivos: Record<Dimension, ObjetivoDim>): Promise<boolean> {
  const envio = fetch(`${apiBase}/objetivos`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ objetivos }),
    // Para que el envío sobreviva al cierre de la página (ver `pagehide` abajo).
    keepalive: true,
  }).then(res => res.ok).catch(() => false);
  guardadosEnCurso = Promise.all([guardadosEnCurso, envio]);
  return envio;
}

/**
 * `tenencias` es la composición del mes elegido: solo se usa para los valores
 * por defecto (la composición actual redondeada, para que arrancar sea ajustar
 * desde donde se está y no desde cero) cuando no hay nada guardado.
 *
 * `objetivosPorDim` queda en `null` hasta que la carga termina, y también si
 * falla (`errorCarga`): editar en ese estado guardaría los valores por defecto
 * de las cinco dimensiones encima de lo que hay en el Sheet (ADR 0029), así que
 * `setObjetivo` no hace nada.
 */
export function useObjetivos(tenencias: TenenciaActual[]) {
  const [objetivosPorDim, setObjetivosPorDim] = useState<Record<Dimension, ObjetivoDim> | null>(null);
  const [estado, setEstado] = useState<EstadoGuardado>('inicial');
  const [errorCarga, setErrorCarga] = useState(false);
  const [intento, setIntento] = useState(0);
  const pathname = usePathname();
  const apiBase = pathname?.startsWith('/demo') ? '/api/demo' : '/api';

  const porDefecto = useMemo(
    () => Object.fromEntries(DIMENSIONES.map(d => [d, initObjetivosDim(tenencias, d)])) as Record<Dimension, ObjetivoDim>,
    [tenencias],
  );

  // Carga inicial desde el Sheet. Si no hay nada guardado todavía, se migra lo
  // que hubiera en localStorage; si tampoco hay, se usan los valores por defecto.
  // Si la lectura falla no se sigue con ninguno de los dos (ADR 0029).
  useEffect(() => {
    let cancelado = false;
    setErrorCarga(false);

    (async () => {
      await guardadosEnCurso;
      if (cancelado) return;

      let delSheet: Record<Dimension, ObjetivoDim> | null = null;
      let leido = false;
      try {
        const res = await fetch(`${apiBase}/objetivos`);
        if (res.ok) {
          const json = await res.json();
          const obj = json?.objetivos as Record<Dimension, ObjetivoDim> | undefined;
          if (obj && DIMENSIONES.some(d => Object.keys(obj[d] ?? {}).length > 0)) {
            delSheet = obj;
          }
          leido = true;
        }
      } catch {
        // Queda `leido` en false: se avisa abajo.
      }
      if (cancelado) return;

      if (!leido) {
        setErrorCarga(true);
        return;
      }

      if (delSheet) {
        setObjetivosPorDim(delSheet);
        try { localStorage.removeItem(STORAGE_KEY); } catch {}
        return;
      }

      let local: Record<Dimension, ObjetivoDim> | null = null;
      try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) local = JSON.parse(saved) as Record<Dimension, ObjetivoDim>;
      } catch {}

      if (local) {
        setObjetivosPorDim(local);
        // Migración: subir lo que ya estaba y limpiar la copia del navegador.
        try {
          const res = await fetch(`${apiBase}/objetivos`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ objetivos: local }),
          });
          if (res.ok) localStorage.removeItem(STORAGE_KEY);
        } catch {}
        return;
      }

      setObjetivosPorDim(porDefecto);
    })();

    return () => { cancelado = true; };
    // Solo al montar o al reintentar: recargar pisaría ediciones en curso.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiBase, intento]);

  // Persistencia con debounce: los sliders disparan un cambio por cada paso y
  // escribir en el Sheet en cada uno sería una request por pixel.
  const pendiente = useRef<Record<Dimension, ObjetivoDim> | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const enviarPendiente = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const aGuardar = pendiente.current;
    pendiente.current = null;
    return aGuardar ? postObjetivos(apiBase, aGuardar) : null;
  }, [apiBase]);

  const guardar = useCallback((next: Record<Dimension, ObjetivoDim>) => {
    pendiente.current = next;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      setEstado('guardando');
      const ok = await enviarPendiente();
      setEstado(ok ? 'guardado' : 'error');
    }, 800);
  }, [enviarPendiente]);

  // Un cambio todavía dentro del debounce se manda igual al salir de la vista o
  // cerrar la página: descartarlo perdía la edición sin ningún aviso.
  useEffect(() => {
    window.addEventListener('pagehide', enviarPendiente);
    return () => {
      window.removeEventListener('pagehide', enviarPendiente);
      enviarPendiente();
    };
  }, [enviarPendiente]);

  function setObjetivo(dim: Dimension, cat: string, val: number) {
    if (!objetivosPorDim) return;
    const next = { ...objetivosPorDim, [dim]: { ...objetivosPorDim[dim], [cat]: val } };
    setObjetivosPorDim(next);
    guardar(next);
  }

  return {
    objetivosPorDim,
    setObjetivo,
    estado,
    errorCarga,
    reintentar: () => setIntento(n => n + 1),
  };
}
