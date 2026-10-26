'use client';

import { useState, useRef, useEffect } from 'react';
import type { DashboardData } from '@/types';
import { formatMoney, formatPercent } from '@/lib/format';
import { RIESGO_LABEL, RENTA_LABEL, GEO_LABEL } from '@/lib/constants';

interface Message {
  from: 'user' | 'bot';
  text: string;
}

interface Props {
  data: DashboardData;
}

// ── Lógica de respuestas ──────────────────────────────────────────────────────

function buildContext(data: DashboardData) {
  const { kpis, resumenSeries, tenenciasPorMes, mesesDisponibles, totalPorMes } = data;

  const mesKey = (() => {
    const sorted = Object.keys(tenenciasPorMes).sort();
    return sorted[sorted.length - 1] ?? '';
  })();
  const tenencias = tenenciasPorMes[mesKey] ?? [];

  // Activo de mayor peso
  const topActivo = [...tenencias].sort((a, b) => b.tenencia_usd - a.tenencia_usd)[0];

  // Distribución por tipo
  const porTipo: Record<string, number> = {};
  for (const t of tenencias) {
    porTipo[t.TIPO] = (porTipo[t.TIPO] ?? 0) + t.tenencia_usd;
  }

  // Distribución por geografía
  const porGeo: Record<string, number> = {};
  for (const t of tenencias) {
    const geo = GEO_LABEL[t.SECTOR_GEO] ?? t.SECTOR_GEO ?? 'Sin dato';
    porGeo[geo] = (porGeo[geo] ?? 0) + t.tenencia_usd;
  }

  // Distribución por renta
  const porRenta: Record<string, number> = {};
  for (const t of tenencias) {
    const renta = RENTA_LABEL[t.RENTA] ?? t.RENTA ?? 'Sin dato';
    porRenta[renta] = (porRenta[renta] ?? 0) + t.tenencia_usd;
  }

  // Mejor y peor mes
  const seriesOrdenada = [...resumenSeries].sort((a, b) => b.rendimiento - a.rendimiento);
  const mejorMes = seriesOrdenada[0];
  const peorMes  = seriesOrdenada[seriesOrdenada.length - 1];

  // Evolución (primer vs último mes)
  const primerMes = resumenSeries[0];
  const ultimoMes = resumenSeries[resumenSeries.length - 1];

  return { kpis, tenencias, topActivo, porTipo, porGeo, porRenta, mejorMes, peorMes, primerMes, ultimoMes, mesesDisponibles, totalPorMes };
}

