'use client';

import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import type { DashboardData } from '@/types';
import { toMesKey } from '@/lib/parser';
import { formatFx, type Moneda } from '@/lib/format';
import { useFx } from '@/lib/useFx';
import { useEstadoCargas } from '@/lib/useEstadoCargas';
import { precargarCalendario } from '@/lib/useCalendario';
import { tickersDeCartera } from '@/lib/tickersElegibles';
import { usePathname } from 'next/navigation';
import UploadTenencias from './UploadTenencias';
import { EstadoCargasIconos, EstadoCargasDetalle, describirEstadoCargas } from './EstadoCargasIconos';
import ResumenTab from './ResumenTab';
import TenenciasTab from './TenenciasTab';
import BenchmarksTab from './BenchmarksTab';
import CalendarioTab from './CalendarioTab';
import PerformanceTab from './PerformanceTab';
import FinanzasPersonalesTab from './FinanzasPersonalesTab';
import {
  IconOjo, IconOjoTachado, IconSol, IconLuna, IconCargar,
  IconSeccionResumen, IconSeccionTenencias, IconSeccionBenchmarks,
  IconSeccionCalendario, IconSeccionPerformance, IconSeccionFinanzas,
} from './HeaderIcons';
type Tab = 'resumen' | 'tenencias' | 'benchmarks' | 'calendario' | 'performance' | 'finanzas-personales';

// `corto`: la etiqueta de la tab bar de mobile y el large title, donde
// "Finanzas personales" no entra. El ícono solo se ve en esa tab bar.
const TABS: { id: Tab; label: string; corto: string; Icono: (p: { size?: number }) => React.ReactNode }[] = [
  { id: 'resumen',             label: 'Resumen',             corto: 'Resumen',     Icono: IconSeccionResumen     },
  { id: 'tenencias',           label: 'Tenencias',           corto: 'Tenencias',   Icono: IconSeccionTenencias   },
  { id: 'benchmarks',          label: 'Benchmarks',          corto: 'Comparar',    Icono: IconSeccionBenchmarks  },
  { id: 'calendario',          label: 'Calendario',          corto: 'Calendario',  Icono: IconSeccionCalendario  },
  { id: 'performance',         label: 'Performance',         corto: 'Análisis',    Icono: IconSeccionPerformance },
  { id: 'finanzas-personales', label: 'Finanzas personales', corto: 'Finanzas',    Icono: IconSeccionFinanzas    },
];

// ── Tema ──────────────────────────────────────────────────────────────────────
// Por defecto sigue al del sistema (CSS: prefers-color-scheme). El botón fija
// uno a mano y lo recuerda; el script de app/layout.tsx lo aplica antes del
// primer pintado. Para el ícono del botón hace falta saber el tema efectivo,
// que sin elección explícita sale del media query.
const TEMA_KEY = 'tema_v1';
type Tema = 'dark' | 'light';

