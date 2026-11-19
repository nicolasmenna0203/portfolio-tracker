---
numero: 0039
titulo: Revisión técnica semanal en el mail, con niveles en el Sheet y tendencias recalculadas en el código
estado: Aceptada
fecha: 2026-11-18
codigo: lib/revisionTecnica.ts, lib/alertas.ts
---

# 0039 — Revisión técnica semanal en el mail, con niveles en el Sheet y tendencias recalculadas en el código

## Contexto

El plan de la cartera tiene, por activo, precios de compra escalonados (S1-S3) y
de venta (R1-R3), y líneas de tendencia dibujadas en un gráfico externo. Hacía
falta revisarlos todas las semanas, pero quien lee el mail no hace análisis
técnico: necesita "qué dice el plan esta semana", no un gráfico. El gráfico
externo no tiene API para leer sus dibujos desde el servidor, y la lista de
activos con niveles dice qué hay en la cartera, así que no puede vivir en el
código (ADR 0030).

## Alternativas descartadas

- **Leer los dibujos del gráfico externo** — no hay API pública; solo se puede
  desde un navegador con la sesión iniciada, que el job del domingo no tiene.
- **Guardar en el Sheet también los dos puntos de cada línea de tendencia** —
  obliga a que alguien sincronice el Sheet cada vez que la línea cambia. La
  regla que define la línea es determinística: recalcularla da lo mismo sin
  estado que mantener.
- **Un mail aparte para la revisión técnica** — un mail más por semana con
  información que se lee junto a la variación de precios. Va como un bloque del
  mail del domingo.
- **Detectar soportes y resistencias automáticamente** — los niveles del plan
  son decisiones (combinan gráfico y valuación), no un cálculo; si el código los
  moviera solos, el plan cambiaría sin que nadie lo decida.

## Decisión

- **Niveles:** una fila por nivel (Ticker, Rol, Nivel, Precio, Nota), en
  `niveles.json` de la rama privada `datos-semanales`, que el workflow manda al
  job (ADR 0040); como alternativa, la hoja `NivelesTecnicos` del Sheet. El rol (CORE, SATELITE, LEGADO, CONSOLIDAR,
  RADAR) decide cómo se traduce un nivel tocado: el mismo nivel de compra es
  "adelantar el aporte" en el núcleo, "comprar el tramo" en un satélite y solo
  una referencia en una posición que se está vendiendo.
- **Serie:** velas semanales de 3 años de Yahoo, ajustadas por dividendos con el
  factor adjclose/close de cada vela, porque los niveles se fijaron sobre un
  gráfico con precios ajustados.
- **Tendencias:** misma regla con la que se dibujan en el gráfico. Ventana de
  156 velas, pivotes de ±3. Alcista: desde el mínimo de la ventana hacia el
  pivote bajo posterior (8+ velas después) de menor pendiente positiva.
  Bajista: solo si el precio cayó más de 10% desde el máximo de la ventana
  (6+ velas atrás), hacia el pivote alto posterior (4+ velas) de pendiente
  menos negativa. Los números son arbitrarios: son los que se usaron para
  dibujar, y cambiarlos acá desalinea el mail del gráfico.
- **Eventos de la semana:** tocó un nivel viniendo del otro lado; lo perforó
  (dos cierres semanales seguidos más de 2% del otro lado, avisado una sola vez:
  margen arbitrario para no contar como ruptura un pinchazo de una semana);
  cortó la tendencia alcista o superó la bajista con el cierre.
- **Fallas:** sin la hoja, el bloque no sale; con la hoja ilegible o Yahoo caído,
  tampoco, y el mail sale con el resto. Un ticker sin serie o una fila inválida
  se informa como aviso al pie del bloque sin cortar los demás.

## Consecuencias y límites

- **Límite:** el código no mueve niveles. Si un nivel se perfora, el mail lo
  dice, pero cambiarlo en `niveles.json` (y en el gráfico) es una decisión aparte.
- **Límite:** el gráfico externo y Yahoo pueden diferir por centavos en la vela
  semanal ajustada; una línea puede quedar apenas de un lado en uno y del otro
  en el otro.
- **Límite:** un disparo manual a mitad de semana evalúa la vela en curso, que
  todavía no cerró.
- **Límite:** si el precio hace un mínimo nuevo de la ventana, la alcista
  desaparece (arranca desde ese mínimo y no tiene pivote posterior) en vez de
  figurar como rota: la ruptura se avisa la semana en que el cierre la cruza.
- **Revisar si:** cambia la regla de dibujo de las tendencias en el gráfico, o
  los avisos de ruptura resultan ruido (el margen de 2% es el primer candidato).
