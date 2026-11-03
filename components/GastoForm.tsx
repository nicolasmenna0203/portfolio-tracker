'use client';

// Formulario de un gasto, compartido por el alta y la edición (la pestaña lo usa
// en las dos, así que los campos y las validaciones no pueden divergir).
//
// Lo que más pesa acá es la vigencia: el formulario obliga a decir desde qué mes
// cuenta el gasto y explica qué significa cada opción, porque cargar uno nuevo
// no puede reescribir los meses anteriores en silencio. Y al editar un monto, a
// preguntar si es una corrección o un cambio desde un mes (ver
// lib/gastosEdicion.ts). El inicio y el fin se piden también en el alta, y con
// `plantilla` se carga otro período de un gasto existente (otro monto, otras
// fechas), avisando si se superpone con uno que ya está y ofreciendo cortarlo. La
// categoría es una de la lista cerrada y se sugiere a partir del nombre
// (lib/gastosCategorias.ts) mientras el usuario no la toque.

import { useId, useMemo, useState } from 'react';
import type { GastoFijo, FrecuenciaGasto } from '@/types';
import { formatMesKey, formatMoney } from '@/lib/format';
import { parseArgNum } from '@/lib/parser';
import { esMesKey, mesAnterior, mesSiguiente } from '@/lib/finanzasPersonales';
import { cambiaLoEconomico, claveConcepto, cortarSolapados, periodosSolapados } from '@/lib/gastosEdicion';
import { CATEGORIA_SIN, CATEGORIAS, descripcionCategoria, esCategoriaDeLista, sugerirCategoria } from '@/lib/gastosCategorias';
import InfoTip from './InfoTip';

export interface ValoresGasto {
  nombre: string;
  monto: number;
  moneda: 'ARS' | 'USD';
  frecuencia: FrecuenciaGasto;
  categoria: string;
  /** `null` = cuenta desde siempre. */
  desde: string | null;
  /** `null` = sin fecha de fin. */
  hasta: string | null;
}

export interface ResultadoForm {
  valores: ValoresGasto;
  /** Solo al editar lo económico de un gasto que ya tenía historia: mes desde el que rige el cambio. */
  cambioDesde?: string;
  /** Solo en el alta: terminar los períodos que se superponen el mes anterior al nuevo. */
  cortarSolapados?: boolean;
}

interface Props {
  /** Catálogo completo: de ahí salen las sugerencias de categoría. */
  gastos: GastoFijo[];
  /** Gasto que se edita; ausente = alta. */
  inicial?: GastoFijo;
  /**
   * Alta de otro período de un gasto que ya existe: precarga concepto, monto y
   * categoría para cargar solo el período y el monto nuevos.
   */
  plantilla?: GastoFijo;
  /** Mes en curso ("YYYY-MM"). */
  mesActual: string;
  saving: boolean;
  onSubmit: (r: ResultadoForm) => void;
  onCancel?: () => void;
  /** Solo en edición. */
  onBaja?: () => void;
  onEliminar?: () => void;
  /** Solo en edición: pasa a cargar otro período de este mismo gasto. */
  onOtroPeriodo?: () => void;
}

type ModoDesde = 'este-mes' | 'inicio' | 'otro';
type ModoCambio = 'desde-mes' | 'corregir';

function modoDesdeInicial(inicial: GastoFijo | undefined, mesActual: string): ModoDesde {
  if (!inicial) return 'este-mes';
  if (!inicial.desde) return 'inicio';
  return inicial.desde === mesActual ? 'este-mes' : 'otro';
}

