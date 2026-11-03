---
numero: 0003
titulo: Calcular la variación semanal sobre la moneda nativa de cada activo
estado: Aceptada
fecha: 2026-08-06
codigo: lib/variacionSemanal.ts
---

# 0003 — Calcular la variación semanal sobre la moneda nativa de cada activo

## Contexto

El mail semanal muestra la variación de precio de los últimos 7 días de cada
posición, en USD y en ARS. La cartera es mixta: hay activos que cotizan en dólares
(CEDEARs, ETFs) y otros en pesos (bonos y letras en ARS, FCI en pesos).

El atajo intuitivo —calcular la variación en una moneda y convertirla a la otra con
el MEP— da un resultado incorrecto. Un CEDEAR que no se movió en USD **sube en
pesos** si el MEP subió; un bono en pesos que no se movió en ARS **cae en USD** por
la misma razón. La variación cambia de valor según la moneda en la que se mide, y no
por un error de redondeo: es el efecto del tipo de cambio, que es justamente parte
de lo que se quiere ver.

## Alternativas descartadas

- **Calcular en USD y convertir la variación al MEP de hoy** — matemáticamente
  inválido: aplicar un solo tipo de cambio a un cociente de dos fechas distintas
  cancela el efecto del movimiento del MEP, que es real.
- **Mostrar una sola moneda** — pierde información. En una cartera bimonetaria las
  dos lecturas importan, y a veces tienen signo opuesto.
- **Usar el MEP de hoy para ambos extremos de la serie** — el error específico que
  esta decisión evita: haría que la variación en ARS fuera idéntica a la de USD.

## Decisión

Cada pata se calcula sobre la serie de precios en la **moneda nativa** del activo, y
la otra se deriva convirtiendo **ambos extremos** con el MEP de su propia fecha:

```
variación_ARS = (precio_hoy_USD × MEP_hoy) / (precio_previo_USD × MEP_previo) − 1
```

Es decir: el precio de hace 7 días se convierte con el MEP de hace 7 días, y el de
hoy con el de hoy. Nunca con el mismo tipo de cambio.

El mail incluye además la variación del MEP en el mismo período, que es lo que
explica la diferencia entre las dos columnas.

Cuando falta una punta de la serie, el campo va en `null` con una `nota` del motivo,
en vez de un 0 que se leería como "no se movió".

## Consecuencias y límites

- **Límite — las dos columnas pueden tener signo opuesto** para el mismo activo, y
  eso es correcto, no un bug. Es la lectura que hay que dar si alguien lo reporta.
- **Límite — se necesitan dos cotizaciones de MEP** (hoy y ~7 días atrás), no una.
  Si falta la histórica, la pata en la moneda derivada no se puede calcular.
- **Límite — los promedios por grupo son simples, no ponderados** por tenencia. Un
  activo chico pesa igual que uno grande en el promedio del grupo.
- **Revisar si:** se agrega un activo en una tercera moneda (la lógica asume dos:
  nativa y derivada vía MEP); o si se quiere ponderar los promedios por tenencia.
