---
numero: 0002
titulo: Excluir la comisión del depositario del neto de dividendos
estado: Aceptada
fecha: 2026-08-06
codigo: lib/retenciones.ts
---

# 0002 — Excluir la comisión del depositario del neto de dividendos

## Contexto

El calendario de cobros y la alerta semanal muestran cuánto se va a acreditar por
dividendos. El monto bruto que declara el emisor no sirve: entre el bruto y lo que
llega a la cuenta hay varios descuentos. Dos son de régimen general y tienen tasa
conocida; el tercero, la comisión del depositario local que administra los CEDEARs,
ronda el 1-2% pero varía por CEDEAR y por evento, y no tiene fuente pública
confiable.

## Alternativas descartadas

- **Mostrar el bruto** — es el número que publica cualquier screener, pero
  sobreestima el cobro en más del 30%: inservible para planificar.
- **Estimar la comisión del depositario con un promedio** (p. ej. 1,5%) — inventa
  precisión que no existe. El error sería invisible y quedaría propagado en el
  calendario, la alerta y las respuestas del MCP.
- **Pedir el neto real al broker** — no hay endpoint público; requiere login.

## Decisión

Se descuentan solo los dos componentes con tasa conocida y verificable:

```
FACTOR_NETO_DIVIDENDO = (1 - 0.30) * (1 - 0.006) = 0.694
```

- **30% de withholding de EE.UU.** sobre dividendos a no residentes. Es la tasa
  plena, no la reducida del 15%, porque Argentina no tiene tratado de doble
  imposición vigente con EE.UU. Se descuenta en origen.
- **0,6% de impuesto a los débitos y créditos** sobre la acreditación en cuenta.

La comisión del depositario se **omite deliberadamente**: se prefiere sobreestimar
levemente el cobro antes que inventar un número. Mismo criterio que el mapeo de
bonos en `lib/bonosArg.ts`.

Solo aplica a dividendos de acciones y ETFs de EE.UU. (incluidos los que se cobran
vía CEDEAR). La renta y amortización de bonos argentinos no tienen retención de
origen y van al 100%.

## Consecuencias y límites

- **Límite — el neto real puede ser 1-2% menor** que el que muestra el dashboard.
  El sesgo es siempre en la misma dirección (optimista), nunca al revés.
- **Límite — el yield que se muestra es bruto y el cobro estimado es neto.** Son
  inconsistentes a propósito: el yield así se compara contra cualquier screener.
  Está advertido en el `SYSTEM_PROMPT` para que el modelo no los mezcle en la
  misma frase sin aclarar.
- **Límite — la tasa del 30% deja de valer** si alguna vez entra en vigencia un
  tratado con EE.UU., o si el instrumento no es estadounidense.
- **Revisar si:** entra en vigencia un tratado de doble imposición con EE.UU.;
  cambia la tasa del impuesto a los débitos y créditos; o aparece una fuente
  confiable de la comisión del depositario por CEDEAR (ahí conviene sumarla y
  cerrar el sesgo).
