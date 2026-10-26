'use client';

import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import type { DashboardData, TenenciaActual } from '@/types';
import { toMesKey } from '@/lib/parser';
import { formatMoney, formatPercent, formatFx, type Moneda } from '@/lib/format';
import { useFx } from '@/lib/useFx';
import { RIESGO_LABEL, RENTA_LABEL, GEO_LABEL, MONEDA_LABEL } from '@/lib/constants';
import KPICard from './KPICard';
import EvolucionChart from './EvolucionChart';
import TreemapChart from './TreemapChart';
import EvolucionTipoChart from './EvolucionTipoChart';
import MonthSlider from './MonthSlider';
import UploadTenencias from './UploadTenencias';
import InformeTab from './InformeTab';
import ChatBot from './ChatBot';
import ProyeccionesTab from './ProyeccionesTab';
import BenchmarksTab from './BenchmarksTab';
import NoticiasTab from './NoticiasTab';
import CalendarioTab from './CalendarioTab';
import PerformanceTab from './PerformanceTab';
import IngresosSection from './IngresosSection';
import GastosFijosSection from './GastosFijosSection';
import { FlagUS, FlagAR } from './FlagIcons';
type Tab = 'resumen' | 'tenencias' | 'informe' | 'proyecciones' | 'benchmarks' | 'noticias' | 'calendario' | 'performance' | 'ingresos' | 'gastos-fijos';

const DIMS_TENENCIAS = [
  { key: 'TIPO',       label: 'Tipo de Activo'    },
  { key: 'RIESGO',     label: 'Nivel de Riesgo'   },
  { key: 'MONEDA',     label: 'Tipo de Moneda'    },
  { key: 'RENTA',      label: 'Tipo de Renta'     },
  { key: 'SECTOR_GEO', label: 'Sector Geográfico' },
] as const;
type DimTenencias = typeof DIMS_TENENCIAS[number]['key'];

const TABS: { id: Tab; label: string }[] = [
  { id: 'resumen',      label: 'Resumen'      },
  { id: 'tenencias',    label: 'Tenencias'    },
  { id: 'informe',      label: 'Informe'      },
  { id: 'proyecciones', label: 'Proyecciones' },
  { id: 'benchmarks',   label: 'Benchmarks'  },
  { id: 'noticias',     label: 'Noticias'    },
  { id: 'calendario',   label: 'Calendario'  },
  { id: 'performance',  label: 'Performance' },
  { id: 'ingresos',     label: 'Ingresos'    },
  { id: 'gastos-fijos', label: 'Gastos Fijos' },
];

// ── Filtro activo pill ────────────────────────────────────────────────────────

function FiltroPill({ label, onClear }: { label: string; onClear: () => void }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 6,
      padding: '3px 10px 3px 12px',
      borderRadius: 20,
      background: 'var(--primary-dim)',
      border: '1px solid var(--primary)',
      fontSize: 11, color: 'var(--primary)', fontWeight: 600,
    }}>
      {label}
      <button
        onClick={onClear}
        style={{
          background: 'none', border: 'none', cursor: 'pointer',
          color: 'var(--primary)', fontSize: 13, lineHeight: 1,
          padding: '0 0 0 2px', display: 'flex', alignItems: 'center',
        }}
      >×</button>
    </div>
  );
}

// ── Scroller de pestaña ───────────────────────────────────────────────────────
// Cada pestaña se monta y desmonta con el render condicional, así que su
// scrollTop se perdía al volver. Se guarda por pestaña en memoria (sin
// localStorage: es estado de sesión, no preferencia) y se restaura al montar.
// El contenido de Noticias y Calendario llega async, así que al montar todavía
// no mide: se reintenta por rAF hasta que `scrollHeight` da para el valor
// guardado, con un techo de intentos para no quedar en loop si el contenido
// terminó siendo más corto.
function TabScroll({
  tab, posiciones, style, children,
}: {
  tab: Tab;
  posiciones: React.RefObject<Partial<Record<Tab, number>>>;
  style?: React.CSSProperties;
  children: React.ReactNode;
}) {
  const restaurar = useCallback((el: HTMLElement | null) => {
    if (!el) return;
    const destino = posiciones.current?.[tab] ?? 0;
    if (destino === 0) return;

    let intentos = 0;
    const aplicar = () => {
      el.scrollTop = destino;
      // Si el contenido aún no llegó, `scrollTop` queda corto: reintentar.
      if (el.scrollTop < destino && intentos++ < 30) requestAnimationFrame(aplicar);
    };
    aplicar();
  }, [tab, posiciones]);

  return (
    <section
      className="tab-scroll"
      ref={restaurar}
      onScroll={(e) => {
        if (posiciones.current) posiciones.current[tab] = e.currentTarget.scrollTop;
      }}
      style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, ...style }}
    >
      {children}
    </section>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

