'use client';

import { useMemo, useState } from 'react';
import type { DashboardData, NoticiaItem } from '@/types';
import { useCalendario } from '@/lib/useCalendario';
import { TIPOS_VALIDOS, TICKERS_INCLUIR, TICKERS_EXCLUIR } from '@/lib/tickersElegibles';
import { decodeHtmlEntities } from '@/lib/parser';

interface Props {
  data: DashboardData;
}

function fmtFechaRelativa(ts: number): string {
  const diffMs = Date.now() - ts;
  const diffH = diffMs / 3_600_000;
  if (diffH < 1) return 'hace unos minutos';
  if (diffH < 24) return `hace ${Math.round(diffH)}h`;
  const diffD = Math.round(diffH / 24);
  if (diffD < 7) return `hace ${diffD}d`;
  return new Date(ts).toLocaleDateString('es-AR', { day: '2-digit', month: 'short' });
}

function Pill({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="pill-touch"
      aria-pressed={active}
      style={{
        padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 600,
        cursor: 'pointer', border: '1px solid',
        borderColor: active ? 'var(--primary)' : 'var(--border)',
        background: active ? 'var(--primary-dim)' : 'transparent',
        color: active ? 'var(--primary)' : 'var(--muted)',
        transition: 'all 0.12s', whiteSpace: 'nowrap', flexShrink: 0,
      }}
    >{label}</button>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="card-scroll scroll-y" style={{
      background: 'var(--card)', border: '1px solid var(--border)',
      borderRadius: 12, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 10,
      flex: 1, minHeight: 0,
    }}>
      {children}
    </div>
  );
}

function ListaNoticias({ noticias, mostrarTicker }: { noticias: NoticiaItem[]; mostrarTicker: boolean }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {noticias.map((n, i) => (
        <a
          key={i}
          href={n.link}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: 'flex', flexDirection: 'column', gap: 3, textDecoration: 'none',
            padding: '10px 0', minHeight: 44, justifyContent: 'center',
            borderBottom: i < noticias.length - 1 ? '1px solid var(--border-subtle)' : 'none',
          }}
        >
          <span style={{ fontSize: 13, color: 'var(--text)', fontWeight: 500, lineHeight: 1.35 }}>{decodeHtmlEntities(n.titulo)}</span>
          <span style={{ fontSize: 10.5, color: 'var(--muted)', display: 'flex', gap: 8, alignItems: 'center' }}>
            {mostrarTicker && n.ticker && (
              <span style={{ fontWeight: 700, color: 'var(--primary)' }}>{n.ticker}</span>
            )}
            {decodeHtmlEntities(n.fuente)} · {fmtFechaRelativa(n.fecha)}
          </span>
        </a>
      ))}
    </div>
  );
}

export default function NoticiasTab({ data }: Props) {
  const { tenenciasPorMes } = data;

  const tickersActivos = useMemo(() => {
    const meses = Object.keys(tenenciasPorMes).sort();
    const ultimoMes = meses[meses.length - 1];
    const items = tenenciasPorMes[ultimoMes] ?? [];
    const set = new Set(
      items
        .filter((t) => {
          const ticker = t.ticker.toUpperCase();
          if (TICKERS_EXCLUIR.has(ticker)) return false;
          if (TICKERS_INCLUIR.has(ticker)) return true;
          return TIPOS_VALIDOS.has(t.TIPO?.toUpperCase()) && t.SECTOR_GEO !== 'ARG';
        })
        .map((t) => t.ticker.toUpperCase()),
    );
    return [...set].sort();
  }, [tenenciasPorMes]);

  const { noticias, loadingNoticias, errorNoticias } = useCalendario(tickersActivos);

  const [filtroTicker, setFiltroTicker] = useState<string | null>(null);

  const tickersDisponibles = useMemo(() => {
    const set = new Set<string>();
    for (const n of noticias) if (n.ticker) set.add(n.ticker);
    return [...set].sort();
  }, [noticias]);

  const noticiasFiltradas = useMemo(
    () => noticias.filter((n) => !filtroTicker || n.ticker === filtroTicker),
    [noticias, filtroTicker],
  );

  const noticiasActivos = useMemo(() => noticiasFiltradas.filter((n) => n.ticker), [noticiasFiltradas]);
  const noticiasMercado = useMemo(() => noticiasFiltradas.filter((n) => !n.ticker), [noticiasFiltradas]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, flex: 1, minHeight: 0 }}>

      {tickersDisponibles.length > 0 && (
        <div className="filtro-tickers" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', flexShrink: 0 }}>
          <Pill label="Todos" active={filtroTicker === null} onClick={() => setFiltroTicker(null)} />
          {tickersDisponibles.map((t) => (
            <Pill key={t} label={t} active={filtroTicker === t} onClick={() => setFiltroTicker((prev) => prev === t ? null : t)} />
          ))}
        </div>
      )}

      <div className="noticias-grid" style={{ display: 'flex', gap: 12, flex: 1, minHeight: 0 }}>
        {/* ── Mis Activos (izquierda) ────────────────────────────────────────── */}
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <p style={{ margin: 0, fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--primary)' }}>
            Mis Activos
          </p>
          <Card>
            {loadingNoticias ? (
              <p style={{ margin: 0, fontSize: 12, color: 'var(--muted)' }}>Cargando noticias…</p>
            ) : noticiasActivos.length === 0 ? (
              <p style={{ margin: 0, fontSize: 12, color: 'var(--muted)' }}>Sin noticias disponibles para tus tickers.</p>
            ) : (
              <ListaNoticias noticias={noticiasActivos} mostrarTicker />
            )}
            {errorNoticias && (
              <p style={{ margin: 0, fontSize: 11, color: '#ef553b' }}>Algunas noticias no pudieron cargarse: {errorNoticias}</p>
            )}
          </Card>
        </div>

        {/* ── Globales (derecha) ────────────────────────────────────────────── */}
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <p style={{ margin: 0, fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--primary)' }}>
            Globales
          </p>
          <Card>
            {loadingNoticias ? (
              <p style={{ margin: 0, fontSize: 12, color: 'var(--muted)' }}>Cargando noticias…</p>
            ) : noticiasMercado.length === 0 ? (
              <p style={{ margin: 0, fontSize: 12, color: 'var(--muted)' }}>Sin noticias disponibles.</p>
            ) : (
              <ListaNoticias noticias={noticiasMercado} mostrarTicker={false} />
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
