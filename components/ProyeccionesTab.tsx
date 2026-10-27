'use client';

import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { usePathname } from 'next/navigation';
import {
  ComposedChart, Line, Area, XAxis, YAxis, Tooltip,
  CartesianGrid, ResponsiveContainer, ReferenceLine,
} from 'recharts';
import type { DashboardData, TenenciaActual } from '@/types';
import { useIsMobile } from '@/lib/useIsMobile';
import { formatMoney, formatPercent, formatNumber } from '@/lib/format';
import {
  RIESGO_LABEL, RENTA_LABEL, GEO_LABEL, MONEDA_LABEL,
  PALETA_TIPO, RIESGO_COLOR, RENTA_COLOR, GEO_COLOR, MONEDA_COLOR,
  colorPorCategoria,
} from '@/lib/constants';

interface Props {
  data: DashboardData;
  hideValues: boolean;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function SliderRow({
  label, value, min, max, step, fmt, onChange,
}: {
  label: string; value: number; min: number; max: number;
  step: number; fmt: (v: number) => string; onChange: (v: number) => void;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          {label}
        </span>
        <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--primary)', fontVariantNumeric: 'tabular-nums' }}>
          {fmt(value)}
        </span>
      </div>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(Number(e.target.value))}
        style={{ width: '100%', accentColor: 'var(--primary)', cursor: 'pointer' }}
      />
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 10, color: 'var(--muted)', fontVariantNumeric: 'tabular-nums' }}>{fmt(min)}</span>
        <span style={{ fontSize: 10, color: 'var(--muted)', fontVariantNumeric: 'tabular-nums' }}>{fmt(max)}</span>
      </div>
    </div>
  );
}

interface TooltipPayload {
  name: string;
  value: number;
  color: string;
  dataKey: string;
}

function CustomTooltip({ active, payload, label }: { active?: boolean; payload?: TooltipPayload[]; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background: 'var(--card)', border: '1px solid var(--border)',
      borderRadius: 8, padding: '10px 14px', fontSize: 12,
    }}>
      <p style={{ margin: '0 0 6px', color: 'var(--muted)', fontWeight: 600 }}>{label}</p>
      {payload.map((p) => (
        p.value != null && (
          <p key={p.dataKey} style={{ margin: '2px 0', color: p.color }}>
            {p.name}: <strong style={{ fontVariantNumeric: 'tabular-nums' }}>{formatMoney(p.value, { currency: 'USD' })}</strong>
          </p>
        )
      ))}
    </div>
  );
}

// ── Proyección compuesta ──────────────────────────────────────────────────────

function buildProyeccion(
  totalActual: number,
  aporteMensual: number,
  tasaAnual: number,
  horizonteMeses: number,
): { mes: number; proyectado: number }[] {
  const tasaMensual = Math.pow(1 + tasaAnual / 100, 1 / 12) - 1;
  const puntos: { mes: number; proyectado: number }[] = [];
  let acum = totalActual;
  for (let i = 1; i <= horizonteMeses; i++) {
    acum = acum * (1 + tasaMensual) + aporteMensual;
    puntos.push({ mes: i, proyectado: Math.round(acum) });
  }
  return puntos;
}

// ── Etiqueta de mes relativo ──────────────────────────────────────────────────

function labelMesFuturo(mesOffset: number, ultimaFecha: string): string {
  const mesesES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
  // ultimaFecha es tipo "Mar-2025"
  const partes = ultimaFecha.split('-');
  const mesesMap: Record<string, number> = {
    Ene: 0, Feb: 1, Mar: 2, Abr: 3, May: 4, Jun: 5,
    Jul: 6, Ago: 7, Sep: 8, Oct: 9, Nov: 10, Dic: 11,
  };
  const mesInicial = mesesMap[partes[0]] ?? 0;
  const anioInicial = parseInt(partes[1]) || new Date().getFullYear();
  const total = mesInicial + mesOffset;
  const mes = total % 12;
  const anio = anioInicial + Math.floor(total / 12);
  return `${mesesES[mes]}-${anio}`;
}

// ── Tipos para objetivos de composición ──────────────────────────────────────

type DimObj = 'SECTOR_GEO' | 'TIPO' | 'RENTA' | 'RIESGO' | 'MONEDA';

interface ObjetivoDim {
  [categoria: string]: number; // % objetivo (0-100)
}

