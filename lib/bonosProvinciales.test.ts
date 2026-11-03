import { describe, it, expect } from 'vitest';
import { calcularMetricasProvinciales, parsearBonosCalculoPropio, type CondicionesBono } from './bonosProvinciales';

// Bonos ficticios con resultado conocido de antemano. Las condiciones reales
// viven en la hoja BonosCalculoPropio del Sheet; acá se prueba el motor.
const HOY = new Date('2026-01-01T00:00:00Z');

function bono(parcial: Partial<CondicionesBono> & { ticker: string }): CondicionesBono {
  return {
    nombre: parcial.ticker,
    grupo: 'ARS_TASA',
    etiqueta: '',
    moneda: 'ARS',
    vencimiento: '2027-01-01',
    simboloPrecio: parcial.ticker,
    tnaCupon: 0,
    pagosPorAnio: 1,
    primerCupon: '2027-01-01',
    amortizaciones: [{ fecha: '2027-01-01', porcentaje: 100 }],
    valorTecnico: 100,
    tirReferencia: null,
    ...parcial,
  };
}

// Cupón cero a 1 año (365 días): precio 100/1,1 ⇒ TIR 10% y duration
// modificada 1/1,1.
const CERO = bono({ ticker: 'CERO1' });
// Cupón anual del 10% a 2 años, bullet, comprado a la par ⇒ TIR 10%.
const CUPON = bono({
  ticker: 'CUPON2', vencimiento: '2028-01-01', tnaCupon: 0.1,
  amortizaciones: [{ fecha: '2028-01-01', porcentaje: 100 }],
});
// Mismo bono pero amortizando la mitad en cada pago: devuelve capital antes.
const ESCALONADO = bono({
  ticker: 'ESCAL2', vencimiento: '2028-01-01', tnaCupon: 0.1, grupo: 'CER',
  amortizaciones: [{ fecha: '2027-01-01', porcentaje: 50 }, { fecha: '2028-01-01', porcentaje: 50 }],
});

describe('calcularMetricasProvinciales', () => {
  it('reproduce la TIR y la duration de un cupón cero', () => {
    const [m] = calcularMetricasProvinciales([CERO], { CERO1: 100 / 1.1 }, HOY);
    expect(m.tir).toBeCloseTo(0.1, 6);
    expect(m.modifiedDuration).toBeCloseTo(1 / 1.1, 6);
    expect(m.calculoPropio).toBe(true);
  });

  it('un bono comprado a la par rinde su cupón', () => {
    const [m] = calcularMetricasProvinciales([CUPON], { CUPON2: 100 }, HOY);
    expect(m.tir).toBeCloseTo(0.1, 6);
  });

  it('la duration modificada nunca supera los años al vencimiento', () => {
    // Cota estructural: con cupones positivos la Macaulay siempre es menor al
    // plazo final, y la modificada todavía menor. Si esto falla, el flujo
    // tiene fechas mal.
    for (const b of calcularMetricasProvinciales([CUPON, ESCALONADO], { CUPON2: 100, ESCAL2: 100 }, HOY)) {
      expect(b.modifiedDuration).toBeLessThan(b.diasAlVencimiento / 365);
    }
  });

  it('amortizar antes acorta la duration', () => {
    const m = calcularMetricasProvinciales([CUPON, ESCALONADO], { CUPON2: 100, ESCAL2: 100 }, HOY);
    const porTicker = Object.fromEntries(m.map((b) => [b.ticker, b]));
    expect(porTicker.ESCAL2.modifiedDuration).toBeLessThan(porTicker.CUPON2.modifiedDuration);
  });

  it('descuenta contra la paridad (precio / valor técnico), no contra el precio', () => {
    // Capital indexado: cotiza a 108 con un valor técnico de 120 ⇒ paridad 0,9.
    // Es el mismo cupón cero que arriba, a otro precio por 100 nominales.
    const indexado = { ...CERO, ticker: 'INDEX1', simboloPrecio: 'INDEX1', valorTecnico: 120 };
    const [m] = calcularMetricasProvinciales([indexado], { INDEX1: 108 }, HOY);
    expect(m.parity).toBeCloseTo(0.9, 6);
    expect(m.tir).toBeCloseTo(100 / 90 - 1, 6);
  });

  it('omite el bono si no hay precio en vez de inventar una TIR', () => {
    const m = calcularMetricasProvinciales([CERO, CUPON], { CERO1: 90 }, HOY);
    expect(m.map((b) => b.ticker)).toEqual(['CERO1']);
  });

  it('ignora precios inválidos', () => {
    expect(calcularMetricasProvinciales([CERO, CUPON], { CERO1: 0, CUPON2: -5 }, HOY)).toEqual([]);
  });

  it('respeta el grupo de la hoja', () => {
    const m = calcularMetricasProvinciales([CUPON, ESCALONADO], { CUPON2: 100, ESCAL2: 100 }, HOY);
    expect(m.find((b) => b.ticker === 'ESCAL2')!.grupo).toBe('CER');
    expect(m.find((b) => b.ticker === 'CUPON2')!.grupo).toBe('ARS_TASA');
  });

  it('excluye los pagos ya vencidos del flujo', () => {
    // Parado casi al vencimiento, la duration tiene que colapsar contra cero:
    // si los pagos viejos siguieran en el flujo, no lo haría.
    const casiVencido = new Date('2027-12-01T00:00:00Z');
    const [m] = calcularMetricasProvinciales([ESCALONADO], { ESCAL2: 50 }, casiVencido);
    expect(m.modifiedDuration).toBeLessThan(0.15);
  });
});

