---
numero: 0028
titulo: Agrupar los gastos en cuatro categorías, sumando las suscripciones a Ocio y personal
estado: Aceptada
fecha: 2026-11-02
codigo: lib/gastosCategorias.ts, components/GastoForm.tsx, components/GastosSection.tsx, components/SugerenciasGastos.tsx
---

# 0028 — Agrupar los gastos en cuatro categorías, sumando las suscripciones a Ocio y personal

Reemplaza a [0026](0026-lista-cerrada-de-cinco-categorias-de-gastos.md). Sigue
siendo una lista cerrada y el resto de esa decisión no cambia: la UI solo ofrece
las de la lista, y una fila con otra categoría se muestra como está y se propone a
cuál moverla.

## Contexto

0026 definió el criterio "para qué es el gasto, no cómo se paga", pero
"Suscripciones" se define justamente por cómo se paga. Casi todo lo que caía ahí
tiene otro lugar natural: streaming y gimnasio son ocio o gasto personal, e internet
y celular ya iban a Hogar. Además, en este catálogo todos los gastos son mensuales y
recurrentes, así que "recurrente" no distingue nada.

## Alternativas descartadas

- **Dejar "Suscripciones" aparte** — conserva el total de cobros recurrentes
  cancelables, pero contradice el criterio de la lista y obliga a decidir entre dos
  categorías para cada gasto de ocio que se paga por mes.
- **Sacar también "Hogar" si queda vacía** — con tres categorías casi no se separa
  nada, y una vacía no molesta: la pestaña solo muestra las que tienen gastos.
- **Migrar el Sheet automáticamente al leerlo** — el Sheet es la fuente de verdad y
  una lectura no tiene por qué reescribirlo. Las filas viejas siguen el camino de
  0026: se muestran y se sugiere moverlas.
- **Explicar las categorías con texto fijo en pantalla** — es ayuda que se necesita
  pocas veces y ocuparía lugar siempre. Va en un ⓘ junto a cada categoría y junto al
  campo del formulario.

## Decisión

Cuatro categorías (`CATEGORIAS`), elegidas por criterio propio: **Súper y comida**,
**Transporte**, **Hogar** y **Ocio y personal**. Las palabras clave y los alias de
"Suscripciones" pasan a "Ocio y personal", así que las filas con esa categoría vieja
reciben la sugerencia de moverse ahí.

Cada categoría tiene una descripción (`descripcionCategoria`) que la UI muestra como
ayuda, y un color fijo: si dependiera del orden, una categoría cambiaría de color al
aparecer o desaparecer otra.

## Consecuencias y límites

- **Límite — "Ocio y personal" es todavía más amplia.** A lo que ya advertía 0026
  (junta lo opcional con salud, educación e impuestos) se suman las suscripciones. No
  se puede leer como "lo que podría recortar".
- **Límite — no hay un total de suscripciones.** Para sumarlas hay que mirar los
  gastos uno por uno.
- **Límite — heredados de 0026:** editar una fila fuera de la lista obliga a elegir
  categoría, mover varios gastos entre dos categorías de la lista se hace de a uno, y
  las sugerencias son heurísticas de palabras.
- **Revisar si:** "Ocio y personal" pasa a ser la categoría más grande del reparto (ya
  no informa y conviene partirla), o si el Sheet pasa a registrar gasto real por
  movimiento, donde hacen falta reglas de otro tipo.