function getAnswer(question: string, data: DashboardData): string {
  const ctx = buildContext(data);
  const { kpis, tenencias, topActivo, porTipo, porGeo, porRenta, mejorMes, peorMes, primerMes, ultimoMes, mesesDisponibles } = ctx;
  const total = kpis.totalCartera;

  const q = question.toLowerCase();

  // ── Total cartera
  if (q.includes('total') || q.includes('cartera') || q.includes('patrimonio') || q.includes('vale')) {
    return `Tu cartera total es de **${formatMoney(total, { currency: 'USD' })}** al ${kpis.fechaStr}.`;
  }

  // ── Rendimiento / ganancia
  if (q.includes('rendimiento') || q.includes('ganancia') || q.includes('retorno') || q.includes('rentabilidad') || q.includes('resultado')) {
    return `Tu rendimiento neto acumulado es de **${formatMoney(kpis.rendimientoNeto, { currency: 'USD', sign: true })}** (${formatPercent(kpis.rendimientoPct)} sobre aportes).`;
  }

  // ── TIR
  if (q.includes('tir') || q.includes('anual') || q.includes('xirr')) {
    if (kpis.tirAnual == null) return 'La TIR anual no está disponible todavía (se necesitan más datos históricos).';
    return `Tu TIR anual (sobre flujos históricos) es de **${formatPercent(kpis.tirAnual)}**.`;
  }

  // ── Activo top / mayor peso
  if (q.includes('mayor') || q.includes('top') || q.includes('principal') || q.includes('más grande') || q.includes('mas grande') || q.includes('activo')) {
    if (!topActivo) return 'No hay tenencias registradas para el último mes.';
    const pct = total > 0 ? (topActivo.tenencia_usd / total) * 100 : 0;
    return `El activo con mayor peso es **${topActivo.ticker}** con ${formatMoney(topActivo.tenencia_usd, { currency: 'USD' })} (${formatPercent(pct, { sign: false })} de la cartera).`;
  }

  // ── Cuántos activos
  if (q.includes('cuántos') || q.includes('cuantos') || q.includes('cantidad') || q.includes('activos')) {
    return `Tenés **${tenencias.length} activos** en cartera en el último mes disponible.`;
  }

  // ── Distribución por tipo
  if (q.includes('tipo') || q.includes('distribución') || q.includes('distribucion') || q.includes('composición') || q.includes('composicion')) {
    if (Object.keys(porTipo).length === 0) return 'No hay datos de tipo de activo disponibles.';
    const lineas = Object.entries(porTipo)
      .sort((a, b) => b[1] - a[1])
      .map(([tipo, monto]) => `• ${tipo}: ${formatMoney(monto, { currency: 'USD' })} (${formatPercent(total > 0 ? (monto / total) * 100 : 0, { sign: false })})`)
      .join('\n');
    return `Distribución por tipo de activo:\n${lineas}`;
  }

  // ── Geografía
  if (q.includes('geo') || q.includes('geográ') || q.includes('geogra') || q.includes('país') || q.includes('pais') || q.includes('región') || q.includes('region')) {
    if (Object.keys(porGeo).length === 0) return 'No hay datos de geografía disponibles.';
    const lineas = Object.entries(porGeo)
      .sort((a, b) => b[1] - a[1])
      .map(([geo, monto]) => `• ${geo}: ${formatMoney(monto, { currency: 'USD' })} (${formatPercent(total > 0 ? (monto / total) * 100 : 0, { sign: false })})`)
      .join('\n');
    return `Distribución geográfica:\n${lineas}`;
  }

  // ── Renta fija / variable
  if (q.includes('renta fija') || q.includes('renta variable') || q.includes('renta')) {
    if (Object.keys(porRenta).length === 0) return 'No hay datos de tipo de renta disponibles.';
    const lineas = Object.entries(porRenta)
      .sort((a, b) => b[1] - a[1])
      .map(([r, monto]) => `• ${r}: ${formatMoney(monto, { currency: 'USD' })} (${formatPercent(total > 0 ? (monto / total) * 100 : 0, { sign: false })})`)
      .join('\n');
    return `Distribución por tipo de renta:\n${lineas}`;
  }

  // ── Mejor mes
  if (q.includes('mejor') || q.includes('máximo') || q.includes('maximo')) {
    if (!mejorMes) return 'No hay datos históricos suficientes.';
    return `El mejor mes fue **${mejorMes.fecha}** con un rendimiento de ${formatMoney(mejorMes.rendimiento, { currency: 'USD' })}.`;
  }

  // ── Peor mes
  if (q.includes('peor') || q.includes('mínimo') || q.includes('minimo') || q.includes('baj')) {
    if (!peorMes) return 'No hay datos históricos suficientes.';
    return `El peor mes fue **${peorMes.fecha}** con un rendimiento de ${formatMoney(peorMes.rendimiento, { currency: 'USD' })}.`;
  }

  // ── Evolución / crecimiento
  if (q.includes('evolución') || q.includes('evolucion') || q.includes('creció') || q.includes('crecio') || q.includes('crecimiento') || q.includes('histórico') || q.includes('historico')) {
    if (!primerMes || !ultimoMes) return 'No hay datos históricos suficientes.';
    const diff = ultimoMes.total_cartera - primerMes.total_cartera;
    return `Desde **${primerMes.fecha}** hasta **${ultimoMes.fecha}** la cartera pasó de ${formatMoney(primerMes.total_cartera, { currency: 'USD' })} a ${formatMoney(ultimoMes.total_cartera, { currency: 'USD' })} (${formatMoney(diff, { currency: 'USD', sign: true })}).`;
  }

  // ── Meses disponibles / historial
  if (q.includes('meses') || q.includes('historial') || q.includes('período') || q.includes('periodo') || q.includes('desde cuándo') || q.includes('desde cuando')) {
    return `Hay datos de **${mesesDisponibles.length} meses**, desde **${mesesDisponibles[0]}** hasta **${mesesDisponibles[mesesDisponibles.length - 1]}**.`;
  }

  // ── Aportes
  if (q.includes('aporte') || q.includes('inversión') || q.includes('inversion') || q.includes('invertido')) {
    return `Los aportes acumulados son **${formatMoney(kpis.aporteAcumulados, { currency: 'USD' })}**.`;
  }

  // ── Delta mes anterior
  if (q.includes('mes anterior') || q.includes('último mes') || q.includes('ultimo mes') || q.includes('cambio') || q.includes('variación') || q.includes('variacion')) {
    return `Respecto al mes anterior la cartera cambió **${formatMoney(kpis.deltaCartera, { currency: 'USD', sign: true })}**.`;
  }

  return 'No encontré una respuesta para esa pregunta. Probá con una de las preguntas sugeridas o reformulá la consulta.';
}

