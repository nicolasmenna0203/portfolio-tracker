import type { TooltipContentProps } from 'recharts';

/** Una serie del tooltip, con los tipos que usan los gráficos del dashboard. */
export interface FilaTooltip {
  dataKey: string;
  name: string;
  value: number | null;
  color?: string;
}

/**
 * Normaliza el `payload` que recharts le pasa al `content` de un Tooltip. En
 * recharts 3 llega con tipos amplios (el valor puede ser string, número o un
 * rango; la clave, una función): todos los gráficos de acá grafican números
 * con claves string, así que se convierte una sola vez en lugar de en cada uso.
 */
export function filasTooltip(payload: TooltipContentProps<number, string>['payload'] | undefined): FilaTooltip[] {
  return (payload ?? []).map((p) => ({
    dataKey: typeof p.dataKey === 'function' ? '' : String(p.dataKey ?? ''),
    name: String(p.name ?? ''),
    value: typeof p.value === 'number' ? p.value : p.value == null ? null : Number(p.value),
    color: p.color,
  }));
}
