'use client';

import { useState, useRef, useCallback } from 'react';
import { formatMoney, formatFx } from '@/lib/format';

// ── Types ─────────────────────────────────────────────────────────────────────

type Step = 'idle' | 'parsing' | 'preview' | 'completing' | 'confirming' | 'done' | 'error';

interface UploaderState {
  step: Step;
  error?: string;
  preview?: Record<string, unknown>;
  confirmed?: Record<string, unknown>;
}

interface NuevoActivo {
  ticker: string;
  broker: string;
  tipo: string;
  riesgo: string;
  sectorGeo: string;
  renta: string;
  moneda: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function MesLabel({ mesKey }: { mesKey: string }) {
  const MESES = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
  const [yyyy, mm] = mesKey.split('-').map(Number);
  return <>{MESES[mm - 1]}-{yyyy}</>;
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
      <span style={{ color: 'var(--muted)' }}>{label}</span>
      <span style={{ color: 'var(--text)', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{value}</span>
    </div>
  );
}

function Spinner() {
  return (
    <>
      <div style={{
        width: 22, height: 22, borderRadius: '50%', flexShrink: 0,
        border: '3px solid var(--border)', borderTop: '3px solid var(--primary)',
        animation: 'spin 0.8s linear infinite',
      }} />
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </>
  );
}

// ── Formulario de activos faltantes ──────────────────────────────────────────

const TIPO_OPTS   = ['ARGY', 'ETF', 'FCI', 'ACCIONES', 'CRIPTO', 'BONOS', 'OTRO'];
const RIESGO_OPTS = [{ v: '1', l: '1 – Conservador' }, { v: '2', l: '2 – Moderado' }, { v: '3', l: '3 – Moderado-Alto' }, { v: '4', l: '4 – Agresivo' }];
const GEO_OPTS    = ['ARG', 'EU', 'EMER', 'GLO', 'DES'];
const RENTA_OPTS  = ['FIJA', 'VAR'];
const MONEDA_OPTS = ['USD', 'ARS', 'CER', 'DL', 'BAD', 'USDC'];

function makeEmptyActivo(ticker: string): NuevoActivo {
  return { ticker, broker: 'COCOS', tipo: '', riesgo: '', sectorGeo: '', renta: '', moneda: '' };
}

function ActivosFaltantesForm({
  tickers,
  onConfirm,
  onCancel,
}: {
  tickers: string[];
  onConfirm: (activos: NuevoActivo[]) => void;
  onCancel: () => void;
}) {
  const [activos, setActivos] = useState<NuevoActivo[]>(tickers.map(makeEmptyActivo));

  const set = (i: number, field: keyof NuevoActivo, value: string) => {
    setActivos((prev) => prev.map((a, idx) => idx === i ? { ...a, [field]: value } : a));
  };

  const allFilled = activos.every((a) => a.tipo && a.riesgo && a.sectorGeo && a.renta && a.moneda);

  const labelStyle: React.CSSProperties = {
    fontSize: 10, fontWeight: 700, color: 'var(--muted)',
    textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 3, display: 'block',
  };
  const selectStyle: React.CSSProperties = {
    width: '100%', padding: '5px 8px', borderRadius: 6,
    border: '1px solid var(--border)', background: 'var(--card)',
    color: 'var(--text)', fontSize: 12, boxSizing: 'border-box',
  };
  const inputStyle: React.CSSProperties = { ...selectStyle };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{
        background: 'rgba(245,197,24,0.08)', border: '1px solid rgba(245,197,24,0.35)',
        borderRadius: 8, padding: '10px 14px',
      }}>
        <p style={{ fontSize: 12, fontWeight: 700, color: '#f5c518', margin: '0 0 3px' }}>
          ⚠ {tickers.length} activo{tickers.length !== 1 ? 's' : ''} nuevo{tickers.length !== 1 ? 's' : ''} detectado{tickers.length !== 1 ? 's' : ''}
        </p>
        <p style={{ fontSize: 12, color: 'var(--muted)', margin: 0 }}>
          Completá los datos para agregarlos a la lista maestra antes de subir las tenencias.
        </p>
      </div>

      {activos.map((a, i) => (
        <div key={a.ticker} style={{
          border: '1px solid var(--border)', borderRadius: 8,
          padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 10,
        }}>
          <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--primary)', margin: 0 }}>{a.ticker}</p>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <label style={labelStyle}>Broker</label>
              <input style={inputStyle} value={a.broker} onChange={(e) => set(i, 'broker', e.target.value)} />
            </div>
            <div>
              <label style={labelStyle}>Tipo</label>
              <select style={selectStyle} value={a.tipo} onChange={(e) => set(i, 'tipo', e.target.value)}>
                <option value="">— elegir —</option>
                {TIPO_OPTS.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Riesgo</label>
              <select style={selectStyle} value={a.riesgo} onChange={(e) => set(i, 'riesgo', e.target.value)}>
                <option value="">— elegir —</option>
                {RIESGO_OPTS.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Sector Geográfico</label>
              <select style={selectStyle} value={a.sectorGeo} onChange={(e) => set(i, 'sectorGeo', e.target.value)}>
                <option value="">— elegir —</option>
                {GEO_OPTS.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Renta</label>
              <select style={selectStyle} value={a.renta} onChange={(e) => set(i, 'renta', e.target.value)}>
                <option value="">— elegir —</option>
                {RENTA_OPTS.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Moneda</label>
              <select style={selectStyle} value={a.moneda} onChange={(e) => set(i, 'moneda', e.target.value)}>
                <option value="">— elegir —</option>
                {MONEDA_OPTS.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>
          </div>
        </div>
      ))}

      <div style={{ display: 'flex', gap: 8 }}>
        <button
          style={{
            padding: '9px 24px', borderRadius: 8, border: 'none',
            background: allFilled ? 'var(--primary)' : 'var(--border)',
            color: allFilled ? '#fff' : 'var(--muted)',
            fontWeight: 700, fontSize: 13,
            cursor: allFilled ? 'pointer' : 'not-allowed',
          }}
          disabled={!allFilled}
          onClick={() => onConfirm(activos)}
        >
          Guardar y continuar
        </button>
        <button
          style={{
            padding: '9px 24px', borderRadius: 8,
            border: '1px solid var(--border)', background: 'transparent',
            color: 'var(--muted)', fontWeight: 500, fontSize: 13, cursor: 'pointer',
          }}
          onClick={onCancel}
        >
          Cancelar
        </button>
      </div>
    </div>
  );
}

// ── Uploader genérico ─────────────────────────────────────────────────────────

interface UploaderConfig {
  title: string;
  subtitle: string;
  hint: string;
  parseEndpoint: string;
  confirmEndpoint: string;
  buildConfirmBody: (preview: Record<string, unknown>) => unknown;
  renderPreview: (preview: Record<string, unknown>) => React.ReactNode;
  renderDone: (confirmed: Record<string, unknown>) => React.ReactNode;
}

function Uploader({
  title, subtitle, hint,
  parseEndpoint, confirmEndpoint,
  buildConfirmBody, renderPreview, renderDone,
}: UploaderConfig) {
  const [state, setState] = useState<UploaderState>({ step: 'idle' });
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(async (file: File) => {
    if (!file.name.endsWith('.pdf')) {
      setState({ step: 'error', error: 'El archivo debe ser un PDF.' });
      return;
    }
    setState({ step: 'parsing' });

    const formData = new FormData();
    formData.append('pdf', file);

    try {
      const res = await fetch(parseEndpoint, { method: 'POST', body: formData });
      const json = await res.json();
      if (!res.ok) {
        setState({ step: 'error', error: json.error ?? 'Error desconocido' });
        return;
      }
      setState({ step: 'preview', preview: json });
    } catch (e: unknown) {
      setState({ step: 'error', error: e instanceof Error ? e.message : String(e) });
    }
  }, [parseEndpoint]);

  const uploadTenencias = useCallback(async (preview: Record<string, unknown>) => {
    setState((s) => ({ ...s, step: 'confirming' }));
    try {
      const body = buildConfirmBody(preview);
      const res = await fetch(confirmEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) {
        setState({ step: 'error', error: json.error ?? 'Error al confirmar' });
        return;
      }
      setState({ step: 'done', confirmed: json });
    } catch (e: unknown) {
      setState({ step: 'error', error: e instanceof Error ? e.message : String(e) });
    }
  }, [confirmEndpoint, buildConfirmBody]);

  const handleActivosConfirm = useCallback(async (activos: NuevoActivo[]) => {
    if (!state.preview) return;
    setState((s) => ({ ...s, step: 'confirming' }));
    try {
      const addRes = await fetch('/api/upload-tenencias?action=add-activos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ activos }),
      });
      if (!addRes.ok) {
        const j = await addRes.json();
        setState({ step: 'error', error: j.error ?? 'Error al guardar activos' });
        return;
      }
    } catch (e: unknown) {
      setState({ step: 'error', error: e instanceof Error ? e.message : String(e) });
      return;
    }
    await uploadTenencias(state.preview);
  }, [state.preview, uploadTenencias]);

  const handleConfirm = useCallback(async () => {
    if (!state.preview) return;
    const faltantes = (state.preview.activosFaltantes as string[] | undefined) ?? [];
    if (faltantes.length > 0) {
      setState((s) => ({ ...s, step: 'completing' }));
      return;
    }
    await uploadTenencias(state.preview);
  }, [state.preview, uploadTenencias]);

  const reset = () => {
    setState({ step: 'idle' });
    if (inputRef.current) inputRef.current.value = '';
  };

  const dropZoneStyle: React.CSSProperties = {
    width: '100%',
    border: `2px dashed ${dragging ? 'var(--primary)' : 'var(--border)'}`,
    borderRadius: 10,
    padding: '22px 20px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 6,
    cursor: 'pointer',
    background: dragging ? 'var(--primary-dim)' : 'transparent',
    transition: 'all 0.15s',
    boxSizing: 'border-box',
  };

  const btnPrimary: React.CSSProperties = {
    padding: '9px 24px', borderRadius: 8, border: 'none',
    background: 'var(--primary)', color: '#fff',
    fontWeight: 700, fontSize: 13, cursor: 'pointer',
  };

  const btnSecondary: React.CSSProperties = {
    ...btnPrimary, background: 'transparent',
    border: '1px solid var(--border)', color: 'var(--muted)', fontWeight: 500,
  };

  return (
    <div style={{
      background: 'var(--card)', border: '1px solid var(--border)',
      borderRadius: 12, padding: '20px 24px',
      display: 'flex', flexDirection: 'column', gap: 14,
    }}>
      {/* Header */}
      <div>
        <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--primary)', marginBottom: 3 }}>
          {title}
        </p>
        <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', margin: 0 }}>
          {subtitle}
        </p>
        <p style={{ fontSize: 11, color: 'var(--muted)', margin: '4px 0 0' }}>{hint}</p>
      </div>

      {/* IDLE: dropzone */}
      {state.step === 'idle' && (
        <div
          style={dropZoneStyle}
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files[0]; if (f) handleFile(f); }}
          onClick={() => inputRef.current?.click()}
        >
          <span style={{ fontSize: 26 }}>📄</span>
          <p style={{ fontSize: 13, color: 'var(--text)', margin: 0, fontWeight: 600 }}>Arrastrá el PDF acá</p>
          <p style={{ fontSize: 11, color: 'var(--muted)', margin: 0 }}>o hacé click para seleccionarlo</p>
          <input ref={inputRef} type="file" accept=".pdf" style={{ display: 'none' }}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
        </div>
      )}

      {/* PARSING: spinner */}
      {state.step === 'parsing' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0' }}>
          <Spinner />
          <p style={{ color: 'var(--muted)', fontSize: 13, margin: 0 }}>Leyendo PDF...</p>
        </div>
      )}

