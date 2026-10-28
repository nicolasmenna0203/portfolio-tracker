'use client';

// Carga ingresos y gastos una sola vez para las tres sub-pestañas de
// finanzas personales. Antes cada sección hacía su propio fetch y lo repetía al
// cambiar de pestaña; además, ninguna podía ver los datos de la otra, que es
// justo lo que necesita el ratio de inversión (ingresos × gastos × aportes).
//
// Los dos recursos fallan por separado: que falte la hoja de Ingresos no tiene
// por qué esconder los gastos, y viceversa.

import { useEffect, useState, useCallback } from 'react';
import type { IngresosResponse, GastoFijo, GastosFijosResponse } from '@/types';

async function getJson<T>(url: string): Promise<T> {
  const r = await fetch(url);
  const json = await r.json();
  if (json.error) throw new Error(json.error);
  return json as T;
}

const mensaje = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function useFinanzasPersonales(apiBase: string) {
  const [ingresos, setIngresos] = useState<IngresosResponse | null>(null);
  const [gastos, setGastos] = useState<GastoFijo[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorIngresos, setErrorIngresos] = useState<string | null>(null);
  const [errorGastos, setErrorGastos] = useState<string | null>(null);

  useEffect(() => {
    let cancelado = false;
    setLoading(true);
    setErrorIngresos(null);
    setErrorGastos(null);

    Promise.allSettled([
      getJson<IngresosResponse>(`${apiBase}/ingresos`),
      getJson<GastosFijosResponse>(`${apiBase}/gastos-fijos`),
    ]).then(([ing, gas]) => {
      if (cancelado) return;
      if (ing.status === 'fulfilled') setIngresos(ing.value);
      else setErrorIngresos(mensaje(ing.reason));
      if (gas.status === 'fulfilled') setGastos(gas.value.gastos);
      else setErrorGastos(mensaje(gas.reason));
      setLoading(false);
    });

    return () => { cancelado = true; };
  }, [apiBase]);

  /** La sección de gastos guarda en el servidor y avisa acá para que las demás vean la lista nueva. */
  const actualizarGastos = useCallback((lista: GastoFijo[]) => setGastos(lista), []);

  return { ingresos, gastos, actualizarGastos, loading, errorIngresos, errorGastos };
}
