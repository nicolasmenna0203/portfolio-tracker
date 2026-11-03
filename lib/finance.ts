/**
 * XIRR — Tasa Interna de Retorno para flujos de caja con fechas irregulares.
 * Implementación por método de Newton-Raphson.
 *
 * Decisión y alternativas descartadas:
 * docs/decisiones/0011-xirr-newton-raphson-multi-semilla.md
 *
 * Convención de signos (perspectiva del inversor):
 *  - Aportes (ingreso al portfolio) → negativos (plata que salió del bolsillo)
 *  - Retiros / valor terminal       → positivos
 */
export interface Cashflow {
  date: number; // timestamp ms
  amount: number;
}

export function xirr(cashflows: Cashflow[]): number | null {
  if (cashflows.length < 2) return null;

  const t0 = cashflows[0].date;
  // Años fraccionarios desde t0
  const times = cashflows.map(cf => (cf.date - t0) / (365.25 * 24 * 3600 * 1000));
  const amounts = cashflows.map(cf => cf.amount);

  // NPV en función de la tasa r
  const npv = (r: number) =>
    amounts.reduce((sum, a, i) => sum + a / Math.pow(1 + r, times[i]), 0);

  // Derivada de NPV
  const dnpv = (r: number) =>
    amounts.reduce(
      (sum, a, i) => sum - (times[i] * a) / Math.pow(1 + r, times[i] + 1),
      0
    );

  // Intentamos con varios puntos de partida para mayor robustez
  const guesses = [0.1, 0.5, -0.1, 1.0, 2.0];
  for (const guess of guesses) {
    let r = guess;
    for (let iter = 0; iter < 200; iter++) {
      const f = npv(r);
      const df = dnpv(r);
      if (Math.abs(df) < 1e-12) break;
      const rNew = r - f / df;
      if (Math.abs(rNew - r) < 1e-8) return rNew;
      r = rNew;
      if (!isFinite(r) || r < -1) break;
    }
  }
  return null;
}