      {/* PREVIEW: muestra lo que encontró, pide confirmación */}
      {state.step === 'preview' && state.preview && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{
            background: 'rgba(99,102,241,0.07)', border: '1px solid rgba(99,102,241,0.25)',
            borderRadius: 8, padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: 10,
          }}>
            <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--primary)', margin: 0, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
              Vista previa — revisá antes de confirmar
            </p>
            {renderPreview(state.preview)}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button style={btnPrimary} onClick={handleConfirm}>Confirmar y subir</button>
            <button style={btnSecondary} onClick={reset}>Cancelar</button>
          </div>
        </div>
      )}

      {/* COMPLETING: formulario de activos faltantes */}
      {state.step === 'completing' && state.preview && (
        <ActivosFaltantesForm
          tickers={(state.preview.activosFaltantes as string[]) ?? []}
          onConfirm={handleActivosConfirm}
          onCancel={reset}
        />
      )}

      {/* CONFIRMING: spinner */}
      {state.step === 'confirming' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0' }}>
          <Spinner />
          <p style={{ color: 'var(--muted)', fontSize: 13, margin: 0 }}>Subiendo a Google Sheets...</p>
        </div>
      )}

      {/* DONE */}
      {state.step === 'done' && state.confirmed && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{
            background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.3)',
            borderRadius: 8, padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: 8,
          }}>
            <p style={{ fontSize: 12, fontWeight: 700, color: '#22c55e', margin: 0 }}>✓ Subido correctamente</p>
            {renderDone(state.confirmed)}
          </div>
          <button style={btnSecondary} onClick={reset}>Cargar otro mes</button>
        </div>
      )}

      {/* ERROR */}
      {state.step === 'error' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{
            background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.3)',
            borderRadius: 8, padding: '14px 18px',
          }}>
            <p style={{ fontSize: 12, fontWeight: 700, color: '#ef4444', margin: '0 0 4px' }}>Error</p>
            <p style={{ fontSize: 13, color: 'var(--text)', margin: 0 }}>{state.error}</p>
          </div>
          <button style={btnPrimary} onClick={reset}>Intentar de nuevo</button>
        </div>
      )}
    </div>
  );
}

