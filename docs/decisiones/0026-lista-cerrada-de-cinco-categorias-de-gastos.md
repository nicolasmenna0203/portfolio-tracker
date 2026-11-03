---
numero: 0026
titulo: Agrupar los gastos en una lista cerrada de cinco categorías, por el fin del gasto
estado: Reemplazada por 0028
fecha: 2026-11-02
codigo: lib/gastosCategorias.ts, components/GastoForm.tsx, components/GastosSection.tsx, components/SugerenciasGastos.tsx
---

# 0026 — Agrupar los gastos en una lista cerrada de cinco categorías, por el fin del gasto

Reemplaza solo la parte de categorías de
[0025](0025-gastos-con-vigencia-por-mes.md); la vigencia por mes sigue igual.

## Contexto

Las categorías eran libres: el desplegable ofrecía las del usuario, unas pocas
base y "Otra…" para crear más. Con un catálogo chico, un reparto con muchas
categorías chicas no dice nada, y el criterio se mezclaba: "Servicios" juntaba
una factura de luz con una suscripción que se cancela con un click, y "Otros" se
llevaba lo difícil de clasificar.

## Alternativas descartadas

- **Seguir con categorías libres y sugerencias** — nada sostiene el tope: cada
  "Otra…" agranda la lista.
- **Agrupar por tipo de gasto (Seguros, Impuestos, Servicios)** — parte lo que
  cuesta un mismo fin: el seguro del auto quedaría lejos de la nafta.
- **Mantener "Otros" como una de las cinco** — no clasifica nada y termina
  absorbiendo lo que debería decidirse.
- **Rechazar en el servidor una categoría fuera de la lista** — el Sheet también se
  edita a mano, y descartar o fallar por una fila así es peor que mostrarla y
  sugerir a dónde moverla.
- **Traducir los nombres viejos solo al mostrarlos** — el Sheet es la fuente de
  verdad: quedaría distinto de lo que se ve.

## Decisión

Cinco categorías (`CATEGORIAS`), elegidas por criterio propio: **Súper y comida**,
**Transporte**, **Hogar**, **Suscripciones** y **Ocio y personal**. El criterio es
para qué es el gasto, no cómo se paga: un seguro va según lo que asegura.

La UI solo ofrece esas cinco, sin "Otra…" ni "Sin categoría", y el formulario exige
elegir una. Las que ya están en la lista no se renombran ni se fusionan.

El diccionario tiene un rubro por categoría y cada rubro viejo quedó dentro de uno.
"Súper y comida" incluye productos de reposición diaria (kiosco, limpieza,
perfumería).

Una fila con otra categoría no se pierde ni se reescribe sola: se muestra agrupada
como está, y la UI propone a cuál moverla (primero por el nombre del gasto, después
por el nombre de la categoría vieja) o deja mover el grupo entero.

## Consecuencias y límites

- **Límite — "Ocio y personal" es amplia.** Junta gastos opcionales con salud,
  educación e impuestos, que no lo son: no se puede leer como "lo que podría
  recortar".
- **Límite — editar una fila fuera de la lista obliga a elegir categoría**, aunque
  solo se quiera cambiar el monto.
- **Límite — mover varios gastos entre dos categorías de la lista** se hace de a
  uno: esa acción de grupo es solo para lo que está fuera de la lista.
- **Límite — las sugerencias son heurísticas de palabras**, igual que en 0025.
- **Revisar si:** "Ocio y personal" pasa a ser la categoría más grande del reparto
  (ya no informa y conviene partirla), o si el Sheet pasa a registrar gasto real por
  movimiento, donde hacen falta reglas de otro tipo.
