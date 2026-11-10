---
numero: 0031
titulo: Mostrar los pagos de bonos ya ocurridos con la ficha de bonistas y un registro propio en el Sheet
estado: Aceptada
fecha: 2026-11-09
codigo: lib/bonosArg.ts, lib/pagosBonos.ts, lib/calendario.ts, app/api/alertas/semanal/route.ts
---

# 0031 — Mostrar los pagos de bonos ya ocurridos con la ficha de bonistas y un registro propio en el Sheet

## Contexto

El calendario sacaba la renta y la amortización de bonos ARG de
`bonistas.com/proximos-pagos`, que solo publica pagos futuros: un pago
desaparecía del calendario apenas ocurría, mientras que los dividendos sí
quedaban (Yahoo da 5 años de historia). La ficha de cada bono en bonistas
(`/bono-cotizacion-rendimiento-precio-hoy/<símbolo>`) embebe en
`bondData.flow_past` los pagos ya ocurridos, pero solo los **últimos 4**, sin
moneda, y cuando el bono vence la URL redirige a la home: un bono vencido no
deja rastro en ninguna página pública de bonistas.

## Alternativas descartadas

- **Solo la ficha (`flow_past`)** — recupera lo reciente sin estado propio, pero
  pierde todo lo anterior a los últimos 4 pagos y la historia entera de un bono
  vencido, que es justo el caso en que el último pago (la amortización final)
  es el más grande.
- **Solo un registro propio** — conserva todo de acá en adelante, pero no
  recupera nada de lo ya ocurrido antes de activarlo.
- **Reconstruir el cronograma desde las condiciones de emisión** (como
  `BonosCalculoPropio`, ADR 0001) — da la historia completa, pero hay que cargar
  y mantener a mano las condiciones de cada bono, y los cupones CER, TAMAR y
  Badlar dependen de índices que habría que traer aparte.
- **Registrar desde la ruta del calendario en cada visita** — más frecuente que
  el cron, pero convierte una lectura en escritura, corre también en la demo y
  depende de que alguien abra la pestaña antes de que el bono venza.
- **Ruta propia para el registro** — más limpia de reintentar, pero obliga a
  abrir otra ruta pública en `middleware.ts` para el mismo cron.

## Decisión

Las tres fuentes se combinan en `fetchBonosArg`, con esta precedencia por
ticker + fecha: proximos-pagos (dato vivo, para lo que no pasó) > hoja
`PagosBonos` > `flow_past` de la ficha. Las fichas solo se piden si el rango
incluye días anteriores a hoy.

El job semanal (`/api/alertas/semanal`) anota en `PagosBonos` los pagos de los
bonos de la cartera entre **14 días atrás y 10 días adelante**, con el cobro
estimado ese día. Los márgenes son arbitrarios con una condición: los dos
superan los 7 días entre corridas, para que una corrida fallida no deje huecos.
Hacia adelante hace falta porque el último pago de un bono hay que anotarlo
antes de su fecha; después ya no se publica en ningún lado.

La hoja solo se agrega, nunca se reescribe: el primer registro de un pago gana,
y si la lectura previa falla no se escribe nada (ADR 0029).

La moneda se normaliza a `USD` / `ARS`: proximos-pagos distingue "USD MEP" de
"USD CABLE" y la ficha no trae moneda (se deduce de la familia del bono).

## Consecuencias y límites

- **Límite:** un pago que vino de la ficha se estima con la tenencia y el precio
  de hoy, igual que los dividendos pasados. Si el bono se compró después de ese
  pago, el calendario muestra un cobro que no ocurrió.
- **Límite:** un pago registrado antes de su fecha queda aunque el bono se venda
  en esos días (hasta 10).
- **Límite:** de los bonos vencidos o vendidos antes de activar el registro no
  hay historia, salvo lo que siga en la ficha mientras el bono exista.
- **Límite:** si un cupón variable (CER, TAMAR, Badlar) se ajusta después del
  registro, la hoja conserva el valor estimado al registrar.
- **Revisar si:** bonistas cambia la cantidad de pagos en `flow_past`, deja de
  embeber `bondData` en la ficha, o empieza a publicar pagos pasados en
  proximos-pagos.
