---
numero: 0019
titulo: Un rendimiento que la fuente no publica es `null`, no 0
estado: Aceptada
fecha: 2026-10-24
codigo: lib/fciCocos.ts, components/FciSection.tsx, lib/variacionSemanal.ts
---

# 0019 — Un rendimiento que la fuente no publica es `null`, no 0

## Contexto

La Planilla Diaria de CAFCI no publica todos los fondos al mismo día. Algunos
aparecen con la fecha del día hábil anterior y con **todas** las columnas de
comparación vacías a la vez: VCP previo, variación diaria, rendimiento del mes,
del año y de 12 meses. La fila trae solo VCP y patrimonio.

El parser leía esas celdas con una función que devolvía `0` para la celda vacía
(`if (!v) return 0`). El resultado en pantalla era un fondo con VCP válido y
variación diaria, mensual, anual y de 12 meses **exactamente 0,0%**.

Ese es el peor modo de falla posible para un dato financiero: es falso y a la vez
verosímil. Un 0,0% se lee como "el fondo no se movió", que para un fondo en
dólares de corto plazo es una afirmación plausible; nada en la UI distinguía eso
de "la fuente no lo informó". Y el mismo `0` se propagaba al mail de la alerta
semanal, que imprimía "día 0,00%", y a la tool del MCP, que le daba al modelo un
número para interpretar donde no había dato.

## Alternativas descartadas

- **Dejar 0 y aclararlo en una nota al pie** — el número sigue estando en la
  celda, y una tabla se lee por la celda, no por la nota. Además el 0 viaja al
  MCP y al mail, donde no hay nota al pie.
- **Reusar la fila del día anterior para completar las columnas** — la planilla es
  un snapshot, no una serie: no trae el VCP de dos días atrás. Habría que
  persistir snapshots propios, que es una fuente nueva con su propio estado.
- **Calcular los rendimientos contra un VCP histórico propio** — requiere guardar
  la serie; hoy no se guarda, y arrancar a acumularla no responde la pregunta
  de hoy (los primeros meses seguirían sin dato).
- **Pedir la serie a la API autenticada de CAFCI** (`api.cafci.org.ar/fondo/.../serie`)
  — devuelve 401 sin documentación de auth, igual que el resto de esa API. Es el
  mismo límite que ya documenta [0005](0005-parsear-cafci-con-zlib-nativo.md).
- **Omitir el fondo rezagado de la tabla** — es la posición más grande de la
  cartera en varios escenarios; esconderla es peor que mostrarla sin
  rendimientos, y además descuadraría el total de la pestaña.

## Decisión

Los cuatro rendimientos pasan de `number` a `number | null`, y el parser
distingue celda vacía de cero:

- `parseNumOpt()` devuelve `null` para `''`/ausente, y el número cuando hay dato.
  Un **0 que la planilla sí informa se conserva como 0** — "no se movió" es un
  dato y "no lo publicaron" es otro, y la diferencia tiene un test.
- `parseNum()` (con default 0) queda solo para VCP y patrimonio, que siempre vienen.
- Se agrega `rezagado: boolean`, comparando la fecha de la fila contra la fecha
  máxima de toda la planilla. Es lo que permite explicar *por qué* no hay dato en
  vez de solo omitirlo.

En la UI, `null` se muestra **"s/d"** en gris, el fondo lleva un chip con su fecha
de dato, y las filas sin dato ordenan al final en cualquier sentido de orden (son
ausencia de dato, no el valor más bajo). En el MCP el campo va en `null` con una
nota que le dice al modelo que `null` es "no informado", no 0%.

## Consecuencias y límites

- **Límite — no hay rendimiento real para el fondo rezagado, de ninguna fuente
  pública.** "s/d" no es un paso intermedio hacia el dato: mientras CAFCI publique
  esa fila sin columnas de comparación, no hay forma de completarla sin credenciales
  o sin acumular una serie propia. El dato aparece solo cuando la planilla se
  actualiza (típicamente el día hábil siguiente).
- **Límite — el rezago se infiere de la fecha máxima de la planilla**, no de un
  campo que CAFCI publique como tal. Si algún día la planilla entera saliera con
  una sola fecha vieja, ningún fondo quedaría marcado como rezagado aunque todos
  lo estuvieran.
- **Límite — `rezagado` y "sin rendimientos" son cosas distintas** aunque hoy
  coincidan: un fondo podría venir al día y sin alguna columna. Por eso la UI
  decide el "s/d" por el `null` de cada campo, no por el flag.
- Esto **no afecta** el rendimiento neto del Resumen, que se calcula con las
  valuaciones mensuales del Sheet y no con estas columnas.
- **Revisar si:** CAFCI empieza a publicar todos los fondos al mismo día (el flag
  queda inerte, no molesta), o si se decide persistir una serie propia de VCP — ahí
  los rendimientos del fondo rezagado pasarían a ser calculables y este ADR se
  reemplaza.
