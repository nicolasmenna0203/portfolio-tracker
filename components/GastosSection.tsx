'use client';

import { useState, useMemo, useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import type { GastoFijo } from '@/types';
import { formatMoney, formatPercent, formatMesKey, type Moneda } from '@/lib/format';
import { toMesKey } from '@/lib/parser';
import { totalGastos, gastosVigentes, gastoVigenteEn, gastoMensualEn, montoMensual, type ResumenFlujo } from '@/lib/finanzasPersonales';
import {
  editarGasto, darDeBaja, renombrarCategoria, agruparPorConcepto, claveConcepto, cortarSolapados,
  type Concepto, type TramoGasto,
} from '@/lib/gastosEdicion';
import { CATEGORIAS, descripcionCategoria, esCategoriaDeLista } from '@/lib/gastosCategorias';
import InfoTip from './InfoTip';
import GastoForm, { type ResultadoForm } from './GastoForm';
import SugerenciasGastos from './SugerenciasGastos';

// Catálogo de gastos mensuales: recurrentes (suscripciones, seguros, alquiler)
// y también estimados (supermercado, transporte, salidas) cargados como un
// monto por mes. Cuanto más completo, menos queda "sin asignar" en la franja de
// flujo mensual. Persiste en la hoja `GastosFijos` (nombre histórico, se mantiene
// para no huérfanar el Sheet existente; ver lib/gastosFijos.ts).
//
// Cada gasto tiene una vigencia (desde / hasta, en meses): uno nuevo no
// reescribe los meses anteriores, y uno dado de baja se conserva en el historial
// sin sumar. Los totales de esta pestaña son los vigentes en el mes en curso;
// el promedio de la franja de arriba suma, mes a mes, los vigentes de cada uno.
// Decisión y alternativas: docs/decisiones/0025-gastos-con-vigencia-por-mes.md
//
// Las categorías son una lista cerrada de cuatro, cada una con su ayuda y su color
// fijo. Un grupo con una categoría fuera de la lista (vieja o escrita a mano en el
// Sheet) se puede mover a una de las cuatro.
// Decisión y alternativas: docs/decisiones/0028-cuatro-categorias-de-gastos-por-el-fin-del-gasto.md
//
// Un gasto puede tener varios períodos (un aumento, o un corte y una vuelta): son
// filas del Sheet con el mismo nombre y categoría que acá se muestran como un solo
// gasto, con su línea de tiempo desplegable. Decisión y alternativas:
// docs/decisiones/0027-gastos-con-periodos-agrupados-por-concepto.md
//
// La lista la carga FinanzasPersonalesTab (se comparte con Ingresos y
// Proyecciones). Esta sección la edita: actualiza la lista de inmediato, guarda
// en el servidor y, si el guardado falla, vuelve a la versión anterior. Le avisa
// al padre con `onChange` para que las demás pestañas vean el cambio.
//
// Si la lista no se pudo leer no se muestra nada editable: guardar reemplaza la hoja
// entera, así que editar sobre una lista vacía por error borraría el catálogo.
// Decisión y alternativas: docs/decisiones/0029-lectura-fallida-no-es-lista-vacia.md
interface Props {
  gastos: GastoFijo[];
  loading: boolean;
  loadError: string | null;
  onChange: (lista: GastoFijo[]) => void;
  onReintentar: () => void;
  /** Flujo mensual en la moneda del toggle: aporta el ingreso promedio contra el que se miden los gastos. */
  resumen: ResumenFlujo;
  hideValues: boolean;
  moneda?: Moneda;
  mepActual: number | null;
}

// Color fijo por categoría: si dependiera del orden, una categoría cambiaría de color
// al aparecer o desaparecer otra.
const COLOR_CATEGORIA: Record<string, string> = {
  'Súper y comida': '#d9824e',
  Transporte: '#6fa8d6',
  Hogar: '#cfab6e',
  'Ocio y personal': '#5fb896',
};
const COLOR_FUERA_DE_LISTA = 'var(--muted)';
const colorDe = (categoria: string) => COLOR_CATEGORIA[categoria] ?? COLOR_FUERA_DE_LISTA;

/** Un gasto con su posición en la lista completa (las operaciones de edición trabajan por índice). */
type Item = TramoGasto;

export default function GastosSection({
  gastos, loading, loadError, onChange, onReintentar, resumen, hideValues, moneda = 'ARS', mepActual,
}: Props) {
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [guardado, setGuardado] = useState(false);
  const errorRef = useRef<HTMLDivElement>(null);
  const [agregando, setAgregando] = useState(false);
  const [formKey, setFormKey] = useState(0);
  const [editando, setEditando] = useState<number | null>(null);
  const [renombrando, setRenombrando] = useState<string | null>(null);
  const [expandidos, setExpandidos] = useState<Set<string>>(new Set());
  /** Alta de otro período de un gasto existente: de cuál (clave del concepto) y con qué precarga. */
  const [nuevoPeriodo, setNuevoPeriodo] = useState<{ clave: string; plantilla: GastoFijo } | null>(null);
  const pathname = usePathname();
  const apiBase = pathname?.startsWith('/demo') ? '/api/demo' : '/api';
  const esDemo = pathname?.startsWith('/demo') ?? false;

  // El error de guardado aparece arriba de todo y el form puede estar mucho más abajo.
  useEffect(() => {
    if (saveError) errorRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [saveError]);

  // La confirmación se va sola: es un acuse de recibo, no un estado.
  useEffect(() => {
    if (!guardado) return;
    const t = setTimeout(() => setGuardado(false), 2500);
    return () => clearTimeout(t);
  }, [guardado]);

  // Mes en curso: define qué gastos suman hoy, cuáles están programados y cuáles dados de baja.
  const mesActual = useMemo(() => toMesKey(Date.now()), []);

  const enBaja = (g: GastoFijo) => g.hasta != null && g.hasta < mesActual;
  // Un gasto está dado de baja cuando ya terminaron todos sus períodos: un aumento
  // de monto (el período viejo termina, el nuevo sigue) no lo da de baja.
  const conceptos = useMemo(() => agruparPorConcepto(gastos, mesActual), [gastos, mesActual]);
  const activos = useMemo(() => conceptos.filter((c) => c.estado !== 'baja'), [conceptos]);
  const bajas = useMemo(() => conceptos.filter((c) => c.estado === 'baja'), [conceptos]);
  const programados = activos.filter((c) => c.estado === 'programado').length;

  // Cada categoría con su total mensual (solo lo vigente hoy) en la moneda del toggle.
  // Adentro, lo que más pesa primero; lo programado, que todavía no suma, al final.
  const porCategoria = useMemo(() => {
    const map = new Map<string, Concepto[]>();
    for (const c of activos) {
      if (!map.has(c.categoria)) map.set(c.categoria, []);
      map.get(c.categoria)!.push(c);
    }
    const peso = (c: Concepto) => (c.estado === 'activo' ? gastoMensualEn(c.actual.g, moneda, mepActual) ?? 0 : -1);
    return Array.from(map.entries())
      .map(([categoria, lista]) => ({
        categoria,
        items: [...lista].sort((a, b) => peso(b) - peso(a)),
        total: totalGastos(
          lista.flatMap((c) => c.tramos.map((t) => t.g)).filter((g) => gastoVigenteEn(g, mesActual)),
          moneda, mepActual,
        ).total,
      }))
      .sort((a, b) => b.total - a.total || a.categoria.localeCompare(b.categoria));
  }, [activos, moneda, mepActual, mesActual]);

  const vigentes = useMemo(() => gastosVigentes(gastos, mesActual), [gastos, mesActual]);
  const { total: totalMensual, incompleto: hayInconvertibles } = useMemo(
    () => totalGastos(vigentes, moneda, mepActual),
    [vigentes, moneda, mepActual],
  );

  const ingresoProm = resumen.ingresoProm;
  const pctIngreso = (monto: number) =>
    ingresoProm != null && ingresoProm > 0 ? (monto / ingresoProm) * 100 : null;
  const repartidas = porCategoria.filter((c) => c.total > 0);

  /**
   * Muestra la lista nueva enseguida y la guarda; si el servidor falla, vuelve a
   * la anterior y muestra el error. Devuelve si se guardó.
   */
  async function guardar(nuevaLista: GastoFijo[]): Promise<boolean> {
    const previa = gastos;
    setSaving(true);
    setSaveError(null);
    setGuardado(false);
    onChange(nuevaLista);
    try {
      const r = await fetch(`${apiBase}/gastos-fijos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gastos: nuevaLista }),
      });
      const json = await r.json();
      if (!r.ok || json.error) throw new Error(json.error ?? `Error ${r.status}`);
      setGuardado(true);
      return true;
    } catch (e) {
      onChange(previa);
      setSaveError(`No se pudo guardar, se volvió a la versión anterior. ${e instanceof Error ? e.message : String(e)}`);
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function agregar({ valores, cortarSolapados: cortar }: ResultadoForm) {
    const nuevo: GastoFijo = {
      nombre: valores.nombre,
      monto: valores.monto,
      moneda: valores.moneda,
      frecuencia: valores.frecuencia,
      categoria: valores.categoria,
      ...(valores.desde ? { desde: valores.desde } : {}),
      ...(valores.hasta ? { hasta: valores.hasta } : {}),
    };
    const base = cortar ? cortarSolapados(gastos, nuevo) ?? gastos : gastos;
    if (await guardar([...base, nuevo])) {
      setFormKey((k) => k + 1);
      setNuevoPeriodo(null);
    }
  }

  function alternar(clave: string) {
    setExpandidos((prev) => {
      const sig = new Set(prev);
      if (!sig.delete(clave)) sig.add(clave);
      return sig;
    });
  }

  /** Abre el alta de otro período de este gasto y deja a la vista su línea de tiempo. */
  function otroPeriodo(g: GastoFijo) {
    const clave = claveConcepto(g);
    setEditando(null);
    setRenombrando(null);
    setExpandidos((prev) => new Set(prev).add(clave));
    setNuevoPeriodo({ clave, plantilla: g });
  }

  async function editar(idx: number, { valores, cambioDesde }: ResultadoForm) {
    const nueva = editarGasto(gastos, idx, valores, { cambioDesde });
    if (await guardar(nueva)) setEditando(null);
  }

  async function bajaDe(idx: number) {
    // El último mes que cuenta es el actual: la baja rige desde el mes que viene.
    if (await guardar(darDeBaja(gastos, idx, mesActual))) setEditando(null);
  }

  async function eliminar(idx: number) {
    if (await guardar(gastos.filter((_, i) => i !== idx))) setEditando(null);
  }

  async function renombrar(de: string, a: string) {
    if (await guardar(renombrarCategoria(gastos, de, a))) setRenombrando(null);
  }

  const abrirEdicion = (idx: number) => { setNuevoPeriodo(null); setRenombrando(null); setEditando(idx); };

  function formEdicion({ g, idx }: Item) {
    return (
      <div key={idx} style={{ background: 'var(--card-alt)', borderRadius: 8, padding: 12, margin: '6px 0' }}>
        <GastoForm
          gastos={gastos}
          inicial={g}
          mesActual={mesActual}
          saving={saving}
          onSubmit={(r) => editar(idx, r)}
          onCancel={() => setEditando(null)}
          // Un gasto programado todavía no empezó: no hay nada que dar de baja, solo eliminarlo.
          onBaja={g.hasta != null || (g.desde != null && g.desde > mesActual) ? undefined : () => bajaDe(idx)}
          onEliminar={() => eliminar(idx)}
          onOtroPeriodo={() => otroPeriodo(g)}
        />
      </div>
    );
  }

  function fila(item: Item, concepto?: Concepto) {
    const { g, idx } = item;
    const varios = concepto != null && concepto.tramos.length > 1;
    const abierto = concepto != null && expandidos.has(concepto.clave);
    // Con la línea de tiempo abierta, el form va en el período: acá quedaría duplicado.
    if (editando === idx && !(varios && abierto)) return formEdicion(item);

    const programado = g.desde != null && g.desde > mesActual;
    const baja = enBaja(g);
    // "mensual" es lo esperado y no se rotula: solo el anual y la vigencia merecen una línea.
    const hayMeta = g.frecuencia === 'anual' || g.desde != null || g.hasta != null || varios;
    return (
      <div key={idx} className={`gasto-row${programado || baja ? ' inactivo' : ''}`}>
        <span className="gasto-nombre" title={g.nombre}>{g.nombre}</span>
        {hayMeta && (
          <span className="gasto-meta">
            {varios && (
              <button
                type="button"
                className="g-chip g-chip-btn"
                onClick={() => alternar(concepto.clave)}
                aria-expanded={abierto}
                title="Ver los períodos de este gasto"
              >{concepto.tramos.length} períodos {abierto ? '▴' : '▾'}</button>
            )}
            {g.frecuencia === 'anual' && <span>anual · {formatMoney(montoMensual(g), { currency: g.moneda, hidden: hideValues })}/mes</span>}
            {baja ? (
              <span className="g-chip baja">
                {g.desde ? `${formatMesKey(g.desde)} → ` : 'hasta '}{formatMesKey(g.hasta!)}
              </span>
            ) : (
              <>
                {programado && <span className="g-chip destacado">programado · {formatMesKey(g.desde!)}</span>}
                {!programado && g.desde && <span className="g-chip">desde {formatMesKey(g.desde)}</span>}
                {g.hasta && <span className="g-chip baja">hasta {formatMesKey(g.hasta)}</span>}
              </>
            )}
          </span>
        )}
        <span className="gasto-monto">
          {formatMoney(g.monto, { currency: g.moneda, hidden: hideValues })}
        </span>
        <span className="gasto-acc">
          <button
            type="button"
            className="g-icon-btn"
            onClick={() => abrirEdicion(idx)}
            disabled={saving}
            aria-label={`Editar ${g.nombre}`}
            title="Editar"
          >✎</button>
        </span>
      </div>
    );
  }

  /** Un período dentro de la línea de tiempo de un gasto: cuándo rige y con qué monto. */
  function filaTramo(item: Item) {
    const { g, idx } = item;
    if (editando === idx) return formEdicion(item);

    const vigente = gastoVigenteEn(g, mesActual);
    const programado = g.desde != null && g.desde > mesActual;
    const hayMeta = vigente || programado || g.frecuencia === 'anual';
    return (
      <div key={idx} className={`gasto-row tramo${vigente ? '' : ' inactivo'}`}>
        <span className="gasto-nombre">
          {g.desde ? formatMesKey(g.desde) : 'Desde el inicio'} → {g.hasta ? formatMesKey(g.hasta) : 'en adelante'}
        </span>
        {hayMeta && (
          <span className="gasto-meta">
            {g.frecuencia === 'anual' && <span>anual · {formatMoney(montoMensual(g), { currency: g.moneda, hidden: hideValues })}/mes</span>}
            {vigente && <span className="g-chip destacado">actual</span>}
            {programado && <span className="g-chip">programado</span>}
          </span>
        )}
        <span className="gasto-monto">
          {formatMoney(g.monto, { currency: g.moneda, hidden: hideValues })}
        </span>
        <span className="gasto-acc">
          <button
            type="button"
            className="g-icon-btn"
            onClick={() => abrirEdicion(idx)}
            disabled={saving}
            aria-label={`Editar el período de ${g.nombre}`}
            title="Editar este período"
          >✎</button>
        </span>
      </div>
    );
  }

  /** Un gasto: su fila y, si tiene varios períodos y está desplegado, la línea de tiempo. */
  function bloque(c: Concepto) {
    const abierto = c.tramos.length > 1 && expandidos.has(c.clave);
    const cargandoPeriodo = nuevoPeriodo?.clave === c.clave;
    return (
      <div key={c.clave}>
        {fila(c.actual, c)}
        {abierto && (
          <div className="gasto-tramos">
            {c.tramos.map(filaTramo)}
            {!cargandoPeriodo && (
              <button type="button" className="g-btn chico" onClick={() => otroPeriodo(c.actual.g)} disabled={saving}>
                + Otro período
              </button>
            )}
          </div>
        )}
        {cargandoPeriodo && nuevoPeriodo && (
          <div style={{ background: 'var(--card-alt)', borderRadius: 8, padding: 12, margin: '6px 0' }}>
            <p className="g-ayuda" style={{ margin: '0 0 8px' }}>
              Otro período de «{c.nombre}»: cargá desde y hasta cuándo rige y con qué monto.
            </p>
            <GastoForm
              key={formKey}
              gastos={gastos}
              plantilla={nuevoPeriodo.plantilla}
              mesActual={mesActual}
              saving={saving}
              onSubmit={agregar}
              onCancel={() => setNuevoPeriodo(null)}
            />
          </div>
        )}
      </div>
    );
  }

  if (loading) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>
        Cargando gastos...
      </div>
    );
  }

  // Sin la lista no hay nada que mostrar ni que se pueda editar sin riesgo (ver header).
  if (loadError) {
    return (
      <div role="alert" style={{
        background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.3)',
        borderRadius: 8, padding: '14px 18px',
      }}>
        <p style={{ fontSize: 12, fontWeight: 700, color: '#ef4444', margin: '0 0 4px' }}>No se pudieron leer los gastos</p>
        <p style={{ fontSize: 13, color: 'var(--text)', margin: '0 0 10px' }}>
          La edición queda desactivada para no pisar lo que hay en el Sheet. {loadError}
        </p>
        <button type="button" className="g-btn chico" onClick={onReintentar}>Reintentar</button>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {saveError && (
        <div ref={errorRef} role="alert" style={{
          background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.3)',
          borderRadius: 8, padding: '14px 18px',
        }}>
          <p style={{ fontSize: 12, fontWeight: 700, color: '#ef4444', margin: '0 0 4px' }}>Error</p>
          <p style={{ fontSize: 13, color: 'var(--text)', margin: 0 }}>{saveError}</p>
        </div>
      )}

      {/* Lo de este mes. La franja de arriba promedia meses cerrados: por eso este
          número puede diferir de su "Gastos", y por eso el rótulo dice el mes. */}
      {conceptos.length > 0 && (
        <div className="g-card">
          <div className="g-etiqueta" style={{ marginBottom: 6 }}>
            <p className="g-eyebrow" style={{ margin: 0 }}>Gastos de {formatMesKey(mesActual)}</p>
            <InfoTip label="el total del mes">
              Lo que suma este mes: los gastos vigentes, a monto mensual (los anuales /12; los de otra
              moneda, al MEP actual). No incluye los dados de baja ni los programados. El porcentaje es
              sobre el ingreso promedio de los últimos meses cerrados.
            </InfoTip>
          </div>
          <p className="gasto-total">{formatMoney(totalMensual, { currency: moneda, hidden: hideValues })}</p>
          <p className="g-ayuda">
            {hayInconvertibles
              ? 'Sin MEP para convertir algún gasto: el total está incompleto.'
              : [
                  pctIngreso(totalMensual) != null && `${formatPercent(pctIngreso(totalMensual), { sign: false, decimals: 0, hidden: hideValues })} del ingreso`,
                  `${formatMoney(totalMensual * 12, { currency: moneda, hidden: hideValues })} por año`,
                  `${vigentes.length} ${vigentes.length === 1 ? 'gasto' : 'gastos'}`,
                ].filter(Boolean).join(' · ')}
          </p>

          {totalMensual > 0 && !hideValues && (
            <>
              <div
                role="img"
                aria-label={repartidas.map((c) => `${c.categoria} ${Math.round((c.total / totalMensual) * 100)}%`).join(', ')}
                className="gasto-barra"
              >
                {repartidas.map((c) => (
                  <div key={c.categoria} style={{ width: `${(c.total / totalMensual) * 100}%`, background: colorDe(c.categoria) }} />
                ))}
              </div>
              <div className="gasto-leyenda">
                {repartidas.map((c) => (
                  <span key={c.categoria}>
                    <span className="punto" style={{ background: colorDe(c.categoria) }} />
                    {c.categoria} <strong>{formatPercent((c.total / totalMensual) * 100, { sign: false, decimals: 0 })}</strong>
                  </span>
                ))}
              </div>
            </>
          )}

          {/* El residuo de la franja de arriba, acá como llamado a completar la lista. */}
          {resumen.sinAsignar != null && resumen.sinAsignar > 0 && !hideValues && (
            <p className="g-ayuda" style={{ marginTop: 10 }}>
              Sin asignar: <strong style={{ color: 'var(--text-sec)', fontVariantNumeric: 'tabular-nums' }}>
                {formatMoney(resumen.sinAsignar, { currency: moneda })}
              </strong> por mes. Es gasto sin cargar o ahorro fuera de la cartera: cuanto más completa la lista, más chico.
            </p>
          )}
        </div>
      )}

      <SugerenciasGastos gastos={gastos} saving={saving} onAplicar={guardar} />

      <div className="g-card">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
          <p className="g-eyebrow" style={{ margin: 0 }}>Detalle por categoría</p>
          <span className="g-ayuda" role="status" style={{ marginLeft: 'auto' }}>
            {saving ? 'Guardando…' : guardado ? (esDemo ? 'Aplicado (demo)' : 'Guardado ✓') : ''}
          </span>
          <button
            type="button"
            className={`g-btn chico${agregando ? '' : ' primario'}`}
            style={{ flexShrink: 0, whiteSpace: 'nowrap' }}
            onClick={() => setAgregando((v) => !v)}
            aria-expanded={agregando}
          >{agregando ? 'Cerrar' : '+ Agregar gasto'}</button>
        </div>

        {esDemo && (
          <p className="g-ayuda" style={{ marginBottom: 12 }}>
            Demo: podés probar la carga y la edición, pero los cambios no se guardan.
          </p>
        )}

        {(agregando || gastos.length === 0) && (
          <div style={{ background: 'var(--card-alt)', borderRadius: 8, padding: 12, marginBottom: 16 }}>
            <GastoForm
              key={formKey}
              gastos={gastos}
              mesActual={mesActual}
              saving={saving}
              onSubmit={agregar}
            />
          </div>
        )}

        {porCategoria.length === 0 && (
          <p style={{ fontSize: 13, color: 'var(--muted)', margin: 0 }}>Todavía no hay gastos cargados. Sumá los recurrentes (suscripciones, seguros, alquiler) y los que estimás por mes (supermercado, transporte, salidas).</p>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          {porCategoria.map(({ categoria, items: lista, total }) => (
            <div key={categoria}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <span style={{
                  width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
                  background: colorDe(categoria),
                }} />
                {renombrando === categoria ? (
                  <CambiarCategoria
                    actual={categoria}
                    cantidad={lista.reduce((n, c) => n + c.tramos.length, 0)}
                    saving={saving}
                    onGuardar={(nuevo) => renombrar(categoria, nuevo)}
                    onCancelar={() => setRenombrando(null)}
                  />
                ) : (
                  <>
                    <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', textTransform: 'uppercase', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{categoria}</span>
                    {descripcionCategoria(categoria) && (
                      <InfoTip label={categoria}>{descripcionCategoria(categoria)}</InfoTip>
                    )}
                    {!esCategoriaDeLista(categoria) && (
                      <button
                        type="button"
                        className="g-icon-btn"
                        style={{ width: 24, height: 24, fontSize: 12 }}
                        onClick={() => { setEditando(null); setRenombrando(categoria); }}
                        disabled={saving}
                        aria-label={`Mover los gastos de ${categoria} a otra categoría`}
                        title="Mover a una categoría de la lista"
                      >✎</button>
                    )}
                    {/* Subtotal mensual de la categoría y su peso sobre el ingreso. */}
                    <span style={{ marginLeft: 'auto', flexShrink: 0, fontSize: 11, color: 'var(--muted)', fontVariantNumeric: 'tabular-nums' }}>
                      {formatMoney(total, { currency: moneda, hidden: hideValues })}
                      {pctIngreso(total) != null && !hideValues && ` · ${formatPercent(pctIngreso(total), { sign: false, decimals: 1 })}`}
                    </span>
                  </>
                )}
              </div>
              <div>{lista.map(bloque)}</div>
            </div>
          ))}
        </div>

        {programados > 0 && (
          <p className="g-ayuda" style={{ marginTop: 14 }}>
            {programados === 1 ? '1 gasto programado' : `${programados} gastos programados`}: todavía no suma{programados === 1 ? '' : 'n'} en el total.
          </p>
        )}
      </div>

      {bajas.length > 0 && (
        <details className="g-card">
          <summary className="g-resumen">
            Dados de baja <span style={{ color: 'var(--muted)', fontWeight: 400 }}>({bajas.length})</span>
          </summary>
          <p className="g-ayuda" style={{ margin: '8px 0' }}>
            No suman en el total de hoy, pero siguen contando en los meses en que estuvieron vigentes.
            Para reactivar uno, editalo y sacale el mes de fin.
          </p>
          <div>{bajas.map(bloque)}</div>
        </details>
      )}
    </div>
  );
}

/** Mueve todos los gastos de una categoría fuera de la lista a una de las cuatro. */
function CambiarCategoria({ actual, cantidad, saving, onGuardar, onCancelar }: {
  actual: string;
  cantidad: number;
  saving: boolean;
  onGuardar: (nuevo: string) => void;
  onCancelar: () => void;
}) {
  const [destino, setDestino] = useState('');

  return (
    <form
      onSubmit={(e) => { e.preventDefault(); if (destino) onGuardar(destino); }}
      style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6, flex: 1, minWidth: 0 }}
    >
      <span className="g-campo" style={{ flex: '1 1 160px' }}>
        <select
          value={destino}
          onChange={(e) => setDestino(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Escape') onCancelar(); }}
          aria-label={`Nueva categoría para los gastos de ${actual}`}
          autoFocus
        >
          <option value="" disabled>Mover «{actual}» a…</option>
          {CATEGORIAS.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </span>
      <button type="submit" className="g-btn chico primario" disabled={saving || !destino}>Guardar</button>
      <button type="button" className="g-btn chico" onClick={onCancelar} disabled={saving}>Cancelar</button>
      {destino && (
        <span className="g-ayuda" style={{ flexBasis: '100%' }}>
          {cantidad === 1 ? '1 gasto pasa' : `${cantidad} gastos pasan`} a «{destino}».
        </span>
      )}
    </form>
  );
}
