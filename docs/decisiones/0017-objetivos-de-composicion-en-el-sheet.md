---
numero: 0017
titulo: Mover los objetivos de composición de localStorage al Google Sheet
estado: Aceptada
fecha: 2026-08-08
codigo: lib/objetivos.ts, app/api/objetivos/route.ts, lib/dimensiones.ts, lib/useObjetivos.ts, components/RebalanceoTab.tsx, lib/agentTools.ts
---

# 0017 — Mover los objetivos de composición de localStorage al Google Sheet

## Contexto

La pestaña de Proyecciones permite fijar un porcentaje objetivo por categoría en
cinco dimensiones (tipo de activo, riesgo, moneda, tipo de renta, geografía) y los
compara contra la composición real. Estaban guardados en `localStorage` bajo la
clave `proyecciones_objetivos_v1`.

Eso los dejaba encerrados en un navegador: no se veían desde otro dispositivo, se
perdían al limpiar datos del sitio, y —lo que forzó el cambio— **el servidor MCP no
podía leerlos**. Corre como proceso Node, sin acceso al almacenamiento del browser.

El problema concreto: uno de los criterios de venta declarados del usuario es el
rebalanceo por peso ([PERFIL-INVERSOR.md](../../PERFIL-INVERSOR.md), fuera del
repo). El asesor respondía preguntas de rebalanceo sin poder leer el objetivo
contra el cual rebalancear, así que opinaba con una lectura genérica de la
distribución en vez de con el criterio del usuario.

## Alternativas descartadas

- **Dejarlos en `localStorage` y copiarlos a mano al perfil** — dos fuentes de
  verdad para el mismo dato, que hay que sincronizar manualmente. Se desincronizan
  al primer ajuste de un slider.
- **Guardarlos en `PERFIL-INVERSOR.md`** — el perfil es prosa de criterios, editada
  por humano; esto es una tabla de números que edita la UI. Además el dashboard
  desplegado en Vercel no puede leer un archivo local.
- **Una tabla propia (Postgres, KV de Vercel)** — resuelve el problema pero agrega
  una dependencia de infraestructura y credenciales para cinco docenas de números,
  cuando el Sheet ya es la fuente de verdad del resto y ya está autenticado.
- **Un archivo JSON en el repo** — el repo es público y, peor, Vercel tiene
  filesystem de solo lectura en runtime: no se podría guardar.

## Decisión

Los objetivos viven en una hoja `Objetivos` del mismo Google Sheet.

**Layout: un bloque de dos columnas por dimensión, lado a lado**, separados por
una columna vacía y con una fila `TOTAL` al pie de cada uno:

```
     A         B    C   D            E    F   G       H
1  TIPO        %        RIESGO       %        MONEDA  %
2  TIPO_A      nn       RIESGO_A     nn       MON_A   nn
3  TIPO_B      nn       RIESGO_B     nn       MON_B   nn
...
8  TOTAL      100       TOTAL       100       TOTAL  100
```

La primera versión usó tres columnas (`Dimension`, `Categoria`, `Porcentaje`) con
una fila por categoría. Se cambió porque en la práctica eran decenas de filas seguidas con
el nombre de la dimensión repetido en cada una: correcto como estructura de datos,
ilegible como planilla. El lector **acepta los dos formatos** y el viejo se migra
al nuevo en el primer guardado.

Detalles del layout que responden a un motivo:

- **El `TOTAL` se escribe como número, no como fórmula.** El parser tiene que poder
  distinguir esa fila y descartarla al leer, y una fórmula se rompería al reescribir
  el bloque con menos categorías. Sirve de control visual: si no da 100, la
  asignación está incompleta o excedida.
- **Las categorías se ordenan alfabéticamente.** El orden de inserción del objeto es
  arbitrario y hacía que las filas se movieran entre guardados sin que cambiara nada.
- **El `TOTAL` solo aparece bajo bloques con datos**, para no mostrar un "0" que
  parezca un objetivo fijado en cero.

