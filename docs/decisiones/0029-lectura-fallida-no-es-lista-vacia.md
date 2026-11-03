---
numero: 0029
titulo: Tratar una lectura fallida del Sheet como error, no como lista vacía, en las hojas que se reescriben enteras
estado: Aceptada
fecha: 2026-11-02
codigo: lib/sheets.ts, lib/gastosFijos.ts, lib/objetivos.ts, lib/ratiosGuardados.ts, components/GastosSection.tsx, lib/useObjetivos.ts, components/RatiosTab.tsx
---

# 0029 — Tratar una lectura fallida del Sheet como error, no como lista vacía, en las hojas que se reescriben enteras

Completa [0017](0017-objetivos-de-composicion-en-el-sheet.md), que sigue vigente salvo
en dos detalles: la escritura ya no limpia antes de escribir, y sin conexión al Sheet
la sección de objetivos ya no se puede editar.

## Contexto

`GastosFijos`, `Objetivos` y `Ratios` se guardan con overwrite completo: la UI manda
todo y la hoja se reemplaza. Las tres leían con un `catch` que devolvía vacío ante
cualquier error, para cubrir la hoja que todavía no existe. Pero un error de red, de
cuota o de credenciales daba lo mismo, y la UI no podía distinguirlo: mostraba una
lista vacía editable y el siguiente guardado borraba lo que había. En objetivos ni
hacía falta una lista vacía: los sliders arrancaban en los valores por defecto y el
primer cambio los guardaba encima de los reales.

Objetivos y ratios además limpiaban antes de escribir: si el segundo paso fallaba,
la hoja quedaba vacía. Y un POST con el cuerpo mal armado se normalizaba a vacío y
también vaciaba la hoja.

## Alternativas descartadas

- **Crear la hoja al leer, y tratar todo error como error** — elimina el caso especial,
  pero un GET pasaría a escribir en el Sheet.
- **Guardar por fila en vez de reemplazar la hoja** — evita pisar lo que no se leyó,
  pero las filas no tienen id y el Sheet también se edita a mano: habría que migrar el
  esquema para resolver algo que alcanza con no guardar a ciegas.
- **Copia de respaldo antes de cada guardado** — permite recuperarse, pero no evita el
  error, duplica escrituras y agrega una hoja más para mantener.
- **Dejar editar con la lista en memoria y guardar cuando vuelva la conexión** — era lo
  que hacía objetivos. Justamente ese guardado posterior es el que pisa los datos.

## Decisión

**Lectura.** Solo la respuesta de Sheets para una hoja inexistente ("Unable to parse
range", `esHojaInexistente`, verificada contra la API real) equivale a vacío. Cualquier
otro error se propaga y la ruta responde 500.

**UI.** Si la lista no se pudo leer, no se puede guardar, y hay un "Reintentar". Gastos
no muestra nada editable, objetivos desactiva los sliders y ratios desactiva guardar
(también mientras la lista carga), porque el análisis de ratios funciona sin ella.

**Escritura.** Primero se escribe y después se limpia lo que sobra por debajo. Si la
escritura falla, la hoja queda como estaba.

**POST.** Sin el campo esperado, la ruta responde 400 en vez de normalizarlo a vacío.

## Consecuencias y límites

- **Límite — el mensaje de Google es un texto, no un código.** Si cambia, una hoja
  inexistente pasa a verse como error y hay que crearla a mano. Falla del lado seguro:
  no se pierde nada.
- **Límite — las tools del MCP que leen objetivos y ratios ahora fallan** ante un error
  del Sheet, en vez de responder como si no hubiera nada guardado. Es lo correcto para
  el asesor: "sin objetivos" sería un dato falso.
- **Límite — sigue sin haber bloqueo de concurrencia.** Dos pestañas abiertas: gana la
  última en guardar, y la lista que tiene en memoria puede estar vieja.
- **Límite — una fila que el parser descarta al leer** (un monto escrito a mano que no
  se entiende, por ejemplo) se pierde en el siguiente guardado.
- **Límite — falla en el medio de la escritura:** si la limpieza del final no se
  completa, quedan filas viejas debajo de las nuevas hasta el próximo guardado. Es
  molesto pero visible, y no pierde datos.
- **Revisar si:** alguna de estas hojas pasa a guardarse por fila, o aparece otra hoja
  con overwrite completo, que tiene que seguir estas mismas reglas.