describe('parsearBonosCalculoPropio', () => {
  const fila = {
    TICKER: 'prov1', NOMBRE: 'Provincia Ficticia 2027', GRUPO: 'ars_tasa', ETIQUETA: 'TAMAR',
    MONEDA: 'ARS', VENCIMIENTO: '2027-04-30', SIMBOLO_PRECIO: '', TNA_CUPON: '0.25',
    PAGOS_POR_ANIO: '4', PRIMER_CUPON: '2026-07-30', AMORTIZACIONES: '2026-10-30:40; 2027-04-30:60',
    VALOR_TECNICO: '101,5', TIR_REFERENCIA: '',
  };

  it('arma las condiciones desde la fila, con punto o coma decimal', () => {
    const [c] = parsearBonosCalculoPropio([fila]);
    expect(c.ticker).toBe('PROV1');
    expect(c.grupo).toBe('ARS_TASA');
    expect(c.simboloPrecio).toBe('PROV1'); // sin símbolo propio, usa el ticker
    expect(c.tnaCupon).toBe(0.25);
    expect(c.valorTecnico).toBe(101.5);
    expect(c.amortizaciones).toEqual([
      { fecha: '2026-10-30', porcentaje: 40 },
      { fecha: '2027-04-30', porcentaje: 60 },
    ]);
    expect(c.tirReferencia).toBeNull();
  });

  it('acepta amortizaciones que suman menos de 100 (capital ya devuelto en parte)', () => {
    expect(parsearBonosCalculoPropio([{ ...fila, AMORTIZACIONES: '2027-04-30:93' }])).toHaveLength(1);
  });

  it('descarta la fila entera si un campo es inválido', () => {
    expect(parsearBonosCalculoPropio([{ ...fila, GRUPO: 'INVENTADO' }])).toEqual([]);
    expect(parsearBonosCalculoPropio([{ ...fila, AMORTIZACIONES: '2027-04-30:120' }])).toEqual([]);
    expect(parsearBonosCalculoPropio([{ ...fila, VENCIMIENTO: '30/04/2027' }])).toEqual([]);
    expect(parsearBonosCalculoPropio([{ ...fila, VALOR_TECNICO: '1.234,5' }])).toEqual([]);
  });
});
