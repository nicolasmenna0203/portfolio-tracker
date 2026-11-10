---
numero: 0032
titulo: Fechar cada valuación al cierre de su mes en la TIR y en el TWR anualizado
estado: Aceptada
fecha: 2026-11-09
codigo: lib/twr.ts, lib/sheets.ts, lib/periodo.ts, lib/demo/dashboardData.ts
---

# 0032 — Fechar cada valuación al cierre de su mes en la TIR y en el TWR anualizado

## Contexto

La serie mensual (`ResumenRow`) se fecha el día 1 de cada mes (`fechaTs`),
pero su valor es la foto de tenencias del **cierre** del mes. El TWR ya lo
trataba así (`MesValuacion.total` es "valuación al cierre"), pero la TIR y las
anualizaciones no:

- la TIR fechaba el valor final **hoy**, aunque fuera la foto de un mes atrás:
  el plazo se estiraba con cada día sin carga nueva y la tasa bajaba sola;
- en los períodos acotados (1 mes, YTD, 12 meses) la base se fechaba el día 1
  del mes base. En "1 mes" la TIR se calculaba sobre unos 70 días en vez de 31;
- el TWR anualizado del KPI contaba los días desde el día 1 del primer mes
  hasta hoy, en lugar de entre el primer y el último cierre;
- un movimiento posterior a la última foto entraba en la TIR y en la ganancia
  del período, aunque todavía no estuviera en ninguna valuación.

## Alternativas descartadas

- **Fechar el valor final hoy** (lo que había) — solo es correcto si el valor
  final es una valuación de hoy, y no lo es: es la última foto del Sheet.
- **Valuar la cartera a precios de hoy para el flujo terminal** — haría
  correcto fechar "hoy", pero exige precio vivo para cada posición (FCI, bonos
  sin cotización, cripto) y duplica la lógica de valuación que hoy vive en la
  carga mensual.
- **Usar la fecha exacta de la foto de cada mes** — más precisa si una foto
  no fuera de fin de mes, pero las fotos son de fin de mes y el TWR (Modified
  Dietz por mes calendario) ya asume eso. Tener dos convenciones distintas
  haría que TIR y TWR midan plazos distintos.

## Decisión

`instanteValuacion(fechaTs, ahora)` en `lib/twr.ts` devuelve el último
milisegundo del mes de la fila, o `ahora` si el mes todavía no terminó. Con
eso:

- la TIR (KPI y períodos) fecha el valor final al cierre del último mes y la
  base del período, al cierre del mes base;
- solo entran los movimientos hasta ese cierre, en la TIR y en la ganancia;
- el TWR anualizado cuenta los días entre el cierre del primer mes del tramo y
  el del último.

De paso, la TIR de los períodos pasa a contar los movimientos internos como
flujo, igual que el KPI y el TWR: es lo que ya decía el ADR 0022 (la
clasificación solo cambia la ganancia), y el código de `lib/periodo.ts` lo
contradecía.

## Consecuencias y límites

- **Límite:** un aporte hecho después de la última foto no se refleja en la
  TIR ni en la ganancia hasta que se carga el mes. Es lo correcto (todavía no
  hay valuación que lo contenga), pero el KPI "no se mueve" con ese aporte.
- **Límite:** las TIR anualizadas de períodos cortos cambiaron mucho respecto
  de lo que se mostraba antes. Los valores anteriores estaban mal, pero
  cualquier comparación contra capturas viejas no sirve.
- **Revisar si:** se empieza a cargar una foto que no es de fin de mes (por
  ejemplo, una carga a mitad de mes del mes en curso): ahí convendría fechar
  cada valuación con la fecha real de la foto, en la TIR y en el TWR a la vez.
