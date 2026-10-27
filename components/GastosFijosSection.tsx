'use client';

import { useState, useEffect, useMemo } from 'react';
import { usePathname } from 'next/navigation';
import type { GastosFijosResponse, GastoFijo, FrecuenciaGasto } from '@/types';
import { formatMoney, type Moneda } from '@/lib/format';
import KPICard from './KPICard';

interface Props {
  hideValues: boolean;
  moneda?: Moneda;
  mepActual: number | null;
}

const CATEGORIA_COLORS = ['#cfab6e', '#5fb896', '#8d7fc7', '#d9824e', '#6fa8d6', '#c15c4a'];

/** Equivalente mensual: los gastos anuales se prorratean /12 para que el total sea comparable. */
function montoMensual(g: GastoFijo): number {
  return g.frecuencia === 'anual' ? g.monto / 12 : g.monto;
}

/** Convierte el monto mensualizado de un gasto a la moneda pedida usando el MEP actual. */
function montoEnMoneda(montoMensualOriginal: number, monedaOrigen: 'ARS' | 'USD', monedaDestino: Moneda, mep: number | null): number | null {
  if (monedaOrigen === monedaDestino) return montoMensualOriginal;
  if (mep == null) return null;
  return monedaOrigen === 'ARS' ? montoMensualOriginal / mep : montoMensualOriginal * mep;
}

interface FormGasto {
  nombre: string;
  monto: string;
  moneda: 'ARS' | 'USD';
  frecuencia: FrecuenciaGasto;
  categoria: string;
}

const FORM_INICIAL: FormGasto = { nombre: '', monto: '', moneda: 'ARS', frecuencia: 'mensual', categoria: '' };

export default function GastosFijosSection({ hideValues, moneda = 'ARS', mepActual }: Props) {
  const [resp, setResp] = useState<GastosFijosResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(FORM_INICIAL);
  const pathname = usePathname();
  const apiBase = pathname?.startsWith('/demo') ? '/api/demo' : '/api';
  const esDemo = pathname?.startsWith('/demo') ?? false;

  function cargar() {
    setLoading(true);
    setError(null);
    fetch(`${apiBase}/gastos-fijos`)
      .then((r) => r.json())
      .then((json) => {
        if (json.error) throw new Error(json.error);
        setResp(json as GastosFijosResponse);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }

  useEffect(cargar, [apiBase]);

  const categoriaColor = useMemo(() => {
    const map = new Map<string, string>();
    const categorias = Array.from(new Set((resp?.gastos ?? []).map((g) => g.categoria)));
    categorias.forEach((c, i) => map.set(c, CATEGORIA_COLORS[i % CATEGORIA_COLORS.length]));
    return map;
  }, [resp]);

  const porCategoria = useMemo(() => {
    if (!resp) return [];
    const map = new Map<string, GastoFijo[]>();
    for (const g of resp.gastos) {
      if (!map.has(g.categoria)) map.set(g.categoria, []);
      map.get(g.categoria)!.push(g);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [resp]);

  const totalMensual = useMemo(() => {
    if (!resp) return 0;
    return resp.gastos.reduce((sum, g) => {
      const v = montoEnMoneda(montoMensual(g), g.moneda, moneda, mepActual);
      return sum + (v ?? 0);
    }, 0);
  }, [resp, moneda, mepActual]);

  const hayInconvertibles = useMemo(() => {
    if (!resp) return false;
    return resp.gastos.some((g) => g.moneda !== moneda && mepActual == null);
  }, [resp, moneda, mepActual]);

  async function guardar(nuevaLista: GastoFijo[]) {
    setSaving(true);
    setError(null);
    try {
      const r = await fetch(`${apiBase}/gastos-fijos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gastos: nuevaLista }),
      });
      const json = await r.json();
      if (json.error) throw new Error(json.error);
      setResp({ gastos: nuevaLista, generatedAt: Date.now() });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
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
    guardar([...(resp?.gastos ?? []), nuevo]);
    setForm(FORM_INICIAL);
  }

  function eliminarGasto(idx: number) {
    if (!resp) return;
    guardar(resp.gastos.filter((_, i) => i !== idx));
  }

  if (loading) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>
        Cargando gastos fijos...
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
          sub={hayInconvertibles ? 'sin MEP para convertir algún gasto' : `${resp?.gastos.length ?? 0} gasto${resp?.gastos.length !== 1 ? 's' : ''} fijo${resp?.gastos.length !== 1 ? 's' : ''}`}
          accentColor="var(--primary)"
        />
        <KPICard
          label="Total anual estimado"
          value={formatMoney(totalMensual * 12, { currency: moneda, hidden: hideValues })}
          sub="12 × el mensual equivalente"
          accentColor="var(--down)"
        />
      </div>

      <div style={{
        background: 'var(--card)', border: '1px solid var(--border)',
        borderRadius: 12, padding: '16px 20px',
      }}>
        <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--muted)', margin: '0 0 12px' }}>
          Detalle por categoría
        </p>

        {porCategoria.length === 0 && (
          <p style={{ fontSize: 13, color: 'var(--muted)', margin: 0 }}>Todavía no hay gastos fijos cargados.</p>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          {porCategoria.map(([categoria, gastos]) => (
            <div key={categoria}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <span style={{
                  width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
                  background: categoriaColor.get(categoria) ?? 'var(--primary)',
                }} />
                <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', textTransform: 'uppercase' }}>{categoria}</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                {gastos.map((g) => {
                  const idxGlobal = resp!.gastos.indexOf(g);
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
              placeholder="Ej. Claude"
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
              placeholder="Suscripciones"
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
