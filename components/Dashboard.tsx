'use client';

import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import type { DashboardData } from '@/types';
import { toMesKey } from '@/lib/parser';
import { formatFx, type Moneda } from '@/lib/format';
import { useFx } from '@/lib/useFx';
import { useEstadoCargas } from '@/lib/useEstadoCargas';
import UploadTenencias from './UploadTenencias';
import { EstadoCargasIconos, EstadoCargasDetalle, describirEstadoCargas } from './EstadoCargasIconos';
import ResumenTab from './ResumenTab';
import TenenciasTab from './TenenciasTab';
import BenchmarksTab from './BenchmarksTab';
import CalendarioTab from './CalendarioTab';
import PerformanceTab from './PerformanceTab';
import FinanzasPersonalesTab from './FinanzasPersonalesTab';
import { IconOjo, IconOjoTachado, IconSol, IconLuna, IconCargar } from './HeaderIcons';
type Tab = 'resumen' | 'tenencias' | 'benchmarks' | 'calendario' | 'performance' | 'finanzas-personales';

const TABS: { id: Tab; label: string }[] = [
  { id: 'resumen',              label: 'Resumen'             },
  { id: 'tenencias',            label: 'Tenencias'           },
  { id: 'benchmarks',           label: 'Benchmarks'          },
  { id: 'calendario',           label: 'Calendario'          },
  { id: 'performance',          label: 'Performance'         },
  { id: 'finanzas-personales',  label: 'Finanzas Personales' },
];

// ── Scroller de pestaña ───────────────────────────────────────────────────────
// Cada pestaña se monta y desmonta con el render condicional, así que su
// scrollTop se perdía al volver. Se guarda por pestaña en memoria (sin
// localStorage: es estado de sesión, no preferencia) y se restaura al montar.
// El contenido del Calendario llega async, así que al montar todavía
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
      style={{ display: 'flex', flexDirection: 'column', gap: 12, flex: 1, minHeight: 0, ...style }}
    >
      {children}
    </section>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
  data: DashboardData;
  /** Fija "Ocultar valores" y saca el botón: la demo pública no muestra montos. */
  valoresSiempreOcultos?: boolean;
}