interface Props { data: DashboardData }

export default function Dashboard({ data }: Props) {
  const { kpis, resumenSeries, tenenciasPorMes, mesesDisponibles, totalPorMes } = data;

  const [tab, setTab]               = useState<Tab>('resumen');
const [uploadOpen, setUploadOpen] = useState(false);
  const [mesSel, setMesSel]         = useState(mesesDisponibles[mesesDisponibles.length - 1] ?? '');
  const [theme, setTheme]           = useState<'dark' | 'light'>('dark');
  const [hideValues, setHideValues] = useState(false);
  const [dimTenencias, setDimTenencias] = useState<DimTenencias>('TIPO');
  const [moneda, setMoneda]         = useState<Moneda>('USD');

  // scrollTop por pestaña (en memoria) — ver TabScroll
  const scrollPorTab = useRef<Partial<Record<Tab, number>>>({});

  // Nav de pestañas: el contenido (961px) excede el ancho visible, así que la
  // pestaña activa puede quedar fuera de vista. Se la centra cada vez que
  // cambia, incluso cuando el cambio viene por código y no por click.
  const navRef  = useRef<HTMLElement | null>(null);
  const tabRefs = useRef<Partial<Record<Tab, HTMLButtonElement | null>>>({});
  const [navSombra, setNavSombra] = useState({ izq: false, der: false });

  const actualizarSombras = useCallback(() => {
    const el = navRef.current;
    if (!el) return;
    setNavSombra({
      izq: el.scrollLeft > 1,
      der: el.scrollLeft + el.clientWidth < el.scrollWidth - 1,
    });
  }, []);

  useEffect(() => {
    // En dos pasos a propósito: la pestaña activa pasa a font-weight 700, así
    // que su ancho —y el scrollWidth del nav— cambian recién después de que el
    // navegador repinta. Centrar en el mismo tick usa la medida vieja y la
    // última pestaña queda 2px cortada (visto en Gastos Fijos).
    const raf = requestAnimationFrame(() => {
      tabRefs.current[tab]?.scrollIntoView({ inline: 'center', block: 'nearest' });
      actualizarSombras();
    });
    return () => cancelAnimationFrame(raf);
  }, [tab, actualizarSombras]);

  // El overflow del nav depende del ancho disponible, que cambia al rotar o
  // redimensionar — y también cuando aparecen los pills de filtros activos.
  useEffect(() => {
    const el = navRef.current;
    if (!el) return;
    const ro = new ResizeObserver(actualizarSombras);
    ro.observe(el);
    return () => ro.disconnect();
  }, [actualizarSombras]);

  useEffect(() => {
    try {
      const saved = localStorage.getItem('moneda_v1');
      if (saved === 'USD' || saved === 'ARS') setMoneda(saved);
    } catch {}
  }, []);

  function toggleMoneda() {
    setMoneda((prev) => {
      const next = prev === 'USD' ? 'ARS' : 'USD';
      try { localStorage.setItem('moneda_v1', next); } catch {}
      return next;
    });
  }

  const primerMesKey = resumenSeries.length > 0 ? toMesKey(resumenSeries[0].fechaTs) : null;
  const { mepPorMes } = useFx(primerMesKey);

  // MEP real más reciente conocido — solo lectura, se usa para convertir a ARS
  // el valor "hoy" de la cartera en todos los tabs (Resumen, Tenencias, Informe, Ingresos).
  const mepActual = useMemo(() => {
    const keys = Array.from(mepPorMes.keys()).sort();
    return keys.length > 0 ? mepPorMes.get(keys[keys.length - 1])! : null;
  }, [mepPorMes]);

  // KPIs derivados de movimientos, en ARS. aportes_ars ya viene calculado por
  // movimiento con el MEP del día exacto de cada uno (no un MEP de cierre de mes
  // aplicado al total) — ver lib/sheets.ts. El total de cartera usa
  // kpis.totalCarteraArs, ya calculado en origen con el MEP real de cierre.
  const kpisArs = useMemo(() => {
    if (moneda === 'USD') return null;
    const acumuladoArs = resumenSeries.reduce((sum, r) => sum + r.aportes_ars, 0);
    const rendimientoNetoArs = kpis.totalCarteraArs - acumuladoArs;
    const rendimientoPctArs = acumuladoArs > 0 ? (rendimientoNetoArs / acumuladoArs) * 100 : 0;
    const penultimo = resumenSeries[resumenSeries.length - 2];
    const deltaCarteraArs = penultimo != null ? kpis.totalCarteraArs - penultimo.total_cartera_ars : 0;
    return { rendimientoNetoArs, rendimientoPctArs, deltaCarteraArs };
  }, [moneda, resumenSeries, kpis.totalCarteraArs]);

  // Filtros cross-chart
  const [filtroTipo,   setFiltroTipo]   = useState<string | null>(null);
  const [filtroRiesgo, setFiltroRiesgo] = useState<string | null>(null);
  const [filtroMoneda, setFiltroMoneda] = useState<string | null>(null);
  const [filtroRenta,  setFiltroRenta]  = useState<string | null>(null);
  const [filtroGeo,    setFiltroGeo]    = useState<string | null>(null);

  const hayFiltro = filtroTipo || filtroRiesgo || filtroMoneda || filtroRenta || filtroGeo;

  function clearFiltros() {
    setFiltroTipo(null); setFiltroRiesgo(null); setFiltroMoneda(null);
    setFiltroRenta(null); setFiltroGeo(null);
  }

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme === 'light' ? 'light' : '');
  }, [theme]);

  const mesKey = (() => {
    const idx = mesesDisponibles.indexOf(mesSel);
    const sorted = Object.keys(tenenciasPorMes).sort();
    return sorted[idx] ?? sorted[sorted.length - 1] ?? '';
  })();

  const tenenciasMesRaw: TenenciaActual[] = tenenciasPorMes[mesKey] ?? [];
  const totalMes = totalPorMes[mesKey] ?? kpis.totalCartera;

  const tenenciasMes = useMemo(() => {
    let items = tenenciasMesRaw;
    if (filtroTipo)   items = items.filter(t => t.TIPO === filtroTipo);
    if (filtroRiesgo) items = items.filter(t => (RIESGO_LABEL[t.RIESGO] ?? 'Sin dato') === filtroRiesgo);
    if (filtroMoneda) items = items.filter(t => (MONEDA_LABEL[t.MONEDA] ?? t.MONEDA) === filtroMoneda);
    if (filtroRenta)  items = items.filter(t => (RENTA_LABEL[t.RENTA] ?? t.RENTA) === filtroRenta);
    if (filtroGeo)    items = items.filter(t => (GEO_LABEL[t.SECTOR_GEO] ?? t.SECTOR_GEO) === filtroGeo);
    return items;
  }, [tenenciasMesRaw, filtroTipo, filtroRiesgo, filtroMoneda, filtroRenta, filtroGeo]);

  const deltaColor = kpis.deltaCartera >= 0 ? 'var(--up)' : 'var(--down)';
  const rendColor  = kpis.rendimientoNeto >= 0 ? 'var(--up)' : 'var(--down)';
  const tirColor   = kpis.tirAnual == null ? 'var(--muted)' : kpis.tirAnual >= 0 ? 'var(--up)' : 'var(--down)';

  return (
    <main style={{
      maxWidth: 1280,
      margin: '0 auto',
      padding: '14px 24px 20px',
      display: 'flex',
      flexDirection: 'column',
      gap: 0,
      // El alto real lo fija `body > main { flex:1 }` en globals.css: con
      // `100vh` fijo, cualquier hermano previo (el banner de /demo) empujaba el
      // fondo del scroller fuera de pantalla y el FAB tapaba el final.
      minHeight: 0,
    }}>

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <header className="mobile-header" style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: 12,
        paddingBottom: 16,
        borderBottom: '1px solid var(--border)',
        marginBottom: 0,
      }}>
        <div className="mobile-header-title-block">
          <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--primary)', marginBottom: 4 }}>
            Portfolio · Finanzas Personales
          </p>
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 600, color: 'var(--text)', letterSpacing: '-0.01em', lineHeight: 1, margin: 0 }}>
            Investment Dashboard
          </h1>
        </div>

        <div className="mobile-header-actions" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <p className="mobile-fecha" style={{ fontSize: 12, color: 'var(--muted)', margin: 0 }}>
            Al{' '}
            <span style={{ color: 'var(--text-sec)', fontWeight: 500 }}>{kpis.fechaStr}</span>
          </p>
          {moneda === 'ARS' && mepActual != null && (
            <p title="Dólar MEP usado para convertir a pesos" style={{ fontSize: 12, color: 'var(--muted)', margin: 0, whiteSpace: 'nowrap' }}>
              MEP <span style={{ color: 'var(--text-sec)', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{formatFx(mepActual)}</span>
            </p>
          )}
          <button
            className="theme-toggle"
            onClick={toggleMoneda}
            title={moneda === 'USD' ? 'Ver en pesos (ARS)' : 'Ver en dólares (USD)'}
          >
            {moneda === 'USD' ? <FlagUS /> : <FlagAR />}
            <span className="btn-label">{moneda}</span>
          </button>
          <button
            className="theme-toggle"
            onClick={() => setHideValues(v => !v)}
            title={hideValues ? 'Mostrar valores' : 'Ocultar valores'}
          >
            {hideValues ? (
              <><span style={{ fontSize: 14 }}>👁</span><span className="btn-label">Mostrar</span></>
            ) : (
              <><span style={{ fontSize: 14 }}>🙈</span><span className="btn-label">Ocultar</span></>
            )}
          </button>
          <button
            className="theme-toggle"
            onClick={() => setTheme(t => t === 'dark' ? 'light' : 'dark')}
            title="Cambiar tema"
          >
            {theme === 'dark' ? (
              <><span style={{ fontSize: 14 }}>☀</span><span className="btn-label">Claro</span></>
            ) : (
              <><span style={{ fontSize: 14 }}>☾</span><span className="btn-label">Oscuro</span></>
            )}
          </button>
          <button
            className="theme-toggle"
            onClick={() => setUploadOpen(true)}
            title="Cargar datos"
          >
            <><span style={{ fontSize: 14 }}>⬆</span><span className="btn-label">Cargar</span></>
          </button>
        </div>
      </header>

      {/* ── Modal: Cargar Datos ──────────────────────────────────────────────── */}
      {uploadOpen && (
        <>
          {/* Backdrop */}
          <div
            onClick={() => setUploadOpen(false)}
            style={{
              position: 'fixed', inset: 0,
              background: 'rgba(0,0,0,0.5)',
              zIndex: 100,
            }}
          />
          {/* Panel — drawer lateral en desktop, bottom sheet en mobile (ver globals.css) */}
          <div className="upload-panel" style={{
            position: 'fixed', top: 0, right: 0, bottom: 0,
            width: 520, maxWidth: '95vw',
            background: 'var(--bg)',
            borderLeft: '1px solid var(--border)',
            zIndex: 101,
            display: 'flex', flexDirection: 'column',
            boxShadow: '-8px 0 32px rgba(0,0,0,0.3)',
          }}>
            {/* Panel header */}
            <div className="upload-panel-header" style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '18px 24px',
              borderBottom: '1px solid var(--border)',
              flexShrink: 0,
            }}>
              <div>
                <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--primary)', margin: 0 }}>
                  Actualizar datos
                </p>
                <p style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)', margin: '2px 0 0' }}>
                  Cargar Datos
                </p>
              </div>
              <button
                onClick={() => setUploadOpen(false)}
                aria-label="Cerrar"
                style={{
                  background: 'none', border: '1px solid var(--border)',
                  borderRadius: 8, cursor: 'pointer',
                  color: 'var(--muted)', fontSize: 18, lineHeight: 1,
                  width: 40, height: 40, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  flexShrink: 0,
                }}
              >×</button>
            </div>
            {/* Panel body — scrolleable */}
            <div className="scroll-y upload-panel-body" style={{ flex: 1, padding: '20px 24px' }}>
              <UploadTenencias />
            </div>
          </div>
        </>
      )}

      {/* ── Nav tabs ────────────────────────────────────────────────────────── */}
      <div className="mobile-tabs" style={{
        display: 'flex',
        alignItems: 'flex-end',
        gap: 16,
        padding: '8px 0 0',
        borderBottom: '1px solid var(--border)',
        marginBottom: 14,
        flexWrap: 'wrap',
      }}>
        {/* Wrapper: los degradés de borde se posicionan sobre el nav y solo
            aparecen del lado donde queda contenido fuera de vista. Usan --bg,
            así que acompañan al tema claro y oscuro sin color propio. */}
        <div className="nav-tabs-wrap" style={{ position: 'relative', flex: 1, minWidth: 0 }}>
          <nav
            ref={navRef}
            onScroll={actualizarSombras}
            className="nav-tabs scroll-x"
            style={{ display: 'flex', gap: 4 }}
          >
          {TABS.map((t) => (
            <button
              key={t.id}
              ref={(el) => { tabRefs.current[t.id] = el; }}
              onClick={() => setTab(t.id)}
              style={{
                padding: '7px 18px',
                borderRadius: '8px 8px 0 0',
                fontSize: 13,
                fontWeight: tab === t.id ? 700 : 500,
                cursor: 'pointer',
                border: '1px solid',
                borderBottom: tab === t.id ? '1px solid var(--card)' : '1px solid transparent',
                borderColor: tab === t.id ? 'var(--border)' : 'transparent',
                background: tab === t.id ? 'var(--card)' : 'transparent',
                color: tab === t.id ? 'var(--primary)' : 'var(--muted)',
                marginBottom: tab === t.id ? -1 : 0,
                transition: 'all 0.12s',
              }}
            >
              {t.label}
            </button>
          ))}
          </nav>
          {navSombra.izq && <span className="nav-fade nav-fade-izq" aria-hidden="true" />}
          {navSombra.der && <span className="nav-fade nav-fade-der" aria-hidden="true" />}
        </div>

        {/* Filtros activos — visibles en todas las pestañas */}
        {hayFiltro && (
          <div className="mobile-filtros" style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', paddingBottom: 4 }}>
            <div className="filtros-sep" style={{ width: 1, height: 20, background: 'var(--border)', flexShrink: 0 }} />
            {filtroTipo   && <FiltroPill label={filtroTipo}   onClear={() => setFiltroTipo(null)} />}
            {filtroRiesgo && <FiltroPill label={filtroRiesgo} onClear={() => setFiltroRiesgo(null)} />}
            {filtroMoneda && <FiltroPill label={filtroMoneda} onClear={() => setFiltroMoneda(null)} />}
            {filtroRenta  && <FiltroPill label={filtroRenta}  onClear={() => setFiltroRenta(null)} />}
            {filtroGeo    && <FiltroPill label={filtroGeo}    onClear={() => setFiltroGeo(null)} />}
            <button
              onClick={clearFiltros}
              style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, color: 'var(--muted)', textDecoration: 'underline' }}
            >Limpiar</button>
          </div>
        )}
      </div>

      {/* ── Tab: Resumen ────────────────────────────────────────────────────── */}
      {tab === 'resumen' && (
        <TabScroll tab={tab} posiciones={scrollPorTab} style={{ gap: 12 }}>
          <div className="kpi-grid">
            <KPICard
              label="Total Cartera"
              value={
                moneda === 'USD'
                  ? formatMoney(kpis.totalCartera, { currency: 'USD', hidden: hideValues })
                  : formatMoney(kpis.totalCarteraArs, { currency: 'ARS', hidden: hideValues })
              }
              sub={
                hideValues ? '••••' :
                moneda === 'USD'
                  ? `${kpis.deltaCartera >= 0 ? '▲' : '▼'} ${formatMoney(Math.abs(kpis.deltaCartera), { currency: 'USD' })} vs mes anterior`
                  : kpisArs
                    ? `${kpisArs.deltaCarteraArs >= 0 ? '▲' : '▼'} ${formatMoney(Math.abs(kpisArs.deltaCarteraArs), { currency: 'ARS' })} vs mes anterior`
                    : 's/d vs mes anterior'
              }
              subColor={deltaColor}
              accentColor="var(--primary)"
            />
            <KPICard
              label="Rendimiento Neto"
              value={
                moneda === 'USD'
                  ? formatMoney(kpis.rendimientoNeto, { currency: 'USD', hidden: hideValues, sign: true })
                  : kpisArs
                    ? formatMoney(kpisArs.rendimientoNetoArs, { currency: 'ARS', hidden: hideValues, sign: true })
                    : formatMoney(null, { currency: 'ARS' })
              }
              sub={
                hideValues ? '••••' :
                moneda === 'USD'
                  ? `${formatPercent(kpis.rendimientoPct)} sobre aportes`
                  : kpisArs ? `${formatPercent(kpisArs.rendimientoPctArs)} sobre aportes` : 'sin dato de MEP'
              }
              subColor={rendColor}
              accentColor={rendColor}
            />
            <KPICard
              label={moneda === 'ARS' ? 'TIR Anual (USD)' : 'TIR Anual'}
              value={kpis.tirAnual != null ? formatPercent(kpis.tirAnual, { sign: false }) : 'N/D'}
              sub="sobre flujos históricos"
              subColor={tirColor}
              accentColor={tirColor}
            />
          </div>

          <div className="resumen-chart-wrap" style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
            <EvolucionChart data={resumenSeries} tenenciasPorMes={tenenciasPorMes} hideValues={hideValues} moneda={moneda} />
          </div>
        </TabScroll>
      )}

      {/* ── Tab: Tenencias ──────────────────────────────────────────────────── */}
      {tab === 'tenencias' && (
        <TabScroll tab={tab} posiciones={scrollPorTab} style={{ gap: 8 }}>

          {/* Barra de controles: selector de mes centrado + dimensión + filtros activos */}
          <div className="tenencias-controles" style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', flexShrink: 0 }}>

            {/* Botón Último a la izquierda */}
            {mesesDisponibles.indexOf(mesSel) < mesesDisponibles.length - 1 && (
              <button
                className="pill-touch"
                onClick={() => setMesSel(mesesDisponibles[mesesDisponibles.length - 1])}
                style={{
                  padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 600,
                  cursor: 'pointer', border: '1px solid var(--primary)',
                  background: 'var(--primary-dim)', color: 'var(--primary)',
                  whiteSpace: 'nowrap', flexShrink: 0,
                }}
              >‹ Último</button>
            )}

            {/* MonthSlider centrado */}
            <div className="tenencias-slider" style={{ flex: 1 }}>
              <MonthSlider
                meses={mesesDisponibles}
                selected={mesSel}
                onSelect={setMesSel}
                totalMes={totalMes}
                activosMes={tenenciasMes.length}
                hideValues={hideValues}
              />
            </div>

            {/* Separador */}
            <div className="tenencias-sep" style={{ width: 1, height: 20, background: 'var(--border)', flexShrink: 0 }} />

            {/* Selector de dimensión unificado — fila deslizable en mobile */}
            <div className="dim-selector scroll-x" style={{ display: 'flex', gap: 3, flexWrap: 'wrap', flexShrink: 0 }}>
              {DIMS_TENENCIAS.map((d) => (
                <button
                  key={d.key}
                  className="pill-touch"
                  onClick={() => setDimTenencias(d.key)}
                  style={{
                    padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 500,
                    cursor: 'pointer', border: '1px solid',
                    borderColor: dimTenencias === d.key ? 'var(--primary)' : 'var(--border)',
                    background: dimTenencias === d.key ? 'var(--primary-dim)' : 'transparent',
                    color: dimTenencias === d.key ? 'var(--primary)' : 'var(--muted)',
                    transition: 'all 0.12s', whiteSpace: 'nowrap', flexShrink: 0,
                  }}
                >{d.label}</button>
              ))}
            </div>

          </div>

          {/* Treemap + Evolución por — mismo tamaño */}
          <div className="tenencias-grid">
            <TreemapChart
              tenencias={tenenciasMes}
              totalCartera={totalMes}
              dim={dimTenencias}
              filtroTipo={filtroTipo}
              onFiltroTipo={(t) => setFiltroTipo(prev => prev === t ? null : t)}
              hideValues={hideValues}
              moneda={moneda}
            />
            <EvolucionTipoChart
              tenenciasPorMes={tenenciasPorMes}
              mesesDisponibles={mesesDisponibles}
              dim={dimTenencias}
              mesSel={mesSel}
              onMesClick={(fecha) => { if (mesesDisponibles.includes(fecha)) setMesSel(fecha); }}
              hideValues={hideValues}
              moneda={moneda}
            />
          </div>
        </TabScroll>
      )}



      {/* ── Tab: Informe ────────────────────────────────────────────────────── */}
      {tab === 'informe' && (
        <TabScroll tab={tab} posiciones={scrollPorTab}>
          <InformeTab
            resumenSeries={resumenSeries}
            tenenciasPorMes={tenenciasPorMes}
            mesesDisponibles={mesesDisponibles}
            totalPorMes={totalPorMes}
            hideValues={hideValues}
            moneda={moneda}
          />
        </TabScroll>
      )}

      {/* ── Tab: Proyecciones ───────────────────────────────────────────────── */}
      {tab === 'proyecciones' && (
        <TabScroll tab={tab} posiciones={scrollPorTab}>
          <ProyeccionesTab data={data} hideValues={hideValues} />
        </TabScroll>
      )}

      {/* ── Tab: Benchmarks ───────────────────────────────────────────────────── */}
      {tab === 'benchmarks' && (
        <TabScroll tab={tab} posiciones={scrollPorTab}>
          <BenchmarksTab data={data} />
        </TabScroll>
      )}

      {/* ── Tab: Noticias ─────────────────────────────────────────────────────── */}
      {tab === 'noticias' && (
        <TabScroll tab={tab} posiciones={scrollPorTab}>
          <NoticiasTab data={data} />
        </TabScroll>
      )}

      {/* ── Tab: Calendario (Eventos) ─────────────────────────────────────────── */}
      {tab === 'calendario' && (
        <TabScroll tab={tab} posiciones={scrollPorTab}>
          <CalendarioTab data={data} />
        </TabScroll>
      )}

      {/* ── Tab: Performance (TIR, duration, paridad de bonos, ratios entre activos) ── */}
      {tab === 'performance' && (
        <TabScroll tab={tab} posiciones={scrollPorTab}>
          <PerformanceTab data={data} />
        </TabScroll>
      )}

      {/* ── Tab: Ingresos (sueldos/haberes por empleador, ARS/USD) ────────────── */}
      {tab === 'ingresos' && (
        <TabScroll tab={tab} posiciones={scrollPorTab}>
          <IngresosSection hideValues={hideValues} moneda={moneda} />
        </TabScroll>
      )}

      {/* ── Tab: Gastos Fijos (suscripciones/seguros recurrentes) ─────────────── */}
      {tab === 'gastos-fijos' && (
        <TabScroll tab={tab} posiciones={scrollPorTab}>
          <GastosFijosSection hideValues={hideValues} moneda={moneda} mepActual={mepActual} />
        </TabScroll>
      )}

      {/* ── Bot flotante ────────────────────────────────────────────────────── */}
      <ChatBot data={data} />

    </main>
  );
}
