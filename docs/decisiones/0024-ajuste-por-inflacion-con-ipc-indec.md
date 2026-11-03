---
numero: 0024
titulo: Ajustar por inflación deflactando los datos en ARS con el IPC del INDEC
estado: Aceptada
fecha: 2026-11-01
codigo: lib/inflacion.ts, components/ResumenTab.tsx
---

# 0024 — Ajustar por inflación deflactando los datos en ARS con el IPC del INDEC

## Contexto

Las métricas en ARS (ganancia, TWR, TIR) son nominales: con inflación alta un
+50% en pesos puede ser poca ganancia real. El Resumen necesita poder mostrar
el rendimiento en poder de compra. El dashboard ya baja el IPC mensual del
INDEC (ArgentinaDatos) para la pestaña Benchmarks. El IPC es mensual y se
publica con unas dos semanas de rezago; los flujos tienen fecha exacta.

## Alternativas descartadas

- **Fórmula de Fisher sobre el resultado** (`(1+nominal)/(1+inflación)−1`) —
  funciona para TWR, pero no para la ganancia en pesos ni para la TIR con
  flujos en distintas fechas, y obligaría a una segunda fórmula por métrica.
- **CER en lugar de IPC** — el CER es una interpolación diaria del IPC con
  rezago de dos meses: mide la inflación de hace dos meses, no la del período.
- **Proyectar los meses sin publicar** — inventaría un dato. Se prefirió
  dejarlos sin ajustar y decirlo en pantalla.
- **Ajustar también el USD** — el dólar es el numerario; deflactarlo con el IPC
  de EE.UU. es otra decisión, fuera de alcance.

## Decisión

Se deflactan los **datos** (campos ARS de `resumenSeries` y `movimientos`) a
pesos constantes del último mes de la serie, y esos datos se pasan sin cambios a
`calcularMetricasPeriodo` y al gráfico. El TWR y la XIRR sobre flujos en pesos
constantes dan el rendimiento real sin tocar `lib/twr.ts` ni `lib/finance.ts`.

- **Valuación mensual:** es el cierre de su mes → índice de ese mes.
- **Flujo con fecha:** interpolación geométrica entre el índice del mes anterior
  y el de su mes, por fracción de días `(día−1)/días del mes`.
- **Meses sin IPC publicado:** `/api/benchmarks` repite el último valor, así que
  esos meses quedan con inflación cero. `ultimoMesPublicado` los detecta (cola
  de valores idénticos) para avisarlo en la UI.
- El toggle existe solo en ARS y se persiste por viewer en `localStorage`.

## Consecuencias y límites

- **Límite:** el último mes en curso (y el anterior, si el INDEC no publicó)
  subestima la inflación: el rendimiento real de esos meses sale algo más alto
  que el verdadero.
- **Límite:** el IPC es nacional; no refleja la inflación de la canasta de quien
  invierte.
- **Límite:** la interpolación dentro del mes supone inflación pareja a lo largo
  del mes.
- **Límite:** las tools del MCP siguen devolviendo ARS nominal; el ajuste vive
  solo en el Resumen.
- **Revisar si:** se quiere exponer el rendimiento real por el MCP, o si el
  rezago del IPC pasa a importar para decisiones (ahí conviene una estimación
  explícita, p. ej. el REM del BCRA).
