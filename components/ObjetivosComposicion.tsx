'use client';

// Objetivos de % de cartera por dimensión, editables con sliders y persistidos
// en el Sheet. Vive como modo "Objetivo" dentro de Tenencias (junto a
// Composición y Variación) porque comparte exactamente las mismas 5
// dimensiones y datos que esas dos vistas — antes vivía al final de
// Proyecciones, sin relación con el simulador de capital de esa pestaña.

import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { usePathname } from 'next/navigation';
import type { TenenciaActual } from '@/types';
import { formatPercent } from '@/lib/format';
import {
  RIESGO_LABEL, RENTA_LABEL, GEO_LABEL, MONEDA_LABEL,
  PALETA_TIPO, RIESGO_COLOR, RENTA_COLOR, GEO_COLOR, MONEDA_COLOR,
  colorPorCategoria,
} from '@/lib/constants';

type DimObj = 'SECTOR_GEO' | 'TIPO' | 'RENTA' | 'RIESGO' | 'MONEDA';

interface ObjetivoDim {
  [categoria: string]: number; // % objetivo (0-100)
}

// Mismo orden y labels que las otras vistas de Tenencias
const DIMS_CONFIG: { key: DimObj; label: string }[] = [
  { key: 'TIPO',       label: 'Tipo de Activo' },
  { key: 'RIESGO',     label: 'Nivel de Riesgo'},
  { key: 'MONEDA',     label: 'Moneda'          },
  { key: 'RENTA',      label: 'Tipo de Renta'  },
  { key: 'SECTOR_GEO', label: 'Geografía'      },
];

// Misma lógica de color que InformeTab / TreemapChart
function colorParaCat(dim: DimObj, cat: string): string {
  if (dim === 'TIPO')       return PALETA_TIPO[cat]   ?? colorPorCategoria(cat);
  if (dim === 'RIESGO')     return RIESGO_COLOR[cat]  ?? colorPorCategoria(cat);
  if (dim === 'MONEDA')     return MONEDA_COLOR[cat]  ?? colorPorCategoria(cat);
  if (dim === 'RENTA')      return RENTA_COLOR[cat]   ?? colorPorCategoria(cat);
  if (dim === 'SECTOR_GEO') return GEO_COLOR[cat]     ?? colorPorCategoria(cat);
  return colorPorCategoria(cat);
}

// Misma lógica de resolución de etiqueta que InformeTab (getLabel)
function resolverCategoria(t: TenenciaActual, dim: DimObj): string {
  if (dim === 'SECTOR_GEO') return GEO_LABEL[t.SECTOR_GEO]      ?? t.SECTOR_GEO ?? 'Sin dato';
  if (dim === 'RENTA')      return RENTA_LABEL[t.RENTA]          ?? t.RENTA      ?? 'Sin dato';
  if (dim === 'RIESGO')     return RIESGO_LABEL[Number(t.RIESGO)] ?? 'Sin dato';
  if (dim === 'MONEDA')     return MONEDA_LABEL[t.MONEDA]        ?? t.MONEDA     ?? 'Sin dato';
  return t.TIPO ?? 'Sin dato';
}

function filtrarParaDim(tenencias: TenenciaActual[], dim: DimObj): TenenciaActual[] {
  if (dim === 'SECTOR_GEO') return tenencias.filter(t => t.RENTA === 'VAR' || t.RENTA === 'VARIABLE');
  return tenencias;
}

function getCategorias(tenencias: TenenciaActual[], dim: DimObj): string[] {
  const set = new Set<string>();
  for (const t of filtrarParaDim(tenencias, dim)) set.add(resolverCategoria(t, dim));
  return Array.from(set).sort();
}

function getPctReal(tenencias: TenenciaActual[], dim: DimObj): Record<string, number> {
  const src = filtrarParaDim(tenencias, dim);
  const total = src.reduce((s, t) => s + t.tenencia_usd, 0);
  if (total === 0) return {};
  const map: Record<string, number> = {};
  for (const t of src) {
    const cat = resolverCategoria(t, dim);
    map[cat] = (map[cat] ?? 0) + (t.tenencia_usd / total) * 100;
  }
  return map;
}

// Suma de objetivos para la dimensión activa
function sumaObjetivos(obj: ObjetivoDim): number {
  return Object.values(obj).reduce((s, v) => s + v, 0);
}