// Mismo orden y labels que InformeTab
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

// ── Sección de objetivos de composición ──────────────────────────────────────

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

function ObjetivosComposicion({ tenencias }: { tenencias: TenenciaActual[] }) {
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
          No hay tenencias disponibles para el último mes.
        </p>
      )}
    </div>
  );
}

// ── Componente principal ──────────────────────────────────────────────────────

export default function ProyeccionesTab({ data, hideValues }: Props) {
  const { kpis, resumenSeries, tenenciasPorMes } = data;
  const isMobile = useIsMobile();
  const totalActual = kpis.totalCartera;

  // Tenencias del último mes disponible
  const tenenciasActuales = useMemo(() => {
    const sorted = Object.keys(tenenciasPorMes).sort();
    return tenenciasPorMes[sorted[sorted.length - 1]] ?? [];
  }, [tenenciasPorMes]);
  const ultimaFecha = resumenSeries[resumenSeries.length - 1]?.fecha ?? '';

  // ── Controles (persistidos en localStorage)
  const PARAMS_KEY = 'proyecciones_params_v1';
  function loadParams() {
    try {
      const s = localStorage.getItem(PARAMS_KEY);
      if (s) return JSON.parse(s) as { aporte: number; tasa: number; horizonte: number; objetivo: number };
    } catch {}
    return null;
  }
  function saveParams(p: { aporte: number; tasa: number; horizonte: number; objetivo: number }) {
    try { localStorage.setItem(PARAMS_KEY, JSON.stringify(p)); } catch {}
  }

  const saved = loadParams();
  const [aporte,    setAporte]    = useState(saved?.aporte    ?? 500);
  const [tasa,      setTasa]      = useState(saved?.tasa      ?? 10);
  const [horizonte, setHorizonte] = useState(saved?.horizonte ?? 60);
  const [objetivo,  setObjetivo]  = useState(saved?.objetivo  ?? (Math.round(totalActual * 2 / 1000) * 1000 || 100000));

  function updateAporte(v: number)    { setAporte(v);    saveParams({ aporte: v,    tasa, horizonte, objetivo }); }
  function updateTasa(v: number)      { setTasa(v);      saveParams({ aporte, tasa: v,      horizonte, objetivo }); }
  function updateHorizonte(v: number) { setHorizonte(v); saveParams({ aporte, tasa, horizonte: v, objetivo }); }
  function updateObjetivo(v: number)  { setObjetivo(v);  saveParams({ aporte, tasa, horizonte, objetivo: v }); }

  // ── Datos históricos normalizados para el gráfico
  const historico = useMemo(() =>
    resumenSeries.map(r => ({
      label: r.fecha,
      real: Math.round(r.total_cartera),
      proyectado: undefined as number | undefined,
    })),
  [resumenSeries]);

  // ── Proyección futura
  const proyeccion = useMemo(() =>
    buildProyeccion(totalActual, aporte, tasa, horizonte),
  [totalActual, aporte, tasa, horizonte]);

  // ── Datos combinados para el gráfico
  const chartData = useMemo(() => {
    const hist = historico.map(h => ({ ...h, proyectado: undefined as number | undefined }));
    // Punto de unión: el último histórico también tiene valor proyectado = totalActual
    if (hist.length > 0) {
      hist[hist.length - 1].proyectado = Math.round(totalActual);
    }
    const future = proyeccion.map((p, i) => ({
      label: labelMesFuturo(i + 1, ultimaFecha),
      real: undefined as number | undefined,
      proyectado: p.proyectado,
    }));
    return [...hist, ...future];
  }, [historico, proyeccion, totalActual, ultimaFecha]);

  // ── Cuándo se alcanza el objetivo
  const mesObjetivo = useMemo(() => {
    if (objetivo <= totalActual) return 0;
    const idx = proyeccion.findIndex(p => p.proyectado >= objetivo);
    return idx === -1 ? null : idx + 1;
  }, [proyeccion, objetivo, totalActual]);

  const labelMesObj = mesObjetivo != null && mesObjetivo > 0
    ? labelMesFuturo(mesObjetivo, ultimaFecha)
    : null;

  const finalProyectado = proyeccion[proyeccion.length - 1]?.proyectado ?? totalActual;
  const aportesTotales = aporte * horizonte;
  // El capital proyectado se descompone en tres partes disjuntas:
  //   capital = cartera hoy + aportes acumulados + interés generado
  // La "ganancia" es solo la tercera: lo que aportás es plata tuya que cambiás
  // de lugar, no una ganancia. Antes acá se mostraba (final - totalActual), que
  // incluía los aportes y por eso duplicaba la cifra.
  const interesGenerado = finalProyectado - totalActual - aportesTotales;

  // ── Ticks del eje X (mostrar cada N puntos para no saturar)
  const totalPuntos = chartData.length;
  const cadaNPuntos = Math.max(1, Math.floor(totalPuntos / 8));

  return (
    <div className="proy-root scroll-y" style={{ display: 'flex', flexDirection: 'column', gap: 16, flex: 1, minHeight: 0 }}>

      {/* ── Fila principal: controles + KPIs ──────────────────────────────── */}
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'stretch' }}>

        {/* Panel de controles */}
        <div className="proy-controles" style={{
          background: 'var(--card)',
          border: '1px solid var(--border)',
          borderRadius: 12,
          padding: '18px 20px',
          display: 'flex',
          flexDirection: 'column',
          gap: 18,
          minWidth: 240,
          flex: '0 0 260px',
        }}>
          <p style={{ margin: 0, fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--primary)' }}>
            Parámetros
          </p>
          <SliderRow
            label="Aporte mensual"
            value={aporte} min={0} max={5000} step={50}
            fmt={v => formatMoney(v, { currency: 'USD' })}
            onChange={updateAporte}
          />
          <SliderRow
            label="Tasa anual estimada"
            value={tasa} min={1} max={30} step={0.5}
            fmt={v => formatPercent(v, { sign: false })}
            onChange={updateTasa}
          />
          <SliderRow
            label="Horizonte"
            value={horizonte} min={6} max={120} step={6}
            fmt={v => v >= 12 ? `${formatNumber(v / 12, { decimals: 1 })} años` : `${v} meses`}
            onChange={updateHorizonte}
          />
          <SliderRow
            label="Objetivo de capital"
            value={objetivo} min={10000} max={1000000} step={5000}
            fmt={v => formatMoney(v, { currency: 'USD' })}
            onChange={updateObjetivo}
          />
        </div>

        {/* KPIs de proyección — grilla 2×2 (1 columna en mobile: ver
            `.proy-kpis` en globals.css, donde a dos columnas los montos de 6
            cifras no entran y se cortan). */}
        <div className="proy-kpis" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, flex: 1 }}>

          {/* Capital proyectado */}
          <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: '14px 18px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
            <p style={{ margin: '0 0 4px', fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--muted)' }}>
              Capital proyectado
            </p>
            <p style={{ margin: 0, fontSize: 22, fontWeight: 700, color: 'var(--text)', letterSpacing: '-0.03em', fontVariantNumeric: 'tabular-nums' }}>
              {formatMoney(finalProyectado, { currency: 'USD', hidden: hideValues })}
            </p>
            <p style={{ margin: '4px 0 0', fontSize: 11, color: 'var(--muted)' }}>
              en {horizonte >= 12 ? `${formatNumber(horizonte / 12, { decimals: 1 })} años` : `${horizonte} meses`}
            </p>
          </div>

          {/* Ganancia total */}
          <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: '14px 18px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
            <p style={{ margin: '0 0 4px', fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--muted)' }}>
              Ganancia total
            </p>
            <p style={{ margin: 0, fontSize: 22, fontWeight: 700, color: interesGenerado >= 0 ? 'var(--up)' : 'var(--down)', letterSpacing: '-0.03em', fontVariantNumeric: 'tabular-nums' }}>
              {formatMoney(interesGenerado, { currency: 'USD', sign: true, hidden: hideValues })}
            </p>
            <p style={{ margin: '4px 0 0', fontSize: 11, color: 'var(--muted)' }}>
              {hideValues
                ? '••••'
                : `cartera hoy ${formatMoney(totalActual, { currency: 'USD' })} + aportes ${formatMoney(aportesTotales, { currency: 'USD' })} + interés ${formatMoney(interesGenerado, { currency: 'USD' })}`}
            </p>
          </div>

          {/* Objetivo */}
          <div style={{
            background: 'var(--card)',
            border: `1px solid ${labelMesObj ? 'var(--primary)' : 'var(--border)'}`,
            borderRadius: 12, padding: '14px 18px',
            display: 'flex', flexDirection: 'column', justifyContent: 'center',
          }}>
            <p style={{ margin: '0 0 4px', fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--muted)', fontVariantNumeric: 'tabular-nums' }}>
              Objetivo {hideValues ? '' : formatMoney(objetivo, { currency: 'USD' })}
            </p>
            {objetivo <= totalActual ? (
              <p style={{ margin: 0, fontSize: 18, fontWeight: 700, color: 'var(--up)' }}>¡Ya alcanzado!</p>
            ) : labelMesObj ? (
              <>
                <p style={{ margin: 0, fontSize: 20, fontWeight: 700, color: 'var(--primary)', letterSpacing: '-0.03em' }}>
                  {labelMesObj}
                </p>
                <p style={{ margin: '4px 0 0', fontSize: 11, color: 'var(--muted)' }}>
                  en {mesObjetivo! >= 12 ? `${formatNumber(mesObjetivo! / 12, { decimals: 1 })} años` : `${mesObjetivo} meses`}
                </p>
              </>
            ) : (
              <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: 'var(--muted)' }}>Fuera del horizonte</p>
            )}
          </div>

          {/* Hoy */}
          <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: '14px 18px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
            <p style={{ margin: '0 0 4px', fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--muted)' }}>
              Cartera hoy
            </p>
            <p style={{ margin: 0, fontSize: 22, fontWeight: 700, color: 'var(--text)', letterSpacing: '-0.03em', fontVariantNumeric: 'tabular-nums' }}>
              {formatMoney(totalActual, { currency: 'USD', hidden: hideValues })}
            </p>
            <p style={{ margin: '4px 0 0', fontSize: 11, color: 'var(--muted)' }}>
              al {kpis.fechaStr}
            </p>
          </div>
        </div>
      </div>

      {/* ── Gráfico histórico + proyección ────────────────────────────────── */}
      <div style={{
        background: 'var(--card)',
        border: '1px solid var(--border)',
        borderRadius: 12,
        padding: '18px 20px 10px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
          <p style={{ margin: 0, fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--primary)' }}>
            Evolución histórica + Proyección
          </p>
          <div style={{ display: 'flex', gap: 14, fontSize: 11, color: 'var(--muted)' }}>
            <span><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: 'var(--primary)', marginRight: 5 }} />Cartera real</span>
            <span><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: '#6a9bab', marginRight: 5 }} />Proyección</span>
          </div>
        </div>

        <ResponsiveContainer width="100%" height={260}>
          <ComposedChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 10, fill: 'var(--muted)' }}
              tickLine={false}
              axisLine={false}
              interval={cadaNPuntos - 1}
            />
            <YAxis
              tick={{ fontSize: 10, fill: 'var(--muted)' }}
              tickLine={false}
              axisLine={false}
              tickFormatter={v => formatMoney(v, { currency: 'USD', mode: 'compact', compactShort: isMobile, hidden: hideValues })}
              width={isMobile ? 40 : 52}
            />
            <Tooltip content={<CustomTooltip />} />

            {/* Línea histórica */}
            <Line
              type="monotone"
              dataKey="real"
              name="Cartera real"
              stroke="var(--primary)"
              strokeWidth={2}
              dot={false}
              connectNulls={false}
            />

            {/* Área proyectada */}
            <Area
              type="monotone"
              dataKey="proyectado"
              name="Proyección"
              stroke="#6a9bab"
              strokeWidth={2}
              strokeDasharray="5 4"
              fill="#6a9bab18"
              dot={false}
              connectNulls={false}
            />

            {/* Línea del objetivo */}
            {objetivo > 0 && (
              <ReferenceLine
                y={objetivo}
                stroke="var(--primary)"
                strokeDasharray="4 3"
                strokeOpacity={0.5}
                label={{
                  value: hideValues ? 'Objetivo' : `Objetivo ${formatMoney(objetivo, { currency: 'USD' })}`,
                  position: 'insideTopRight',
                  fontSize: 10,
                  fill: 'var(--primary)',
                }}
              />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* ── Objetivos de composición ───────────────────────────────────────── */}
      <ObjetivosComposicion tenencias={tenenciasActuales} />

    </div>
  );
}