export default function Dashboard({ data, valoresSiempreOcultos = false }: Props) {
  const { kpis, resumenSeries } = data;

  const [tab, setTab]               = useState<Tab>('resumen');
  const [uploadOpen, setUploadOpen] = useState(false);
  const [theme, setTheme]           = useState<'dark' | 'light'>('dark');
  const [hideValuesElegido, setHideValuesElegido] = useState(false);
  const hideValues = valoresSiempreOcultos || hideValuesElegido;
  const [moneda, setMoneda]         = useState<Moneda>('USD');

  // scrollTop por pestaña (en memoria) — ver TabScroll
  const scrollPorTab = useRef<Partial<Record<Tab, number>>>({});

  // Nav de pestañas: en pantallas angostas el contenido excede el ancho visible,
  // así que la pestaña activa puede quedar fuera de vista. Se la centra cada vez
  // que cambia, incluso cuando el cambio viene por código y no por click.
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
    // última pestaña queda 2px cortada (visto en Gastos).
    const raf = requestAnimationFrame(() => {
      tabRefs.current[tab]?.scrollIntoView({ inline: 'center', block: 'nearest' });
      actualizarSombras();
    });
    return () => cancelAnimationFrame(raf);
  }, [tab, actualizarSombras]);

  // El overflow del nav depende del ancho disponible, que cambia al rotar o
  // redimensionar — y también cuando aparece el MEP en la barra superior.
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
  const { estado: estadoCargas, recargar: recargarEstadoCargas } = useEstadoCargas();

  // MEP real más reciente conocido — solo lectura, se usa para convertir a ARS
  // el valor "hoy" de la cartera en todos los tabs (Resumen, Tenencias, Finanzas Personales).
  const mepActual = useMemo(() => {
    const keys = Array.from(mepPorMes.keys()).sort();
    return keys.length > 0 ? mepPorMes.get(keys[keys.length - 1])! : null;
  }, [mepPorMes]);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme === 'light' ? 'light' : '');
  }, [theme]);

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
      // fondo del scroller fuera de pantalla.
      minHeight: 0,
    }}>

      {/* ── Barra superior: marca, pestañas y controles (ver .app-bar en globals.css) ── */}
      <header className="app-bar">
        <div className="app-bar-marca">
          {/* El ícono de la webapp (app/icon.svg), servido por Next: una sola fuente. */}
          <img className="app-bar-logo" src="/icon.svg" alt="" width={36} height={36} />
          <div style={{ minWidth: 0 }}>
            <h1 className="app-bar-titulo">Portfolio</h1>
            {moneda === 'ARS' && mepActual != null && (
              <p className="app-bar-mep-movil" title="Dólar MEP usado para convertir a pesos">
                MEP <span>{formatFx(mepActual)}</span>
              </p>
            )}
          </div>
        </div>

        {/* Wrapper: los degradés de borde se posicionan sobre el nav y solo
            aparecen del lado donde queda contenido fuera de vista. */}
        <div className="nav-tabs-wrap">
          <nav
            ref={navRef}
            onScroll={actualizarSombras}
            className="nav-tabs scroll-x"
          >
            {TABS.map((t) => (
              <button
                key={t.id}
                ref={(el) => { tabRefs.current[t.id] = el; }}
                onClick={() => setTab(t.id)}
                className="nav-tab"
                aria-current={tab === t.id ? 'page' : undefined}
              >
                {t.label}
              </button>
            ))}
          </nav>
          {navSombra.izq && <span className="nav-fade nav-fade-izq" aria-hidden="true" />}
          {navSombra.der && <span className="nav-fade nav-fade-der" aria-hidden="true" />}
        </div>

        <div className="app-bar-acciones">
          <div className="app-bar-datos">
            <p>Al <span>{kpis.fechaStr}</span></p>
            {moneda === 'ARS' && mepActual != null && (
              <p title="Dólar MEP usado para convertir a pesos">
                MEP <span>{formatFx(mepActual)}</span>
              </p>
            )}
          </div>
          <button
            className="app-bar-btn app-bar-moneda"
            onClick={toggleMoneda}
            title={moneda === 'USD' ? 'Ver en pesos (ARS)' : 'Ver en dólares (USD)'}
            aria-label={moneda === 'USD' ? 'Ver en pesos (ARS)' : 'Ver en dólares (USD)'}
          >
            {moneda}
          </button>
          {!valoresSiempreOcultos && (
            <button
              className="app-bar-btn"
              onClick={() => setHideValuesElegido(v => !v)}
              title={hideValues ? 'Mostrar valores' : 'Ocultar valores'}
              aria-label={hideValues ? 'Mostrar valores' : 'Ocultar valores'}
            >
              {hideValues ? <IconOjoTachado /> : <IconOjo />}
            </button>
          )}
          <button
            className="app-bar-btn"
            onClick={() => setTheme(t => t === 'dark' ? 'light' : 'dark')}
            title={theme === 'dark' ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro'}
            aria-label={theme === 'dark' ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro'}
          >
            {theme === 'dark' ? <IconSol /> : <IconLuna />}
          </button>
          <button
            className="app-bar-btn app-bar-cargar"
            onClick={() => setUploadOpen(true)}
            title="Cargar datos"
            aria-label={`Cargar datos. ${describirEstadoCargas(estadoCargas)}`}
          >
            <EstadoCargasIconos estado={estadoCargas} />
            <IconCargar />
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
            <EstadoCargasDetalle estado={estadoCargas} />
            {/* Panel body — scrolleable */}
            <div className="scroll-y upload-panel-body" style={{ flex: 1, padding: '20px 24px' }}>
              <UploadTenencias onCargado={recargarEstadoCargas} />
            </div>
          </div>
        </>
      )}

      {/* ── Tab: Resumen ────────────────────────────────────────────────────── */}
      {tab === 'resumen' && (
        <TabScroll tab={tab} posiciones={scrollPorTab}>
          <ResumenTab data={data} hideValues={hideValues} moneda={moneda} />
        </TabScroll>
      )}

      {/* ── Tab: Tenencias ──────────────────────────────────────────────────── */}
      {tab === 'tenencias' && (
        <TabScroll tab={tab} posiciones={scrollPorTab}>
          <TenenciasTab
            data={data}
            hideValues={hideValues}
            moneda={moneda}
          />
        </TabScroll>
      )}
      {/* ── Tab: Benchmarks ───────────────────────────────────────────────────── */}
      {tab === 'benchmarks' && (
        <TabScroll tab={tab} posiciones={scrollPorTab}>
          <BenchmarksTab data={data} />
        </TabScroll>
      )}

      {/* ── Tab: Calendario (Eventos) ─────────────────────────────────────────── */}
      {tab === 'calendario' && (
        <TabScroll tab={tab} posiciones={scrollPorTab}>
          <CalendarioTab data={data} hideValues={hideValues} />
        </TabScroll>
      )}

      {/* ── Tab: Performance (TIR, duration, paridad de bonos, ratios entre activos) ── */}
      {tab === 'performance' && (
        <TabScroll tab={tab} posiciones={scrollPorTab}>
          <PerformanceTab data={data} hideValues={hideValues} />
        </TabScroll>
      )}

      {/* ── Tab: Finanzas Personales (Ingresos / Gastos / Proyecciones) ── */}
      {tab === 'finanzas-personales' && (
        <TabScroll tab={tab} posiciones={scrollPorTab}>
          <FinanzasPersonalesTab data={data} hideValues={hideValues} moneda={moneda} mepActual={mepActual} />
        </TabScroll>
      )}

    </main>
  );
}
