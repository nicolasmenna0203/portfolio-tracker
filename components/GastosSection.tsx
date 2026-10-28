'use client';

import { useState, useMemo } from 'react';
import { usePathname } from 'next/navigation';
import type { GastoFijo, FrecuenciaGasto } from '@/types';
import { formatMoney, formatPercent, type Moneda } from '@/lib/format';
import { totalGastos, type ResumenFlujo } from '@/lib/finanzasPersonales';
import KPICard from './KPICard';

// Catálogo de gastos mensuales: recurrentes (suscripciones, seguros, alquiler)
// y también estimados (supermercado, transporte, salidas) cargados como un
// monto por mes. Cuanto más completo, menos queda "sin asignar" en la franja de
// flujo mensual. Persiste en la hoja `GastosFijos` (nombre histórico, se mantiene
// para no huérfanar el Sheet existente; ver lib/gastosFijos.ts).
//
// La lista la carga FinanzasPersonalesTab (se comparte con Ingresos y
// Proyecciones). Esta sección la edita: guarda en el servidor y le avisa al
// padre con `onChange` para que las demás pestañas vean el cambio.
interface Props {
  gastos: GastoFijo[];
  loading: boolean;
  loadError: string | null;
  onChange: (lista: GastoFijo[]) => void;
  /** Flujo mensual en la moneda del toggle: aporta el ingreso promedio contra el que se miden los gastos. */
  resumen: ResumenFlujo;
  hideValues: boolean;
  moneda?: Moneda;
  mepActual: number | null;
}

const CATEGORIA_COLORS = ['#cfab6e', '#5fb896', '#8d7fc7', '#d9824e', '#6fa8d6', '#c15c4a'];

interface FormGasto {
  nombre: string;
  monto: string;
  moneda: 'ARS' | 'USD';
  frecuencia: FrecuenciaGasto;
  categoria: string;
}

const FORM_INICIAL: FormGasto = { nombre: '', monto: '', moneda: 'ARS', frecuencia: 'mensual', categoria: '' };

