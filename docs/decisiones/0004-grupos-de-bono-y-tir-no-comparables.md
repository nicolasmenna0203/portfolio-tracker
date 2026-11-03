---
numero: 0004
titulo: Agrupar los bonos por tipo de tasa y tratar las TIR como no comparables entre grupos
estado: Aceptada
fecha: 2026-08-06
codigo: lib/bondMetrics.ts, lib/performance.ts, lib/agentTools.ts
---

# 0004 — Agrupar los bonos por tipo de tasa y tratar las TIR como no comparables entre grupos

## Contexto

La tabla de renta fija muestra TIR de instrumentos heterogéneos: hard-dollar,
ajustados por CER, tasa fija en pesos, dollar-linked y BOPREAL. Ordenar esa tabla
por TIR y leer la de arriba como "el bono que más rinde" es un error de
interpretación grave: una TIR del 10% sobre CER es un rendimiento **real** (sobre
inflación) y una del 35% en pesos es **nominal**. No están en la misma unidad
económica, aunque las dos se impriman como un porcentaje anual.

El riesgo no es teórico: la tabla, el ponderado de cartera y el MCP consumen todos
el mismo campo `tir`, y un modelo de lenguaje al que se le pasa una lista de
números va a compararlos salvo que se le diga explícitamente que no puede.

## Alternativas descartadas

- **Mostrar la TIR sin agrupar** — es lo que hace la fuente, y es exactamente lo
  que produce la comparación inválida.
- **Convertir todo a una unidad común** (por ejemplo, todo a rendimiento real
  esperado en USD) — requiere proyectar inflación y devaluación futuras. Sería
  inventar el supuesto más importante del cálculo y esconderlo dentro de un número
  que se presenta como dato.
- **Mostrar solo un grupo** — resuelve la ambigüedad perdiendo la mayor parte de la
  cartera de renta fija.

## Decisión

Cada bono se clasifica en un grupo cerrado:

```ts
type GrupoBono = 'USD' | 'CER' | 'ARS_TASA' | 'DOLLAR_LINKED' | 'BOPREAL' | 'ONS_USD'
```

`ONS_USD` (obligaciones negociables corporativas hard-dollar: YPF, Pampa, Vista,
Tecpetrol...) se agregó después, siguiendo esta misma regla — cotizan en las
mismas especies hard-dollar/dollar-linked que la deuda soberana (`index` "USS"/
"USDL" en bonistas.com), pero son otro emisor y otro riesgo de crédito, así que
no entran al grupo `USD` aunque la moneda y el índice coincidan.

Los ponderados (TIR y duration de cartera) se calculan **por grupo**, nunca sobre
el total. Cuando el grupo solo no alcanza para describir el instrumento se agrega
una `etiqueta` (por ejemplo, un dual CER/TAMAR, o un provincial dentro de
`ARS_TASA`).

La regla se propaga a los tres consumidores: la UI agrupa la tabla, `performance.ts`
agrega por grupo, y el `SYSTEM_PROMPT` de `lib/agentTools.ts` se lo dice al modelo
con esas palabras — "una TIR de un bono CER contra una de un hard-dollar no dice
nada".

También se descartan los campos `tir_up_N` / `tir_down_N` que publica la fuente
(sensibilidad a shocks de precio): no documentan su fórmula y los valores no cuadran
ni como TIR resultante absoluta ni como delta sobre la TIR base, al contrastarlos
con la aproximación estándar. La sensibilidad se calcula en su lugar en
`lib/performance.ts` → [0006](0006-sensibilidad-sin-convexidad.md).

## Consecuencias y límites

- **Límite — no hay un único "rendimiento de la renta fija".** Cualquier feature
  que quiera un número solo para toda la renta fija está pidiendo algo que este
  modelo de datos no puede dar honestamente.
- **Límite — dentro de un grupo la comparación sigue teniendo supuestos.** Los
  bonos de tasa variable de `ARS_TASA` proyectan la tasa actual como constante
  → [0001](0001-tir-duration-propias-bonos-provinciales.md).
- **Límite — el grupo se asigna por reglas sobre los datos de la fuente.** Un
  instrumento nuevo con estructura inusual puede caer en el grupo equivocado sin
  que nada avise.
- **Revisar si:** aparece una clase de instrumento que no encaja en los seis
  grupos actuales (ahí se agrega uno más, no se fuerza dentro de otro — es lo
  que ya pasó con `ONS_USD`); o si se agrega una vista que necesite comparar
  entre grupos, que requeriría decidir y documentar el supuesto de conversión.