- **`lib/objetivos.ts`** lee y escribe. Si la hoja no existe, `leerObjetivos()`
  devuelve la estructura vacía en vez de fallar (estado normal antes del primer
  guardado) y `guardarObjetivos()` la crea con `addSheet`.
- **`/api/objetivos`** expone GET y POST. El POST **normaliza antes de escribir**:
  descarta dimensiones desconocidas y porcentajes fuera de 0-100, para que basura
  del cliente no llegue al Sheet ni al cálculo de desvío.
- **La escritura es overwrite completo, no merge.** La UI siempre manda el set
  entero; mezclar dejaría categorías viejas colgadas al renombrar o eliminar una.
  Se limpia un rango holgado antes de escribir para no dejar filas residuales.
- **El componente persiste con debounce de 800 ms.** Los sliders emiten un cambio
  por paso: sin debounce sería una request al Sheet por pixel.
- **Migración automática:** en la primera carga, si el Sheet no tiene objetivos
  pero `localStorage` sí, se suben y se borra la copia local. Sin intervención del
  usuario y sin perder lo que ya había cargado.
- **`objetivos_composicion`** es la tool nueva del MCP: devuelve real vs objetivo
  con el desvío en puntos porcentuales y el ajuste en USD.

Las etiquetas de categoría y el filtrado de la tool **replican los de
`ProyeccionesTab.tsx`** —incluido que geografía se calcula solo sobre renta
variable—. Si no coincidieran, las categorías no cruzarían con los objetivos
guardados y el desvío sería inventado.

> **Actualización:** los objetivos ya no viven en Proyecciones. Pasaron a una vista
> propia de Tenencias y después se fusionaron con Variación en la vista
> Rebalanceo. Con la fusión, el etiquetado y el filtro de geografía se
> centralizaron en `lib/dimensiones.ts`, que usan la vista, `lib/useObjetivos.ts`
> y la tool del MCP: el límite de abajo sobre el criterio duplicado ya no aplica.

## Consecuencias y límites

- **Límite — el criterio de etiquetado está duplicado** entre `ProyeccionesTab.tsx`
  y `objetivosComposicion()` en `lib/agentTools.ts`. Es la fragilidad principal de
  esta decisión: si uno cambia y el otro no, los desvíos salen mal en silencio (una
  categoría sin match se muestra como "sin objetivo"). Es el mismo problema que
  [0012](0012-criterio-unico-de-tickers-elegibles.md) resolvió centralizando, y acá
  no se hizo porque el componente resuelve etiquetas con constantes de UI. **Si se
  toca uno, tocar el otro.**
- **Límite — no se valida que los porcentajes sumen 100.** Es deliberado: la UI
  permite guardar un set incompleto mientras se ajusta, y forzarlo perdería el
  trabajo en curso. La UI muestra la suma y avisa si excede.
- **Límite — sin bloqueo de concurrencia.** Dos pestañas editando a la vez: gana la
  última en escribir. Para un dashboard de un solo usuario es aceptable.
- **Límite — la migración desde `localStorage` corre una sola vez por navegador.**
  Si se edita en un browser sin conexión al Sheet, ese cambio no persiste.
- **Límite — un objetivo viejo es peor que ninguno.** Al persistir de verdad, los
  objetivos pueden quedar desactualizados y el asesor los va a tomar como vigentes.
- **Límite — la hoja se reescribe entera en cada guardado.** Formato manual
  (colores, anchos de columna, notas) sobrevive porque `values.clear` no lo toca,
  pero cualquier fórmula o columna extra que se agregue a mano dentro del rango
  `A1:Z200` se pierde. La hoja es salida del dashboard, no un espacio de trabajo.
- **Revisar si:** aparece una sexta dimensión (hay que tocar `DIMENSIONES`, la UI y
  el mapa de etiquetas de la tool); o si los desvíos empiezan a mostrar categorías
  sin objetivo que sí lo tienen, señal de que las etiquetas se desincronizaron.