// ── Previsualización de Tenencias ─────────────────────────────────────────────

function PreviewTenencias({ p }: { p: Record<string, unknown> }) {
  const rows = p.rows as Array<{ ticker: string; tenenciaARS: number; tenenciaUSD: number }>;
  return (
    <>
      <Row label="Mes detectado"   value={<MesLabel mesKey={p.mes as string} />} />
      <Row label="Fecha de cierre" value={p.fecha as string} />
      <Row label="Dólar MEP"       value={formatFx(p.dolarMep as number, { decimals: 2 })} />
      <Row label="Instrumentos"    value={`${p.filas} posiciones`} />
      <div style={{ borderTop: '1px solid var(--border)', paddingTop: 8, marginTop: 2 }}>
        <p style={{ fontSize: 11, color: 'var(--muted)', margin: '0 0 6px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          Todas las posiciones
        </p>
        {rows.map((r) => (
          <div key={r.ticker} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
            <span style={{ color: 'var(--text)', fontWeight: 600 }}>{r.ticker}</span>
            <span style={{ color: 'var(--muted)', fontVariantNumeric: 'tabular-nums' }}>
              {formatMoney(r.tenenciaUSD, { currency: 'USD', mode: 'price' })}
            </span>
          </div>
        ))}
      </div>
    </>
  );
}

function DoneTenencias({ p }: { p: Record<string, unknown> }) {
  return (
    <>
      <Row label="Mes cargado"         value={<MesLabel mesKey={p.mes as string} />} />
      <Row label="Fecha en sheet"      value={p.fecha as string} />
      <Row label="Dólar MEP usado"     value={formatFx(p.dolarMep as number, { decimals: 2 })} />
      <Row label="Instrumentos subidos" value={`${p.filas} filas`} />
    </>
  );
}

// ── Previsualización de Movimientos ───────────────────────────────────────────

function PreviewMovimientos({ p }: { p: Record<string, unknown> }) {
  const movs = p.movimientos as Array<{ fecha: string; montoUSD: number; tipo: string }>;
  const ingresos = movs.filter(m => m.tipo === 'Ingreso');
  const salidas  = movs.filter(m => m.tipo === 'Salida');
  return (
    <>
      <Row label="Mes detectado"        value={<MesLabel mesKey={p.mes as string} />} />
      <Row label="Total movimientos"    value={`${p.filas} registros`} />
      <Row label="Retiros (→ Ingreso TIR)"    value={`${ingresos.length} operación${ingresos.length !== 1 ? 'es' : ''}`} />
      <Row label="Depósitos (→ Egreso TIR)"   value={`${salidas.length} operación${salidas.length !== 1 ? 'es' : ''}`} />
      {movs.length > 0 && (
        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 8, marginTop: 2 }}>
          <p style={{ fontSize: 11, color: 'var(--muted)', margin: '0 0 6px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            Detalle
          </p>
          {movs.map((m, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 3 }}>
              <span style={{ color: 'var(--muted)' }}>{m.fecha}</span>
              <span style={{ color: m.tipo === 'Ingreso' ? 'var(--up)' : 'var(--down)', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                {formatMoney(m.tipo === 'Ingreso' ? m.montoUSD : -m.montoUSD, { currency: 'USD', mode: 'price', sign: true })}
              </span>
              <span style={{ color: 'var(--muted)', fontSize: 11 }}>{m.tipo}</span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function DoneMovimientos({ p }: { p: Record<string, unknown> }) {
  const movs = p.movimientos as Array<{ fecha: string; montoUSD: number; tipo: string }>;
  const ingresos = movs.filter(m => m.tipo === 'Ingreso');
  const salidas  = movs.filter(m => m.tipo === 'Salida');
  const totalIng = ingresos.reduce((s, m) => s + m.montoUSD, 0);
  const totalSal = salidas.reduce((s, m) => s + m.montoUSD, 0);
  return (
    <>
      <Row label="Mes cargado"              value={<MesLabel mesKey={p.mes as string} />} />
      <Row label="Filas subidas"            value={`${p.filas}`} />
      <Row label="Retiros (ingresos TIR)"   value={`${ingresos.length} × ${formatMoney(totalIng, { currency: 'USD', sign: true })}`} />
      <Row label="Depósitos (egresos TIR)"  value={`${salidas.length} × ${formatMoney(-totalSal, { currency: 'USD', sign: true })}`} />
    </>
  );
}

// ── Previsualización de Haberes ───────────────────────────────────────────────

interface HaberRow { fecha: string; empleador: string; montoArs: number; montoUsd: number }

function fmtHaberMonto(r: { montoArs: number; montoUsd: number }): string {
  const partes: string[] = [];
  if (r.montoArs > 0) partes.push(formatMoney(r.montoArs, { currency: 'ARS', mode: 'price' }));
  if (r.montoUsd > 0) partes.push(formatMoney(r.montoUsd, { currency: 'USD', mode: 'price' }));
  return partes.join(' · ') || 's/d';
}

function PreviewHaberes({ p }: { p: Record<string, unknown> }) {
  const rows = p.rows as HaberRow[];
  const omitidas = (p.omitidas as number) ?? 0;
  return (
    <>
      <Row label="Acreditaciones detectadas" value={`${p.filas}`} />
      <Row label="Empleadores" value={(p.empleadores as string[]).join(', ')} />
      {omitidas > 0 && (
        <Row label="Ya cargadas (omitidas)" value={`${omitidas}`} />
      )}
      <div style={{ borderTop: '1px solid var(--border)', paddingTop: 8, marginTop: 2 }}>
        <p style={{ fontSize: 11, color: 'var(--muted)', margin: '0 0 6px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          Detalle (ARS convertido a USD con el MEP del día de cada pago)
        </p>
        {rows.map((r, i) => (
          <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4, gap: 8 }}>
            <span style={{ color: 'var(--muted)', flexShrink: 0 }}>{r.fecha}</span>
            <span style={{ color: 'var(--text)', fontWeight: 600, flex: 1, textAlign: 'left' }}>{r.empleador}</span>
            <span style={{ color: 'var(--up)', flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>{fmtHaberMonto(r)}</span>
          </div>
        ))}
      </div>
    </>
  );
}

function DoneHaberes({ p }: { p: Record<string, unknown> }) {
  const rows = p.rows as HaberRow[];
  const totalArs = rows.reduce((s, r) => s + r.montoArs, 0);
  const totalUsd = rows.reduce((s, r) => s + r.montoUsd, 0);
  return (
    <>
      <Row label="Filas subidas" value={`${p.filas}`} />
      {totalArs > 0 && <Row label="Total ARS" value={formatMoney(totalArs, { currency: 'ARS', mode: 'price' })} />}
      {totalUsd > 0 && <Row label="Total USD (según MEP del día)" value={formatMoney(totalUsd, { currency: 'USD', mode: 'price' })} />}
    </>
  );
}

// ── Formulario de empleadores nuevos (estandarizar nombre) ───────────────────

function EmpleadoresNuevosForm({
  nombres,
  onConfirm,
  onCancel,
}: {
  nombres: string[];
  onConfirm: (mapeo: Record<string, string>) => void;
  onCancel: () => void;
}) {
  const [valores, setValores] = useState<Record<string, string>>(
    Object.fromEntries(nombres.map((n) => [n, n.toUpperCase()]))
  );

  const allFilled = nombres.every((n) => valores[n]?.trim());

  const labelStyle: React.CSSProperties = {
    fontSize: 10, fontWeight: 700, color: 'var(--muted)',
    textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 3, display: 'block',
  };
  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '5px 8px', borderRadius: 6,
    border: '1px solid var(--border)', background: 'var(--card)',
    color: 'var(--text)', fontSize: 12, boxSizing: 'border-box',
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{
        background: 'rgba(245,197,24,0.08)', border: '1px solid rgba(245,197,24,0.35)',
        borderRadius: 8, padding: '10px 14px',
      }}>
        <p style={{ fontSize: 12, fontWeight: 700, color: '#f5c518', margin: '0 0 3px' }}>
          ⚠ {nombres.length} empleador{nombres.length !== 1 ? 'es' : ''} nuevo{nombres.length !== 1 ? 's' : ''} detectado{nombres.length !== 1 ? 's' : ''}
        </p>
        <p style={{ fontSize: 12, color: 'var(--muted)', margin: 0 }}>
          Revisá o corregí el nombre estandarizado antes de subir los ingresos.
        </p>
      </div>

      {nombres.map((n) => (
        <div key={n} style={{
          border: '1px solid var(--border)', borderRadius: 8,
          padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 8,
        }}>
          <p style={{ fontSize: 11, color: 'var(--muted)', margin: 0 }}>Detectado como: <span style={{ color: 'var(--text-sec)' }}>{n}</span></p>
          <div>
            <label style={labelStyle}>Nombre estandarizado</label>
            <input
              style={{ ...inputStyle, textTransform: 'uppercase' }}
              value={valores[n] ?? ''}
              onChange={(e) => setValores((prev) => ({ ...prev, [n]: e.target.value.toUpperCase() }))}
            />
          </div>
        </div>
      ))}

      <div style={{ display: 'flex', gap: 8 }}>
        <button
          style={{
            padding: '9px 24px', borderRadius: 8, border: 'none',
            background: allFilled ? 'var(--primary)' : 'var(--border)',
            color: allFilled ? '#fff' : 'var(--muted)',
            fontWeight: 700, fontSize: 13,
            cursor: allFilled ? 'pointer' : 'not-allowed',
          }}
          disabled={!allFilled}
          onClick={() => onConfirm(valores)}
        >
          Confirmar y subir
        </button>
        <button
          style={{
            padding: '9px 24px', borderRadius: 8,
            border: '1px solid var(--border)', background: 'transparent',
            color: 'var(--muted)', fontWeight: 500, fontSize: 13, cursor: 'pointer',
          }}
          onClick={onCancel}
        >
          Cancelar
        </button>
      </div>
    </div>
  );
}

// ── Uploader de Haberes (multi-PDF: parsea cada archivo, combina en un solo preview) ──

interface ArchivoResultado {
  nombre: string;
  ok: boolean;
  error?: string;
  filas?: number;
}

function UploaderHaberes() {
  const [state, setState] = useState<UploaderState>({ step: 'idle' });
  const [archivos, setArchivos] = useState<ArchivoResultado[]>([]);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFiles = useCallback(async (fileList: FileList | File[]) => {
    const files = Array.from(fileList);
    const pdfs = files.filter((f) => f.name.endsWith('.pdf'));
    if (pdfs.length === 0) {
      setState({ step: 'error', error: 'Los archivos deben ser PDF.' });
      return;
    }
    setState({ step: 'parsing' });

    const resultados: ArchivoResultado[] = [];
    const filasCombinadas: HaberRow[] = [];
    const empleadoresNuevosSet = new Set<string>();
    const empleadoresSet = new Set<string>();
    let omitidasTotal = 0;

    for (const file of pdfs) {
      const formData = new FormData();
      formData.append('pdf', file);
      try {
        const res = await fetch('/api/upload-haberes?action=parse', { method: 'POST', body: formData });
        const json = await res.json();
        if (!res.ok) {
          resultados.push({ nombre: file.name, ok: false, error: json.error ?? 'Error desconocido' });
          continue;
        }
        const rows = json.rows as HaberRow[];
        omitidasTotal += (json.omitidas as number) ?? 0;
        // Dedupe entre archivos del mismo lote (ej. dos PDFs que se solapan en un mes):
        // misma fecha + monto ya agregado por otro archivo del lote. No se compara el
        // empleador porque cada parse devuelve el nombre crudo del PDF, no el estandarizado.
        for (const r of rows) {
          const clave = `${r.fecha}|${r.montoArs}|${r.montoUsd}`;
          if (filasCombinadas.some((f) => `${f.fecha}|${f.montoArs}|${f.montoUsd}` === clave)) {
            omitidasTotal += 1;
            continue;
          }
          filasCombinadas.push(r);
          empleadoresSet.add(r.empleador);
        }
        for (const e of (json.empleadoresNuevos as string[] ?? [])) empleadoresNuevosSet.add(e);
        resultados.push({ nombre: file.name, ok: true, filas: rows.length });
      } catch (e: unknown) {
        resultados.push({ nombre: file.name, ok: false, error: e instanceof Error ? e.message : String(e) });
      }
    }

    setArchivos(resultados);

    if (filasCombinadas.length === 0) {
      setState({ step: 'error', error: 'Ningún archivo pudo procesarse. Revisá el detalle debajo.' });
      return;
    }

    setState({
      step: 'preview',
      preview: {
        filas: filasCombinadas.length,
        rows: filasCombinadas,
        empleadores: Array.from(empleadoresSet),
        empleadoresNuevos: Array.from(empleadoresNuevosSet),
        omitidas: omitidasTotal,
      },
    });
  }, []);

  const uploadHaberes = useCallback(async (rows: HaberRow[]) => {
    setState((s) => ({ ...s, step: 'confirming' }));
    try {
      const res = await fetch('/api/upload-haberes?action=confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows }),
      });
      const json = await res.json();
      if (!res.ok) {
        setState({ step: 'error', error: json.error ?? 'Error al confirmar' });
        return;
      }
      setState({ step: 'done', confirmed: json });
    } catch (e: unknown) {
      setState({ step: 'error', error: e instanceof Error ? e.message : String(e) });
    }
  }, []);

  const handleEmpleadoresConfirm = useCallback(async (mapeo: Record<string, string>) => {
    if (!state.preview) return;
    const rows = (state.preview.rows as HaberRow[]).map((r) => ({
      ...r,
      empleador: mapeo[r.empleador] ?? r.empleador,
    }));
    await uploadHaberes(rows);
  }, [state.preview, uploadHaberes]);

  const handleConfirm = useCallback(async () => {
    if (!state.preview) return;
    const nuevos = (state.preview.empleadoresNuevos as string[] | undefined) ?? [];
    if (nuevos.length > 0) {
      setState((s) => ({ ...s, step: 'completing' }));
      return;
    }
    await uploadHaberes(state.preview.rows as HaberRow[]);
  }, [state.preview, uploadHaberes]);

  const reset = () => {
    setState({ step: 'idle' });
    setArchivos([]);
    if (inputRef.current) inputRef.current.value = '';
  };

  const dropZoneStyle: React.CSSProperties = {
    width: '100%',
    border: `2px dashed ${dragging ? 'var(--primary)' : 'var(--border)'}`,
    borderRadius: 10,
    padding: '22px 20px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 6,
    cursor: 'pointer',
    background: dragging ? 'var(--primary-dim)' : 'transparent',
    transition: 'all 0.15s',
    boxSizing: 'border-box',
  };

  const btnPrimary: React.CSSProperties = {
    padding: '9px 24px', borderRadius: 8, border: 'none',
    background: 'var(--primary)', color: '#fff',
    fontWeight: 700, fontSize: 13, cursor: 'pointer',
  };

  const btnSecondary: React.CSSProperties = {
    ...btnPrimary, background: 'transparent',
    border: '1px solid var(--border)', color: 'var(--muted)', fontWeight: 500,
  };

  return (
    <div style={{
      background: 'var(--card)', border: '1px solid var(--border)',
      borderRadius: 12, padding: '20px 24px',
      display: 'flex', flexDirection: 'column', gap: 14,
    }}>
      <div>
        <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--primary)', marginBottom: 3 }}>
          Sueldos / Haberes
        </p>
        <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', margin: 0 }}>
          Resumen de cuenta bancario — acreditación de haberes
        </p>
        <p style={{ fontSize: 11, color: 'var(--muted)', margin: '4px 0 0' }}>
          PDF del resumen de tu cuenta sueldo (banco): detecta las líneas &quot;Acreditacion de haberes&quot; y su empleador. Podés soltar varios PDFs (uno por mes) a la vez.
        </p>
      </div>

      {state.step === 'idle' && (
        <div
          style={dropZoneStyle}
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => { e.preventDefault(); setDragging(false); if (e.dataTransfer.files.length) handleFiles(e.dataTransfer.files); }}
          onClick={() => inputRef.current?.click()}
        >
          <span style={{ fontSize: 26 }}>📄</span>
          <p style={{ fontSize: 13, color: 'var(--text)', margin: 0, fontWeight: 600 }}>Arrastrá uno o varios PDFs acá</p>
          <p style={{ fontSize: 11, color: 'var(--muted)', margin: 0 }}>o hacé click para seleccionarlos</p>
          <input ref={inputRef} type="file" accept=".pdf" multiple style={{ display: 'none' }}
            onChange={(e) => { if (e.target.files?.length) handleFiles(e.target.files); }} />
        </div>
      )}

      {state.step === 'parsing' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0' }}>
          <Spinner />
          <p style={{ color: 'var(--muted)', fontSize: 13, margin: 0 }}>Leyendo PDF{archivos.length !== 1 ? 's' : ''}...</p>
        </div>
      )}

      {state.step === 'preview' && state.preview && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {archivos.length > 1 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {archivos.map((a, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
                  <span style={{ color: a.ok ? 'var(--up)' : 'var(--down)' }}>{a.ok ? '✓' : '✕'}</span>
                  <span style={{ color: 'var(--text-sec)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.nombre}</span>
                  <span style={{ color: 'var(--muted)', fontSize: 11 }}>{a.ok ? `${a.filas} filas` : a.error}</span>
                </div>
              ))}
            </div>
          )}
          <div style={{
            background: 'rgba(99,102,241,0.07)', border: '1px solid rgba(99,102,241,0.25)',
            borderRadius: 8, padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: 10,
          }}>
            <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--primary)', margin: 0, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
              Vista previa combinada — revisá antes de confirmar
            </p>
            <PreviewHaberes p={state.preview} />
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button style={btnPrimary} onClick={handleConfirm}>Confirmar y subir</button>
            <button style={btnSecondary} onClick={reset}>Cancelar</button>
          </div>
        </div>
      )}

      {state.step === 'completing' && state.preview && (
        <EmpleadoresNuevosForm
          nombres={(state.preview.empleadoresNuevos as string[]) ?? []}
          onConfirm={handleEmpleadoresConfirm}
          onCancel={reset}
        />
      )}

      {state.step === 'confirming' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0' }}>
          <Spinner />
          <p style={{ color: 'var(--muted)', fontSize: 13, margin: 0 }}>Subiendo a Google Sheets...</p>
        </div>
      )}

      {state.step === 'done' && state.confirmed && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{
            background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.3)',
            borderRadius: 8, padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: 8,
          }}>
            <p style={{ fontSize: 12, fontWeight: 700, color: '#22c55e', margin: 0 }}>✓ Subido correctamente</p>
            <DoneHaberes p={state.confirmed} />
          </div>
          <button style={btnSecondary} onClick={reset}>Cargar otro resumen</button>
        </div>
      )}

      {state.step === 'error' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{
            background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.3)',
            borderRadius: 8, padding: '14px 18px',
          }}>
            <p style={{ fontSize: 12, fontWeight: 700, color: '#ef4444', margin: '0 0 4px' }}>Error</p>
            <p style={{ fontSize: 13, color: 'var(--text)', margin: 0 }}>{state.error}</p>
          </div>
          {archivos.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {archivos.map((a, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
                  <span style={{ color: a.ok ? 'var(--up)' : 'var(--down)' }}>{a.ok ? '✓' : '✕'}</span>
                  <span style={{ color: 'var(--text-sec)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.nombre}</span>
                  <span style={{ color: 'var(--muted)', fontSize: 11 }}>{a.ok ? `${a.filas} filas` : a.error}</span>
                </div>
              ))}
            </div>
          )}
          <button style={btnPrimary} onClick={reset}>Intentar de nuevo</button>
        </div>
      )}
    </div>
  );
}