export default function GastoForm({
  gastos, inicial, plantilla, mesActual, saving, onSubmit, onCancel, onBaja, onEliminar, onOtroPeriodo,
}: Props) {
  const uid = useId();
  const editando = inicial != null;
  const base = inicial ?? plantilla;
  // Otro período de un gasto que ya terminó: arranca el mes siguiente a su fin.
  const arrancaDespuesDe = !editando && plantilla?.hasta ? mesSiguiente(plantilla.hasta) : null;

  const [nombre, setNombre] = useState(base?.nombre ?? '');
  const [monto, setMonto] = useState(base ? String(base.monto).replace('.', ',') : '');
  const [moneda, setMoneda] = useState<'ARS' | 'USD'>(base?.moneda ?? 'ARS');
  const [frecuencia, setFrecuencia] = useState<FrecuenciaGasto>(base?.frecuencia ?? 'mensual');
  const [categoria, setCategoria] = useState(base?.categoria ?? '');
  const [categoriaTocada, setCategoriaTocada] = useState(base != null);

  const [modoDesde, setModoDesde] = useState<ModoDesde>(arrancaDespuesDe ? 'otro' : modoDesdeInicial(inicial, mesActual));
  const [otroDesde, setOtroDesde] = useState(arrancaDespuesDe ?? inicial?.desde ?? mesActual);
  const [conHasta, setConHasta] = useState(inicial?.hasta != null);
  const [hasta, setHasta] = useState(inicial?.hasta ?? mesActual);

  const [modoCambio, setModoCambio] = useState<ModoCambio>('desde-mes');
  const [cambioMes, setCambioMes] = useState(mesActual);
  const [cortar, setCortar] = useState(false);

  const [error, setError] = useState<string | null>(null);

  const montoNum = parseArgNum(monto);
  const sugerencia = useMemo(
    () => sugerirCategoria(nombre, gastos.filter((g) => g !== inicial)),
    [nombre, gastos, inicial],
  );

  // En el alta la categoría sigue a la sugerencia hasta que el usuario la toca.
  const elegida = !categoriaTocada && sugerencia ? sugerencia.categoria : categoria;
  // Un gasto con una categoría fuera de la lista arranca sin elegir: guardarlo pide una de las cuatro.
  const categoriaFinal = esCategoriaDeLista(elegida) ? elegida : '';
  const categoriaVieja = !categoriaFinal && categoria && categoria !== CATEGORIA_SIN ? categoria : null;
  const mostrarChip = sugerencia != null && sugerencia.categoria !== categoriaFinal;

  function elegirCategoria(valor: string) {
    setCategoriaTocada(true);
    setCategoria(valor);
  }

  const desdeEfectivo: string | null =
    modoDesde === 'este-mes' ? mesActual : modoDesde === 'inicio' ? null : otroDesde;

  // Períodos del mismo gasto que cuentan en algún mes de esta vigencia: en esos meses
  // se sumarían dos veces. En el alta, si se pueden cortar sin perder meses, se ofrece.
  const { solapados, cortable } = useMemo(() => {
    if (!nombre.trim() || !categoriaFinal || (modoDesde === 'otro' && !esMesKey(otroDesde)) || (conHasta && !esMesKey(hasta))) {
      return { solapados: [], cortable: false };
    }
    const candidato = { nombre, categoria: categoriaFinal, desde: desdeEfectivo, hasta: conHasta ? hasta : null };
    return {
      solapados: periodosSolapados(gastos, candidato, inicial),
      cortable: !inicial && cortarSolapados(gastos, candidato) != null,
    };
  }, [gastos, nombre, categoriaFinal, modoDesde, otroDesde, conHasta, hasta, desdeEfectivo, inicial]);

  // Nombre y categoría son de todo el gasto: editarlos en un período los cambia en todos.
  const afectaOtrosPeriodos = inicial != null
    && (nombre.trim() !== inicial.nombre || categoriaFinal !== inicial.categoria)
    && gastos.some((g) => g !== inicial && claveConcepto(g) === claveConcepto(inicial));

  // ¿Lo que se cambió es económico y el gasto ya existía antes del mes en curso?
  // Solo ahí tiene sentido preguntar desde cuándo rige.
  const cambioEconomico =
    editando && montoNum != null && cambiaLoEconomico(inicial, { monto: montoNum, moneda, frecuencia });
  const tieneHistoria = editando && (inicial.desde == null || inicial.desde < mesActual);
  const preguntarCambio = cambioEconomico && tieneHistoria;

  function enviar(e: React.FormEvent) {
    e.preventDefault();
    if (!nombre.trim()) return setError('Poné un nombre.');
    if (montoNum == null || montoNum <= 0) return setError('El monto tiene que ser un número mayor a 0.');
    if (!categoriaFinal) return setError('Elegí una categoría.');
    if (modoDesde === 'otro' && !esMesKey(otroDesde)) return setError('Elegí un mes de inicio válido.');
    if (conHasta && !esMesKey(hasta)) return setError('Elegí un mes de fin válido.');
    if (conHasta && desdeEfectivo != null && hasta < desdeEfectivo) {
      return setError('El mes de fin no puede ser anterior al de inicio.');
    }
    if (preguntarCambio && modoCambio === 'desde-mes') {
      if (!esMesKey(cambioMes)) return setError('Elegí el mes desde el que rige el cambio.');
      if (inicial.desde != null && cambioMes <= inicial.desde) {
        return setError(`El cambio tiene que regir después del inicio del gasto (${formatMesKey(inicial.desde)}). Para corregir todos los meses elegí «Corregir».`);
      }
    }
    setError(null);
    onSubmit({
      valores: {
        nombre: nombre.trim(),
        monto: montoNum,
        moneda,
        frecuencia,
        categoria: categoriaFinal,
        desde: desdeEfectivo,
        hasta: conHasta ? hasta : null,
      },
      cambioDesde: preguntarCambio && modoCambio === 'desde-mes' ? cambioMes : undefined,
      cortarSolapados: cortable && cortar,
    });
  }

  const ayudaDesde =
    modoDesde === 'este-mes'
      ? `Cuenta desde ${formatMesKey(mesActual)}. Los meses anteriores no cambian.`
      : modoDesde === 'inicio'
        ? 'Cuenta en todos los meses, también los anteriores. Usalo para un gasto que ya tenías y no habías cargado.'
        : esMesKey(otroDesde)
          ? otroDesde > mesActual
            ? `Programado: entra al total a partir de ${formatMesKey(otroDesde)}.`
            : `Cuenta desde ${formatMesKey(otroDesde)} (inclusive).`
          : 'Elegí el primer mes en que cuenta.';

  const id = (campo: string) => `${uid}-${campo}`;

  return (
    <form onSubmit={enviar} className="g-form" noValidate>
      <div className="g-campo c-5">
        <label htmlFor={id('nombre')}>Concepto</label>
        <input
          id={id('nombre')}
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
          placeholder="Ej. Supermercado"
          autoComplete="off"
          // Un alta abierta a propósito arranca por el nombre; con la lista vacía el form
          // ya está abierto al entrar y no tiene que robar el foco.
          autoFocus={!base && gastos.length > 0}
        />
      </div>
      <div className="g-campo c-3 mitad">
        <label htmlFor={id('monto')}>Monto</label>
        <input
          id={id('monto')}
          value={monto}
          onChange={(e) => setMonto(e.target.value)}
          placeholder="0"
          inputMode="decimal"
          autoComplete="off"
          // Al editar o cargar otro período, lo que casi siempre cambia es el monto.
          autoFocus={base != null}
        />
        {frecuencia === 'anual' && montoNum != null && montoNum > 0 && (
          <p className="g-ayuda">≈ {formatMoney(montoNum / 12, { currency: moneda })} por mes</p>
        )}
      </div>
      <div className="g-campo c-2 mitad">
        <label htmlFor={id('moneda')}>Moneda</label>
        <select id={id('moneda')} value={moneda} onChange={(e) => setMoneda(e.target.value as 'ARS' | 'USD')}>
          <option value="ARS">ARS</option>
          <option value="USD">USD</option>
        </select>
      </div>
      <div className="g-campo c-2">
        <label htmlFor={id('frecuencia')}>Frecuencia</label>
        <select id={id('frecuencia')} value={frecuencia} onChange={(e) => setFrecuencia(e.target.value as FrecuenciaGasto)}>
          <option value="mensual">Mensual</option>
          <option value="anual">Anual</option>
        </select>
      </div>

      <div className="g-campo c-5">
        <span className="g-etiqueta">
          <label htmlFor={id('categoria')}>Categoría</label>
          <InfoTip label="cada categoría">
            {CATEGORIAS.map((c) => (
              <span key={c} style={{ display: 'block', marginBottom: 6 }}>
                <strong style={{ color: 'var(--text)' }}>{c}:</strong> {descripcionCategoria(c)}
              </span>
            ))}
          </InfoTip>
        </span>
        <select id={id('categoria')} value={categoriaFinal} onChange={(e) => elegirCategoria(e.target.value)}>
          <option value="" disabled>Elegí una categoría</option>
          {CATEGORIAS.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        {categoriaVieja && <p className="g-ayuda">«{categoriaVieja}» ya no está en la lista: elegí una de estas.</p>}
        {!categoriaTocada && sugerencia && !editando && (
          <p className="g-ayuda">Sugerida {sugerencia.motivo}. Elegí otra para cambiarla.</p>
        )}
        {mostrarChip && (categoriaTocada || editando) && (
          <p className="g-ayuda">
            Sugerida: <strong>{sugerencia!.categoria}</strong> ({sugerencia!.motivo}){' '}
            <button
              type="button"
              className="g-btn chico"
              onClick={() => elegirCategoria(sugerencia!.categoria)}
            >Usar</button>
          </p>
        )}
      </div>

      <div className="g-campo c-4">
        <label htmlFor={id('desde')}>Cuenta desde</label>
        <select id={id('desde')} value={modoDesde} onChange={(e) => setModoDesde(e.target.value as ModoDesde)}>
          <option value="este-mes">Este mes ({formatMesKey(mesActual)})</option>
          <option value="inicio">Desde el inicio</option>
          <option value="otro">Otro mes…</option>
        </select>
        {modoDesde === 'otro' && (
          <input
            type="month"
            aria-label="Mes de inicio"
            value={otroDesde}
            onChange={(e) => setOtroDesde(e.target.value)}
          />
        )}
        <p className="g-ayuda">{ayudaDesde}</p>
      </div>

      <div className="g-campo c-3">
        <label htmlFor={id('hasta')}>Cuenta hasta</label>
        <select id={id('hasta')} value={conHasta ? 'mes' : 'sin'} onChange={(e) => setConHasta(e.target.value === 'mes')}>
          <option value="sin">Sin fecha de fin</option>
          <option value="mes">Hasta un mes…</option>
        </select>
        {conHasta && (
          <input
            type="month"
            aria-label="Último mes que cuenta"
            value={hasta}
            onChange={(e) => setHasta(e.target.value)}
          />
        )}
        {conHasta && (
          <p className="g-ayuda">
            Último mes que cuenta: {esMesKey(hasta) ? formatMesKey(hasta) : '…'}. Después deja de sumar.
          </p>
        )}
      </div>

      {afectaOtrosPeriodos && (
        <p className="g-ayuda aviso c-12" role="status">
          El nombre y la categoría cambian en todos los períodos de este gasto.
        </p>
      )}

      {solapados.length > 0 && (
        <div className="g-ayuda aviso c-12" role="status">
          <strong>Se superpone</strong> con otro período de «{nombre.trim()}»
          ({solapados.map((s) => `${s.desde ? formatMesKey(s.desde) : 'el inicio'} → ${s.hasta ? formatMesKey(s.hasta) : 'en adelante'}`).join(', ')}):
          en esos meses se suman los dos.
          {cortable ? (
            <label className="g-radio" style={{ marginTop: 6 }}>
              <input type="checkbox" checked={cortar} onChange={(e) => setCortar(e.target.checked)} />
              <span>Es un cambio: que el período anterior termine en {formatMesKey(mesAnterior(desdeEfectivo!))}</span>
            </label>
          ) : ' Si es un cambio de monto, cortá el período anterior.'}
        </div>
      )}

      {preguntarCambio && (
        <fieldset className="g-cambio c-12">
          <legend>Cambiaste el monto, la moneda o la frecuencia: ¿desde cuándo rige?</legend>
          <label className="g-radio">
            <input
              type="radio" name={id('cambio')} checked={modoCambio === 'desde-mes'}
              onChange={() => setModoCambio('desde-mes')}
            />
            <span>
              Rige desde un mes: los anteriores conservan el valor viejo
              {modoCambio === 'desde-mes' && (
                <input
                  type="month" aria-label="Mes desde el que rige el cambio" value={cambioMes}
                  onChange={(e) => setCambioMes(e.target.value)}
                />
              )}
            </span>
          </label>
          <label className="g-radio">
            <input
              type="radio" name={id('cambio')} checked={modoCambio === 'corregir'}
              onChange={() => setModoCambio('corregir')}
            />
            <span>Corregir: estaba mal cargado, vale para todos los meses</span>
          </label>
        </fieldset>
      )}

      {error && <p className="g-error c-12" role="alert">{error}</p>}

      <div className="g-acciones c-12">
        <button type="submit" className="g-btn primario" disabled={saving}>
          {saving ? 'Guardando…' : editando ? 'Guardar' : 'Agregar'}
        </button>
        {onCancel && (
          <button type="button" className="g-btn" onClick={onCancel} disabled={saving}>Cancelar</button>
        )}
        {editando && <span className="separador" />}
        {onOtroPeriodo && (
          <button type="button" className="g-btn" onClick={onOtroPeriodo} disabled={saving} title="Cargar el mismo gasto en otro período, con otro monto">
            Otro período
          </button>
        )}
        {onBaja && (
          <button type="button" className="g-btn" onClick={onBaja} disabled={saving} title="Deja de contar desde el mes que viene y queda en el historial">
            Dar de baja
          </button>
        )}
        {onEliminar && <ConfirmarEliminar onConfirmar={onEliminar} disabled={saving} />}
      </div>
    </form>
  );
}

/** Eliminar pide una segunda confirmación: borrar es definitivo y el catálogo se guarda entero. */
function ConfirmarEliminar({ onConfirmar, disabled }: { onConfirmar: () => void; disabled: boolean }) {
  const [pendiente, setPendiente] = useState(false);
  if (!pendiente) {
    return (
      <button type="button" className="g-btn peligro" onClick={() => setPendiente(true)} disabled={disabled}>
        Eliminar
      </button>
    );
  }
  return (
    <>
      <button type="button" className="g-btn peligro" onClick={onConfirmar} disabled={disabled}>
        Sí, eliminar
      </button>
      <button type="button" className="g-btn" onClick={() => setPendiente(false)} disabled={disabled}>
        No
      </button>
    </>
  );
}
