---
numero: 0025
titulo: Dar a cada gasto una vigencia en meses (desde / hasta) en vez de un catálogo sin fecha
estado: Aceptada
fecha: 2026-11-01
codigo: lib/finanzasPersonales.ts, lib/gastosFijos.ts, lib/gastosEdicion.ts, lib/gastosCategorias.ts, components/GastosSection.tsx, components/GastoForm.tsx
---

# 0025 — Dar a cada gasto una vigencia en meses (desde / hasta) en vez de un catálogo sin fecha

## Contexto

Los gastos eran un catálogo: una fila por gasto, sin fecha, aplicado por igual a
todos los meses del historial ([0023](0023-tasa-de-cartera-para-proyecciones.md)).
Eso tenía tres consecuencias malas. Cargar un gasto nuevo se restaba también de
los meses en que no existía y achicaba el "sin asignar" del pasado. Un aumento de
alquiler reescribía el historial, porque editar el monto no distinguía entre
"estaba mal cargado" y "subió en marzo". Y no había forma de dar de baja una
suscripción sin borrarla (y borrarla la sacaba de los meses en que sí se pagó).
Además el guardado limpiaba la hoja antes de escribirla: un error de red entre
los dos pasos dejaba el catálogo vacío.

## Alternativas descartadas

- **Seguir con el catálogo sin fecha** — es lo que causaba los tres problemas.
- **Gasto real por movimiento (una fila por pago, con fecha y monto, como Ingresos)** —
  es lo correcto contablemente y daría un ahorro medido por el lado del gasto, pero
  exige cargar cada mes. El valor del catálogo es cargarlo una vez y que siga
  valiendo; si hay que cargar cada pago, el hábito se corta y el catálogo vuelve a
  quedar incompleto. Se mantiene como el camino a seguir si algún día se quiere
  gasto real (ver "Revisar si").
- **Alta "desde siempre" por defecto** — contaría el gasto en meses anteriores a
  que existiera. Es una opción explícita del formulario ("Desde el inicio") para
  el gasto que ya se tenía y no se había cargado, no el default.
- **Hoja aparte con el historial de versiones de cada gasto** — resuelve los
  aumentos, pero duplica el esquema y obliga a mantener dos hojas coherentes. Con
  `Desde`/`Hasta` en la misma fila, un cambio de monto son dos filas y nada más.
- **Anuales concentrados en el mes de pago** — exigiría guardar el mes de cobro y
  haría el gasto de ese mes mucho mayor al resto. Se mantiene el prorrateo /12
  de siempre: es una estimación mensual, no un flujo de caja.
- **Sugerir categorías con un modelo** — necesita credenciales, no funciona en la
  demo y la misma entrada puede dar sugerencias distintas. Un diccionario de
  rubros comunes más el historial del propio usuario alcanza y es predecible.
- **Aplicar la sugerencia de categoría sin preguntar** — las categorías son del
  usuario. Solo se propone; cada sugerencia se acepta con un botón.

## Decisión

**Vigencia.** `GastoFijo` suma `desde` y `hasta` ("YYYY-MM", ambos inclusivos y
opcionales), en las columnas `Desde` y `Hasta` de la hoja `GastosFijos`. Sin
`desde` el gasto cuenta desde siempre: es lo que significaban las filas
anteriores, que no cambian de comportamiento. Un alta nueva arranca en el mes en
curso salvo que se elija otra cosa.

**Qué cuenta en cada mes.** `gastoVigenteEn` decide si un gasto suma en un mes.
`resumenFlujo` calcula, para cada mes de la ventana, el total de los gastos
vigentes en ese mes y promedia: el gasto del resumen es ese promedio, igual que el
ingreso y el aporte. Así `gastos + sin asignar + aporte = ingreso` se sigue
cumpliendo. La pestaña Gastos muestra, en cambio, lo vigente en el mes en curso.

**Cambios de monto.** `editarGasto` con un mes de cambio parte la fila: el tramo
viejo termina el mes anterior y el nuevo empieza ahí. Sin mes de cambio es una
corrección y vale para todos los meses. Nombre y categoría son del concepto y
quedan iguales en los dos tramos.

**Baja.** "Dar de baja" fija `hasta` en el mes en curso (último mes que cuenta);
el gasto sigue en los meses en que estuvo vigente y pasa a "Dados de baja" al mes
siguiente. Eliminar queda para lo cargado por error, con doble confirmación.

**Guardado.** `guardarGastosFijos` escribe primero y limpia después lo que sobra
debajo, sin tope fijo de filas. La UI actualiza la lista de inmediato y vuelve a
la anterior si el servidor falla. La lectura acepta que Sheets convierta `Desde` y
`Hasta` en fecha si alguien las edita a mano (`YYYY-MM-DD`, `DD/MM/YYYY`,
`MM/YYYY`) y descarta lo que no entiende en vez de inventar un mes.

**Categorías.** `lib/gastosCategorias.ts`: el historial del usuario manda (un
gasto parecido a uno ya clasificado hereda su categoría), el diccionario genérico
va después y se mapea a la categoría equivalente que el usuario ya tenga. Lo que
está en "Otros" o "Sin categoría" no enseña nada. También detecta categorías que
son la misma escrita distinto y gastos genéricos con una mejor opción. El
diccionario es de rubros comunes (origen: criterio propio, no un dato oficial);
el orden de los rubros importa y está explicado en el código.

## Consecuencias y límites

- **Límite — dos números de gasto.** El KPI "Gastos" de la franja de arriba es el
  promedio de los meses cerrados; el "Total mensual" de la pestaña Gastos es el
  del mes en curso. Con el catálogo uniforme coinciden, con altas y bajas recientes
  no. La UI lo aclara en los tooltips.
- **Límite — MEP actual para todos los meses.** La vigencia ordena *cuándo* cuenta
  un gasto, pero un gasto en otra moneda sigue convirtiéndose con el MEP de hoy
  (ver [0007](0007-mep-mensual-no-mep-unico.md) para el caso con fecha de
  movimiento). Un gasto en pesos mostrado en dólares aparece como el mismo monto
  en todos los meses.
- **Límite — la baja a mitad de mes cuenta el mes entero.** La granularidad es el
  mes.
- **Límite — reactivar rellena el hueco.** Sacarle el `hasta` a un gasto dado de
  baja lo vuelve a contar también en los meses intermedios. Si hubo una pausa real,
  se carga como un gasto nuevo.
- **Límite — cada tramo de un cambio de monto es una fila**, así que el mismo
  nombre aparece en la lista activa y en "Dados de baja".
- **Límite — overwrite completo sin control de concurrencia.** Dos pestañas
  abiertas con la lista vieja se pisan. Es el mismo esquema que Objetivos
  ([0017](0017-objetivos-de-composicion-en-el-sheet.md)).
- **Límite — las sugerencias son heurísticas de palabras** para gasto cotidiano en
  Argentina. No entienden contexto: "Club" puede ser deporte o una membresía.
- **Revisar si:** el Sheet pasa a registrar gasto real por movimiento (ahí la
  vigencia sobra y el ahorro puede medirse por el lado del gasto); o si se
  necesita convertir cada mes con su MEP, lo que obligaría a decidir qué cotización
  le corresponde a un gasto estimado.