// ── Export ────────────────────────────────────────────────────────────────────

export default function UploadTenencias() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

      {/* Tenencias */}
      <Uploader
        title="Tenencias del mes"
        subtitle="Resumen de cuenta del broker — posición al cierre"
        hint="PDF de posición mensual: contiene la sección &quot;POSICION AL CIERRE DEL&quot; con todos tus instrumentos."
        parseEndpoint="/api/upload-tenencias?action=parse"
        confirmEndpoint="/api/upload-tenencias?action=confirm"
        buildConfirmBody={(p) => ({
          mesKey: p.mes,
          fechaStr: p.fecha,
          dolarMep: p.dolarMep,
          rows: p.rows,
        })}
        renderPreview={(p) => <PreviewTenencias p={p} />}
        renderDone={(p) => <DoneTenencias p={p} />}
      />

      {/* Movimientos */}
      <Uploader
        title="Movimientos del mes"
        subtitle="Resumen de cuenta del broker — ingresos y retiros"
        hint="El mismo PDF mensual del broker: también contiene la sección &quot;INCREMENTOS/DECREMENTOS DE LA INVERSION&quot; con depósitos y retiros."
        parseEndpoint="/api/upload-movimientos?action=parse"
        confirmEndpoint="/api/upload-movimientos?action=confirm"
        buildConfirmBody={(p) => ({
          mesKey: p.mes,
          rows: p.movimientos,
        })}
        renderPreview={(p) => <PreviewMovimientos p={p} />}
        renderDone={(p) => <DoneMovimientos p={p} />}
      />

      {/* Haberes */}
      <UploaderHaberes />

    </div>
  );
}