export default function GastosSection({
  gastos, loading, loadError, onChange, resumen, hideValues, moneda = 'ARS', mepActual,
}: Props) {
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(FORM_INICIAL);
  const pathname = usePathname();
  const apiBase = pathname?.startsWith('/demo') ? '/api/demo' : '/api';
  const esDemo = pathname?.startsWith('/demo') ?? false;
  const error = saveError ?? loadError;

  const categoriaColor = useMemo(() => {
    const map = new Map<string, string>();
    const categorias = Array.from(new Set(gastos.map((g) => g.categoria)));
    categorias.forEach((c, i) => map.set(c, CATEGORIA_COLORS[i % CATEGORIA_COLORS.length]));
    return map;
  }, [gastos]);

  // Cada categoría con su total mensual en la moneda del toggle.
  const porCategoria = useMemo(() => {
    const map = new Map<string, GastoFijo[]>();
    for (const g of gastos) {
      if (!map.has(g.categoria)) map.set(g.categoria, []);
      map.get(g.categoria)!.push(g);
    }
    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([categoria, items]) => ({
        categoria,
        items,
        total: totalGastos(items, moneda, mepActual).total,
      }));
  }, [gastos, moneda, mepActual]);

  const { total: totalMensual, incompleto: hayInconvertibles } = useMemo(
    () => totalGastos(gastos, moneda, mepActual),
    [gastos, moneda, mepActual],
  );

  const ingresoProm = resumen.ingresoProm;
  const pctIngreso = (monto: number) =>
    ingresoProm != null && ingresoProm > 0 ? (monto / ingresoProm) * 100 : null;

  // Categoría con más peso en el gasto total (para la tercera tarjeta).
  const principal = porCategoria.reduce<typeof porCategoria[number] | null>(
    (max, c) => (max == null || c.total > max.total ? c : max), null);

  async function guardar(nuevaLista: GastoFijo[]) {
    setSaving(true);
    setSaveError(null);
    try {
      const r = await fetch(`${apiBase}/gastos-fijos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gastos: nuevaLista }),
      });
      const json = await r.json();
      if (json.error) throw new Error(json.error);
      onChange(nuevaLista);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  function agregarGasto(e: React.FormEvent) {
    e.preventDefault();
    const monto = Number(form.monto.replace(',', '.'));
    if (!form.nombre.trim() || !Number.isFinite(monto) || monto <= 0) return;
    const nuevo: GastoFijo = {
      nombre: form.nombre.trim(),
      monto,
      moneda: form.moneda,
      frecuencia: form.frecuencia,
      categoria: form.categoria.trim() || 'Sin categoría',
    };
    guardar([...gastos, nuevo]);
    setForm(FORM_INICIAL);
  }

  function eliminarGasto(idx: number) {
    guardar(gastos.filter((_, i) => i !== idx));
  }

  if (loading) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>
        Cargando gastos...
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {error && (
        <div style={{
          background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.3)',
          borderRadius: 8, padding: '14px 18px',
        }}>
          <p style={{ fontSize: 12, fontWeight: 700, color: '#ef4444', margin: '0 0 4px' }}>Error</p>
          <p style={{ fontSize: 13, color: 'var(--text)', margin: 0 }}>{error}</p>
        </div>
      )}

      <div className="kpi-grid">
        <KPICard
          label="Total mensual"
          value={formatMoney(totalMensual, { currency: moneda, hidden: hideValues })}
          sub={hayInconvertibles
            ? 'sin MEP para convertir algún gasto'
            : pctIngreso(totalMensual) != null
              ? `${formatPercent(pctIngreso(totalMensual), { sign: false, decimals: 1, hidden: hideValues })} del ingreso mensual`
              : `${gastos.length} gasto${gastos.length !== 1 ? 's' : ''} cargado${gastos.length !== 1 ? 's' : ''}`}
          accentColor="var(--primary)"
          tooltip="Suma de lo cargado, a monto mensual: los anuales se prorratean /12 y los de otra moneda se convierten con el MEP actual. El porcentaje es sobre el ingreso promedio de los últimos meses cerrados."
        />
        <KPICard
          label="Total anual estimado"
          value={formatMoney(totalMensual * 12, { currency: moneda, hidden: hideValues })}
          sub="12 × el mensual equivalente"
          accentColor="var(--down)"
        />
        <KPICard
          label="Categoría principal"
          value={principal && totalMensual > 0 ? principal.categoria : 's/d'}
          sub={principal && totalMensual > 0
            ? `${formatPercent((principal.total / totalMensual) * 100, { sign: false, decimals: 0, hidden: hideValues })} del gasto total`
            : 'cargá un gasto para ver el reparto'}
          accentColor="var(--up)"
        />
      </div>

      {/* Reparto por categoría y lo que todavía no está explicado: el residuo de la
          franja de arriba, acá como llamado a cargar más gastos. */}
      {totalMensual > 0 && !hideValues && (
        <div style={{
          background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12,
          padding: '12px 18px',
        }}>
          <div
            role="img"
            aria-label={porCategoria.map((c) => `${c.categoria} ${Math.round((c.total / totalMensual) * 100)}%`).join(', ')}
            style={{ display: 'flex', height: 10, borderRadius: 5, overflow: 'hidden', background: 'var(--border)' }}
          >
            {porCategoria.map((c) => (
              <div key={c.categoria} style={{ width: `${(c.total / totalMensual) * 100}%`, background: categoriaColor.get(c.categoria) }} />
            ))}
          </div>
          {resumen.sinAsignar != null && resumen.sinAsignar > 0 && (
            <p style={{ margin: '10px 0 0', fontSize: 11, color: 'var(--muted)', lineHeight: 1.5 }}>
              Sin asignar: <strong style={{ color: 'var(--text-sec)', fontVariantNumeric: 'tabular-nums' }}>
                {formatMoney(resumen.sinAsignar, { currency: moneda })}
              </strong>
              {resumen.sinAsignarPct != null && ` (${formatPercent(resumen.sinAsignarPct, { sign: false, decimals: 0 })} del ingreso)`}
              {' '}por mes: ingreso que no está ni en los gastos cargados ni en aportes a la cartera.
              Es gasto sin cargar o ahorro fuera de la cartera.
            </p>
          )}
        </div>
      )}

      <div style={{
        background: 'var(--card)', border: '1px solid var(--border)',
        borderRadius: 12, padding: '16px 20px',
      }}>
        <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--muted)', margin: '0 0 12px' }}>
          Detalle por categoría
        </p>

        {porCategoria.length === 0 && (
          <p style={{ fontSize: 13, color: 'var(--muted)', margin: 0 }}>Todavía no hay gastos cargados. Sumá los recurrentes (suscripciones, seguros, alquiler) y los que estimás por mes (supermercado, transporte, salidas).</p>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          {porCategoria.map(({ categoria, items, total }) => (
            <div key={categoria}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <span style={{
                  width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
                  background: categoriaColor.get(categoria) ?? 'var(--primary)',
                }} />
                <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', textTransform: 'uppercase', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{categoria}</span>
                {/* Subtotal mensual de la categoría y su peso sobre el ingreso. */}
                <span style={{ marginLeft: 'auto', flexShrink: 0, fontSize: 11, color: 'var(--muted)', fontVariantNumeric: 'tabular-nums' }}>
                  {formatMoney(total, { currency: moneda, hidden: hideValues })}
                  {pctIngreso(total) != null && !hideValues && ` · ${formatPercent(pctIngreso(total), { sign: false, decimals: 1 })}`}
                </span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                {items.map((g) => {
                  const idxGlobal = gastos.indexOf(g);
                  return (
                    <div
                      key={`${g.nombre}-${idxGlobal}`}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 12,
                        padding: '8px 4px', borderBottom: '1px solid var(--border-subtle)',
                        fontSize: 13,
                      }}
                    >
                      <span style={{ color: 'var(--text)', fontWeight: 600, flex: 1 }}>{g.nombre}</span>
                      <span style={{ color: 'var(--muted)', fontSize: 11, flexShrink: 0 }}>
                        {g.frecuencia === 'anual' ? 'anual' : 'mensual'}
                      </span>
                      <span style={{ color: 'var(--down)', fontWeight: 600, flexShrink: 0, minWidth: 90, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                        {formatMoney(g.monto, { currency: g.moneda, hidden: hideValues })}
                      </span>
                      {!esDemo && (
                        <button
                          onClick={() => eliminarGasto(idxGlobal)}
                          disabled={saving}
                          aria-label={`Eliminar ${g.nombre}`}
                          style={{
                            background: 'none', border: 'none', cursor: saving ? 'default' : 'pointer',
                            color: 'var(--muted)', fontSize: 15, lineHeight: 1, padding: '0 2px',
                            flexShrink: 0,
                          }}
                        >×</button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      {!esDemo && (
        <form
          onSubmit={agregarGasto}
          style={{
            background: 'var(--card)', border: '1px solid var(--border)',
            borderRadius: 12, padding: '16px 20px',
            display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'flex-end',
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 2, minWidth: 140 }}>
            <label style={{ fontSize: 11, color: 'var(--muted)' }}>Nombre</label>
            <input
              value={form.nombre}
              onChange={(e) => setForm((f) => ({ ...f, nombre: e.target.value }))}
              placeholder="Ej. Supermercado"
              style={{ padding: '7px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', fontSize: 13 }}
            />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1, minWidth: 90 }}>
            <label style={{ fontSize: 11, color: 'var(--muted)' }}>Monto</label>
            <input
              value={form.monto}
              onChange={(e) => setForm((f) => ({ ...f, monto: e.target.value }))}
              placeholder="0"
              inputMode="decimal"
              style={{ padding: '7px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', fontSize: 13 }}
            />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <label style={{ fontSize: 11, color: 'var(--muted)' }}>Moneda</label>
            <select
              value={form.moneda}
              onChange={(e) => setForm((f) => ({ ...f, moneda: e.target.value as 'ARS' | 'USD' }))}
              style={{ padding: '7px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', fontSize: 13 }}
            >
              <option value="ARS">ARS</option>
              <option value="USD">USD</option>
            </select>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <label style={{ fontSize: 11, color: 'var(--muted)' }}>Frecuencia</label>
            <select
              value={form.frecuencia}
              onChange={(e) => setForm((f) => ({ ...f, frecuencia: e.target.value as FrecuenciaGasto }))}
              style={{ padding: '7px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', fontSize: 13 }}
            >
              <option value="mensual">Mensual</option>
              <option value="anual">Anual</option>
            </select>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1, minWidth: 100 }}>
            <label style={{ fontSize: 11, color: 'var(--muted)' }}>Categoría</label>
            <input
              value={form.categoria}
              onChange={(e) => setForm((f) => ({ ...f, categoria: e.target.value }))}
              placeholder="Comida"
              style={{ padding: '7px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', fontSize: 13 }}
            />
          </div>
          <button
            type="submit"
            disabled={saving}
            style={{
              padding: '8px 16px', borderRadius: 6, border: '1px solid var(--primary)',
              background: 'var(--primary-dim)', color: 'var(--primary)', fontSize: 13, fontWeight: 600,
              cursor: saving ? 'default' : 'pointer',
            }}
          >{saving ? 'Guardando...' : 'Agregar'}</button>
        </form>
      )}
    </div>
  );
}