// Barra de progreso con objetivo
function BarraObjetivo({
  categoria, pctReal, pctObj, color,
}: {
  categoria: string; pctReal: number; pctObj: number; color: string;
}) {
  const tieneObjetivo = pctObj > 0;
  const diff = pctReal - pctObj;
  const diffLabel = formatPercent(diff);
  const diffColor = Math.abs(diff) <= 3 ? 'var(--up)' : Math.abs(diff) <= 8 ? '#ffa15a' : 'var(--down)';
  const enRango = tieneObjetivo && Math.abs(diff) <= 3;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>{categoria}</span>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <span style={{ fontSize: 11, color: 'var(--muted)' }}>
            Real: <strong style={{ color: 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>{formatPercent(pctReal, { sign: false })}</strong>
          </span>
          <span style={{ fontSize: 11, color: 'var(--muted)' }}>
            Obj: <strong style={{ color: tieneObjetivo ? color : 'var(--muted)', fontVariantNumeric: 'tabular-nums' }}>
              {tieneObjetivo ? formatPercent(pctObj, { sign: false, decimals: 0 }) : '—'}
            </strong>
          </span>
          {tieneObjetivo && (
            <span style={{
              fontSize: 10, fontWeight: 700, color: diffColor,
              background: enRango ? 'rgba(45,198,83,0.12)' : 'transparent',
              padding: '1px 5px',
              borderRadius: 4,
              fontVariantNumeric: 'tabular-nums',
            }}>
              {enRango ? '✓' : diffLabel}
            </span>
          )}
        </div>
      </div>
      {/* Barra: track completo = 100% de la cartera */}
      <div style={{ position: 'relative', height: 8, background: 'var(--border)', borderRadius: 4, overflow: 'hidden' }}>
        {/* Relleno real */}
        <div style={{
          position: 'absolute', left: 0, top: 0, height: '100%',
          width: `${Math.min(100, pctReal)}%`,
          background: color,
          borderRadius: 4,
          opacity: 0.85,
          transition: 'width 0.3s',
        }} />
        {/* Marcador objetivo: línea vertical blanca sobre la barra */}
        {tieneObjetivo && (
          <div style={{
            position: 'absolute',
            left: `${Math.min(99, pctObj)}%`,
            top: 0, bottom: 0,
            width: 2,
            background: 'var(--text)',
            opacity: 0.6,
            transform: 'translateX(-50%)',
          }} />
        )}
      </div>
    </div>
  );
}

// Redondea porcentajes garantizando que sumen exactamente 100 (largest remainder)
function initObjetivosDim(tenencias: TenenciaActual[], dim: DimObj): ObjetivoDim {
  const real = getPctReal(tenencias, dim);
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

type EstadoGuardado = 'inicial' | 'guardando' | 'guardado' | 'error';

export default function ObjetivosComposicion({ tenencias }: { tenencias: TenenciaActual[] }) {
  const [dimActiva, setDimActiva] = useState<DimObj>('TIPO');
  const [objetivosPorDim, setObjetivosPorDim] = useState<Record<DimObj, ObjetivoDim> | null>(null);
  const [estado, setEstado] = useState<EstadoGuardado>('inicial');
  const pathname = usePathname();
  const apiBase = pathname?.startsWith('/demo') ? '/api/demo' : '/api';

  // Valores por defecto: la composición actual redondeada, para que arrancar sea
  // ajustar desde donde se está y no desde cero.
  const porDefecto = useMemo((): Record<DimObj, ObjetivoDim> => ({
    TIPO:       initObjetivosDim(tenencias, 'TIPO'),
    RIESGO:     initObjetivosDim(tenencias, 'RIESGO'),
    MONEDA:     initObjetivosDim(tenencias, 'MONEDA'),
    RENTA:      initObjetivosDim(tenencias, 'RENTA'),
    SECTOR_GEO: initObjetivosDim(tenencias, 'SECTOR_GEO'),
  }), [tenencias]);

  // Carga inicial desde el Sheet. Si no hay nada guardado todavía, se migra lo
  // que hubiera en localStorage; si tampoco hay, se usan los valores por defecto.
  useEffect(() => {
    let cancelado = false;

    (async () => {
      let delSheet: Record<DimObj, ObjetivoDim> | null = null;
      try {
        const res = await fetch(`${apiBase}/objetivos`);
        if (res.ok) {
          const json = await res.json();
          const obj = json?.objetivos as Record<DimObj, ObjetivoDim> | undefined;
          if (obj && DIMS_CONFIG.some(d => Object.keys(obj[d.key] ?? {}).length > 0)) {
            delSheet = obj;
          }
        }
      } catch {
        // Sin conexión al Sheet se sigue con local/defaults: la sección es
        // usable aunque no se pueda persistir.
      }
      if (cancelado) return;

      if (delSheet) {
        setObjetivosPorDim(delSheet);
        try { localStorage.removeItem(STORAGE_KEY); } catch {}
        return;
      }

      let local: Record<DimObj, ObjetivoDim> | null = null;
      try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) local = JSON.parse(saved) as Record<DimObj, ObjetivoDim>;
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
    // Solo al montar: recargar pisaría ediciones en curso.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiBase]);

  // Persistencia con debounce: los sliders disparan un cambio por cada paso y
  // escribir en el Sheet en cada uno sería una request por pixel.
  const pendiente = useRef<Record<DimObj, ObjetivoDim> | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const guardar = useCallback((next: Record<DimObj, ObjetivoDim>) => {
    pendiente.current = next;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      const aGuardar = pendiente.current;
      if (!aGuardar) return;
      setEstado('guardando');
      try {
        const res = await fetch(`${apiBase}/objetivos`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ objetivos: aGuardar }),
        });
        setEstado(res.ok ? 'guardado' : 'error');
      } catch {
        setEstado('error');
      }
    }, 800);
  }, [apiBase]);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const categorias = useMemo(() => getCategorias(tenencias, dimActiva), [tenencias, dimActiva]);
  const pctReal    = useMemo(() => getPctReal(tenencias, dimActiva),    [tenencias, dimActiva]);
  const objetivos  = objetivosPorDim?.[dimActiva] ?? {};
  const suma       = sumaObjetivos(objetivos);
  const resta      = Math.max(0, 100 - suma);

  function setObjetivo(cat: string, val: number) {
    setObjetivosPorDim(prev => {
      const base = prev ?? porDefecto;
      const next = { ...base, [dimActiva]: { ...base[dimActiva], [cat]: val } };
      guardar(next);
      return next;
    });
  }

  return (
    <div style={{
      background: 'var(--card)',
      border: '1px solid var(--border)',
      borderRadius: 12,
      padding: '18px 20px',
      display: 'flex',
      flexDirection: 'column',
      gap: 16,
    }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <p style={{ margin: 0, fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--primary)' }}>
            Objetivos de Composición
          </p>
          {estado !== 'inicial' && (
            <span style={{
              fontSize: 10,
              color: estado === 'error' ? 'var(--down)' : 'var(--muted)',
            }}>
              {estado === 'guardando' ? 'Guardando…'
                : estado === 'guardado' ? 'Guardado ✓'
                : 'No se pudo guardar'}
            </span>
          )}
        </div>
        {/* Selector de dimensión */}
        <div style={{ display: 'flex', gap: 4 }}>
          {DIMS_CONFIG.map(d => (
            <button
              key={d.key}
              onClick={() => setDimActiva(d.key)}
              style={{
                padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 500,
                cursor: 'pointer', border: '1px solid',
                borderColor: dimActiva === d.key ? 'var(--primary)' : 'var(--border)',
                background:  dimActiva === d.key ? 'var(--primary-dim)' : 'transparent',
                color:       dimActiva === d.key ? 'var(--primary)' : 'var(--muted)',
                transition: 'all 0.12s',
              }}
            >{d.label}</button>
          ))}
        </div>
      </div>

      {/* Indicador de suma */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ flex: 1, height: 4, background: 'var(--bg)', borderRadius: 2, overflow: 'hidden' }}>
          <div style={{
            height: '100%',
            width: `${Math.min(100, suma)}%`,
            background: suma > 100 ? 'var(--down)' : suma === 100 ? 'var(--up)' : 'var(--primary)',
            borderRadius: 2,
            transition: 'width 0.2s, background 0.2s',
          }} />
        </div>
        <span style={{
          fontSize: 11, fontWeight: 700,
          color: suma > 100 ? 'var(--down)' : suma === 100 ? 'var(--up)' : 'var(--muted)',
          minWidth: 90, textAlign: 'right', fontVariantNumeric: 'tabular-nums',
        }}>
          {suma > 100
            ? `Excede ${formatPercent(suma - 100, { sign: false, decimals: 0 })}`
            : suma === 100
            ? 'Suma 100% ✓'
            : `Disponible: ${formatPercent(resta, { sign: false, decimals: 0 })}`}
        </span>
      </div>

      {/* Filas por categoría */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {categorias.map((cat) => {
          const color = colorParaCat(dimActiva, cat);
          const pctR = pctReal[cat] ?? 0;
          const pctO = objetivos[cat] ?? 0;
          return (
            <div key={cat} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <BarraObjetivo categoria={cat} pctReal={pctR} pctObj={pctO} color={color} />
              {/* Slider de objetivo */}
              <input
                type="range" min={0} max={100} step={1}
                value={pctO}
                onChange={e => setObjetivo(cat, Number(e.target.value))}
                style={{ width: '100%', accentColor: color }}
                className="slider-cat"
              />
            </div>
          );
        })}
      </div>

      {/* Nota si no hay tenencias */}
      {categorias.length === 0 && (
        <p style={{ margin: 0, fontSize: 12, color: 'var(--muted)', textAlign: 'center' }}>
          No hay tenencias disponibles para este mes.
        </p>
      )}
    </div>
  );
}
