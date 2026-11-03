---
numero: 0027
titulo: Mostrar los períodos de un mismo gasto como un solo concepto con su línea de tiempo
estado: Aceptada
fecha: 2026-11-02
codigo: lib/gastosEdicion.ts, components/GastosSection.tsx, components/GastoForm.tsx
---

# 0027 — Mostrar los períodos de un mismo gasto como un solo concepto con su línea de tiempo

Completa [0025](0025-gastos-con-vigencia-por-mes.md): la vigencia por mes y el
esquema del Sheet no cambian. Resuelve el límite que 0025 dejó anotado ("cada
tramo de un cambio de monto es una fila, así que el mismo nombre aparece en la
lista activa y en Dados de baja").

## Contexto

Un gasto puede variar en el tiempo: un aumento de monto, o un corte y una vuelta.
Con 0025 eso ya se guardaba bien (una fila por período con `Desde` y `Hasta`),
pero la UI mostraba cada fila por separado: el período viejo de un aumento
aparecía como "dado de baja" aunque el gasto siguiera vigente, el alta no
permitía cargar el fin, y no había forma de ver ni cargar directamente otro
período.

## Alternativas descartadas

- **Una hoja aparte con las versiones de cada gasto** — ya descartada en 0025:
  duplica el esquema. Con las filas del Sheet alcanza si la UI las agrupa.
- **Una columna `Concepto` o un id que ate las filas** — obliga a migrar el Sheet
  y se desincroniza si se edita a mano. El nombre y la categoría ya identifican
  al gasto.
- **Bloquear los períodos que se superponen** — dos filas con el mismo nombre
  pueden ser legítimas, y el Sheet también se edita a mano. Se avisa, no se impide.
- **Cortar solo el período anterior al cargar uno nuevo** — ya existe para el caso
  más común (editar el monto con "desde cuándo rige"); hacerlo sin preguntar en el
  alta escondería un cambio en una fila que el usuario no estaba editando. Por eso es
  una opción que se tilda.
- **Editar nombre y categoría fila por fila** — cada período quedaría libre, pero
  corregir uno solo lo separaría en otro gasto sin aviso.

## Decisión

**Concepto.** `agruparPorConcepto` junta las filas con el mismo nombre (sin tildes
ni mayúsculas) y la misma categoría. Un concepto está **activo** si algún período
cuenta en el mes en curso, **programado** si no pero hay uno que arranca después,
y **de baja** solo si todos terminaron. La fila que lo representa es el período
vigente (si no hay, el próximo programado; si no, el último).

**UI.** La pestaña muestra un renglón por concepto, con la chip "N períodos" que
despliega la línea de tiempo (inicio → fin y monto de cada uno, con el actual
marcado). Cada período se edita por separado en lo suyo (monto, moneda, frecuencia,
fechas); el nombre y la categoría son del concepto, así que editarlos en un período
los cambia en todos y el formulario lo avisa. Las sugerencias de categoría también
mueven el concepto entero. Los totales siguen sumando las filas vigentes en el mes,
así que no cambian.

**Alta.** El formulario pide también el fin ("Cuenta hasta") en el alta, no solo
al editar. "Otro período" (desde la edición o desde la línea de tiempo) abre el
alta con concepto, monto y categoría precargados; si el gasto ya había terminado,
arranca el mes siguiente a su fin.

**Superposición.** Si los meses del período que se carga coinciden con otro del
mismo concepto, el formulario avisa que en esos meses se suman los dos, sin
impedirlo. En el alta ofrece además cortar el anterior el mes previo al nuevo, salvo
que eso pierda meses: si el nuevo arranca antes que el otro, o termina antes y deja
sin gasto los meses siguientes (un precio temporal).

## Consecuencias y límites

- **Límite — el concepto es nombre + categoría.** Editar el Sheet a mano y cambiar
  esos datos en una sola fila la separa en otro concepto. Y como el concepto no tiene
  id, dos gastos distintos con el mismo nombre y categoría se ven como uno solo, y
  renombrar uno renombra el otro.
- **Límite — un hueco entre períodos cuenta como pausa**: los meses sin fila
  vigente no suman nada, y el concepto figura "programado" hasta que arranca el
  siguiente.
- **Revisar si:** el Sheet pasa a registrar gasto real por movimiento (los
  períodos dejan de hacer falta), o si aparecen gastos distintos con el mismo
  nombre y categoría que haya que mantener separados.