function temaEfectivo(): Tema {
  const elegido = document.documentElement.getAttribute('data-theme');
  if (elegido === 'light' || elegido === 'dark') return elegido;
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

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
  const [theme, setTheme]           = useState<Tema>('dark');
  const [hideValuesElegido, setHideValuesElegido] = useState(false);
  const hideValues = valoresSiempreOcultos || hideValuesElegido;
  const [moneda, setMoneda]         = useState<Moneda>('USD');

  // El calendario es la pestaña más lenta (cruza Yahoo, Nasdaq, bonistas y el
  // Sheet): se precarga en segundo plano un rato después de abrir el dashboard,
  // con los mismos parámetros que usa CalendarioTab, para que abra ya listo.
  const pathname = usePathname();
  useEffect(() => {
    const t = setTimeout(() => {
      const meses = Object.keys(data.tenenciasPorMes).sort();
      const { tickersUsa, tickersArg, tenencias } = tickersDeCartera(data.tenenciasPorMes[meses[meses.length - 1]] ?? []);
      precargarCalendario(pathname, tickersUsa, tickersArg, tenencias);
    }, 1500);
    return () => clearTimeout(t);
  }, [data, pathname]);

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

  // Tema efectivo al montar, y seguirlo si cambia el del sistema mientras no
  // haya uno elegido a mano.
  useEffect(() => {
    setTheme(temaEfectivo());
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    const alCambiar = () => setTheme(temaEfectivo());
    mq.addEventListener('change', alCambiar);
    return () => mq.removeEventListener('change', alCambiar);
  }, []);

  function alternarTema() {
    const next: Tema = theme === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    try { localStorage.setItem(TEMA_KEY, next); } catch {}
    setTheme(next);
  }

  // Sheet de carga: Esc cierra, y el foco vuelve al botón que lo abrió.
  const botonCargarRef = useRef<HTMLButtonElement | null>(null);
  const cerrarCarga = useCallback(() => {
    setUploadOpen(false);
    botonCargarRef.current?.focus();
  }, []);
  useEffect(() => {
    if (!uploadOpen) return;
    const alTeclear = (e: KeyboardEvent) => { if (e.key === 'Escape') cerrarCarga(); };
    window.addEventListener('keydown', alTeclear);
    return () => window.removeEventListener('keydown', alTeclear);
  }, [uploadOpen, cerrarCarga]);

  const tabActual = TABS.find((t) => t.id === tab)!;

  return (
    <main style={{
      maxWidth: 1280,
      margin: '0 auto',
      padding: '16px 24px 20px',
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
          {/* eslint-disable-next-line @next/next/no-img-element -- SVG estático: next/image no lo optimiza */}
          <img className="app-bar-logo" src="/icon.svg" alt="" width={30} height={30} />
          <div style={{ minWidth: 0 }}>
            <h1 className="app-bar-titulo">
              <span className="titulo-marca">Portfolio</span>
              <span className="titulo-seccion">{tabActual.corto}</span>
            </h1>
            {moneda === 'ARS' && mepActual != null && (
              <p className="app-bar-mep-movil" title="Dólar MEP usado para convertir a pesos">
                MEP <span>{formatFx(mepActual)}</span>
              </p>
            )}
          </div>
        </div>

        {/* Wrapper: los degradés de borde se posicionan sobre el nav y solo
            aparecen del lado donde queda contenido fuera de vista. En mobile
            es la tab bar fija de abajo (ver globals.css). */}
        <div className="nav-tabs-wrap">
          <nav
            ref={navRef}
            onScroll={actualizarSombras}
            className="nav-tabs scroll-x"
            aria-label="Secciones"
          >
            {TABS.map((t) => (
              <button
                key={t.id}
                ref={(el) => { tabRefs.current[t.id] = el; }}
                onClick={() => setTab(t.id)}
                className="nav-tab"
                aria-current={tab === t.id ? 'page' : undefined}
                data-tab={t.id}
                aria-label={t.label}
              >
                <span className="nav-tab-icono" aria-hidden="true"><t.Icono /></span>
                <span className="nav-tab-largo">{t.label}</span>
                <span className="nav-tab-corto" aria-hidden="true">{t.corto}</span>
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
            onClick={alternarTema}
            title={theme === 'dark' ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro'}
            aria-label={theme === 'dark' ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro'}
          >
            {theme === 'dark' ? <IconSol /> : <IconLuna />}
          </button>
          <button
            ref={botonCargarRef}
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

      {/* ── Sheet: cargar datos ─────────────────────────────────────────────────
          Panel lateral en desktop, sheet desde abajo en mobile (ver
          .upload-panel en globals.css). */}
      {uploadOpen && (
        <>
          <div className="sheet-velo" onClick={cerrarCarga} />
          <div className="upload-panel" role="dialog" aria-modal="true" aria-labelledby="upload-titulo">
            <span className="sheet-grabber" aria-hidden="true" />
            <div className="upload-panel-header">
              <h2 id="upload-titulo" className="sheet-titulo">Cargar datos</h2>
              {/* Foco inicial acá: Esc o Enter cierran sin buscar el botón. */}
              <button className="sheet-listo" onClick={cerrarCarga} autoFocus>
                Listo
              </button>
            </div>
            <EstadoCargasDetalle estado={estadoCargas} />
            {/* Cuerpo scrolleable */}
            <div className="scroll-y upload-panel-body">
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