// ── Preguntas predeterminadas ─────────────────────────────────────────────────

const PREGUNTAS = [
  '¿Cuánto vale mi cartera?',
  '¿Cuál es mi rendimiento?',
  '¿Cuántos activos tengo?',
  '¿Cuál es mi activo principal?',
  '¿Cómo se distribuye por tipo?',
  '¿Cuál es mi TIR anual?',
  '¿Cuál fue el mejor mes?',
  '¿Cuál fue el peor mes?',
  '¿Cuánto aporté en total?',
  '¿Cuál es la distribución geográfica?',
  '¿Cuántos meses de historial hay?',
  '¿Cómo evolucionó la cartera?',
];

// ── Render del texto con bold ─────────────────────────────────────────────────

function RenderText({ text }: { text: string }) {
  const lines = text.split('\n');
  return (
    <>
      {lines.map((line, i) => {
        const parts = line.split(/\*\*(.+?)\*\*/g);
        return (
          <span key={i}>
            {parts.map((p, j) =>
              j % 2 === 1 ? <strong key={j}>{p}</strong> : p
            )}
            {i < lines.length - 1 && <br />}
          </span>
        );
      })}
    </>
  );
}

// ── Componente principal ──────────────────────────────────────────────────────

export default function ChatBot({ data }: Props) {
  const [open, setOpen]       = useState(false);
  const [messages, setMessages] = useState<Message[]>([
    { from: 'bot', text: '¡Hola! Soy tu asistente financiero. Elegí una pregunta o escribí la tuya.' },
  ]);
  const [input, setInput]     = useState('');
  const bottomRef             = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, open]);

  function handleSend(text: string) {
    if (!text.trim()) return;
    const userMsg: Message = { from: 'user', text };
    const botMsg:  Message = { from: 'bot',  text: getAnswer(text, data) };
    setMessages(prev => [...prev, userMsg, botMsg]);
    setInput('');
  }

  return (
    <>
      {/* ── Burbuja flotante ── */}
      <button
        className="chat-fab"
        onClick={() => setOpen(o => !o)}
        title="Asistente financiero"
        aria-label={open ? 'Cerrar asistente' : 'Abrir asistente financiero'}
        aria-expanded={open}
        style={{
          position: 'fixed',
          bottom: 24,
          right: 24,
          width: 52,
          height: 52,
          borderRadius: '50%',
          background: 'var(--primary)',
          border: 'none',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 22,
          boxShadow: '0 4px 16px rgba(0,0,0,0.35)',
          zIndex: 200,
          transition: 'transform 0.15s',
        }}
        onMouseEnter={e => (e.currentTarget.style.transform = 'scale(1.08)')}
        onMouseLeave={e => (e.currentTarget.style.transform = 'scale(1)')}
      >
        {open ? '✕' : '💬'}
      </button>

      {/* ── Panel del chat ── */}
      {open && (
        <div className="chat-panel" style={{
          position: 'fixed',
          bottom: 86,
          right: 24,
          width: 340,
          maxHeight: 520,
          background: 'var(--card)',
          border: '1px solid var(--border)',
          borderRadius: 14,
          boxShadow: '0 8px 32px rgba(0,0,0,0.35)',
          zIndex: 200,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}>

          {/* Header */}
          <div style={{
            padding: '12px 16px',
            borderBottom: '1px solid var(--border)',
            background: 'var(--bg)',
            flexShrink: 0,
          }}>
            <p style={{ margin: 0, fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--primary)' }}>
              Asistente
            </p>
            <p style={{ margin: '2px 0 0', fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>
              Dashboard Bot
            </p>
          </div>

          {/* Mensajes */}
          <div className="scroll-y" style={{
            flex: 1,
            padding: '12px 14px',
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
          }}>
            {messages.map((m, i) => (
              <div key={i} style={{
                display: 'flex',
                justifyContent: m.from === 'user' ? 'flex-end' : 'flex-start',
              }}>
                <div style={{
                  maxWidth: '82%',
                  padding: '8px 12px',
                  borderRadius: m.from === 'user' ? '12px 12px 2px 12px' : '12px 12px 12px 2px',
                  background: m.from === 'user' ? 'var(--primary)' : 'var(--bg)',
                  border: m.from === 'bot' ? '1px solid var(--border)' : 'none',
                  color: m.from === 'user' ? '#fff' : 'var(--text)',
                  fontSize: 12.5,
                  lineHeight: 1.5,
                  whiteSpace: 'pre-wrap',
                }}>
                  <RenderText text={m.text} />
                </div>
              </div>
            ))}
            <div ref={bottomRef} />
          </div>

          {/* Chips de preguntas predeterminadas */}
          <div className="chat-chips scroll-y" style={{
            padding: '8px 12px',
            borderTop: '1px solid var(--border)',
            display: 'flex',
            flexWrap: 'wrap',
            gap: 5,
            background: 'var(--bg)',
            flexShrink: 0,
            maxHeight: 110,
          }}>
            {PREGUNTAS.map((p) => (
              <button
                key={p}
                className="pill-touch"
                onClick={() => handleSend(p)}
                style={{
                  padding: '3px 9px',
                  borderRadius: 20,
                  fontSize: 10.5,
                  fontWeight: 500,
                  cursor: 'pointer',
                  border: '1px solid var(--primary)',
                  background: 'var(--primary-dim)',
                  color: 'var(--primary)',
                  whiteSpace: 'nowrap',
                  transition: 'opacity 0.1s',
                }}
                onMouseEnter={e => (e.currentTarget.style.opacity = '0.75')}
                onMouseLeave={e => (e.currentTarget.style.opacity = '1')}
              >
                {p}
              </button>
            ))}
          </div>

          {/* Input libre */}
          <form
            onSubmit={e => { e.preventDefault(); handleSend(input); }}
            style={{
              display: 'flex',
              gap: 8,
              padding: '10px 12px',
              borderTop: '1px solid var(--border)',
              background: 'var(--bg)',
              flexShrink: 0,
            }}
          >
            <input
              value={input}
              onChange={e => setInput(e.target.value)}
              placeholder="Escribí tu pregunta..."
              aria-label="Escribí tu pregunta"
              enterKeyHint="send"
              style={{
                flex: 1,
                minWidth: 0,
                padding: '9px 10px',
                borderRadius: 8,
                border: '1px solid var(--border)',
                background: 'var(--card)',
                color: 'var(--text)',
                outline: 'none',
              }}
            />
            <button
              type="submit"
              disabled={!input.trim()}
              className="chat-send"
              aria-label="Enviar"
              style={{
                padding: '7px 12px',
                flexShrink: 0,
                borderRadius: 8,
                border: 'none',
                background: input.trim() ? 'var(--primary)' : 'var(--border)',
                color: input.trim() ? '#fff' : 'var(--muted)',
                fontSize: 13,
                cursor: input.trim() ? 'pointer' : 'default',
                transition: 'background 0.12s',
                fontWeight: 600,
              }}
            >↑</button>
          </form>
        </div>
      )}
    </>
  );
}
