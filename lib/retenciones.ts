// Decisión y alternativas descartadas: docs/decisiones/0002-retenciones-excluir-comision-depositario.md
//
// Retenciones sobre el cobro de dividendos, para estimar lo que realmente se
// acredita en la cuenta comitente en vez del monto bruto que declara el emisor.

/**
 * Withholding tax de EE.UU. sobre dividendos a no residentes.
 * Argentina no tiene tratado de doble imposición vigente con EE.UU., así que
 * aplica la tasa plena del 30% (no la reducida del 15%). Se descuenta en origen.
 */
export const RETENCION_USA = 0.30;

/** Impuesto a los débitos y créditos sobre la acreditación en cuenta. */
export const IMPUESTO_CHEQUE = 0.006;

/**
 * Fracción del dividendo bruto que efectivamente se acredita: 0.694.
 *
 * Deliberadamente NO incluye la comisión del depositario (Comafi), que ronda el
 * 1-2% pero varía por CEDEAR y por evento y no tiene fuente pública confiable.
 * Se prefiere sobreestimar levemente antes que inventar un número — mismo
 * criterio que el mapeo de bonos en `bonosArg.ts`.
 *
 * Solo aplica a dividendos de acciones/ETFs USA (incluidos vía CEDEAR). La renta
 * y amortización de bonos ARG no tienen retención de origen y se dejan al 100%.
 */
export const FACTOR_NETO_DIVIDENDO = (1 - RETENCION_USA) * (1 - IMPUESTO_CHEQUE);

/** Convierte un dividendo bruto en el neto estimado a acreditar. */
export function netoDividendo(bruto: number): number {
  return bruto * FACTOR_NETO_DIVIDENDO;
}
