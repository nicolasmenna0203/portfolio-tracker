import { describe, expect, it } from 'vitest';
import { cierraElUltimoDia, exigirFinDeMes, parseResumenBroker, ultimoDiaDelMes } from './tenenciasPdf';

describe('ultimoDiaDelMes', () => {
  it('devuelve la fecha con la que se guarda el mes', () => {
    expect(ultimoDiaDelMes('2030-11')).toBe('30/11/2030');
    expect(ultimoDiaDelMes('2030-12')).toBe('31/12/2030');
    expect(ultimoDiaDelMes('2028-02')).toBe('29/02/2028');
  });
});

describe('cierraElUltimoDia', () => {
  it('es cierto solo si el cierre del PDF es el último día del mes elegido', () => {
    expect(cierraElUltimoDia('2030-10-31', '2030-10')).toBe(true);
    // Resumen con "Hasta" el día 1: ni noviembre ni octubre cierran ese día.
    expect(cierraElUltimoDia('2030-11-01', '2030-11')).toBe(false);
    expect(cierraElUltimoDia('2030-11-01', '2030-10')).toBe(false);
    // Cierre de octubre cargado en noviembre.
    expect(cierraElUltimoDia('2030-10-31', '2030-11')).toBe(false);
  });
});

describe('exigirFinDeMes', () => {
  it('acepta el último día de febrero, también en bisiesto', () => {
    expect(() => exigirFinDeMes('28-02-2030')).not.toThrow();
    expect(() => exigirFinDeMes('29-02-2028')).not.toThrow();
    expect(() => exigirFinDeMes('28-02-2028')).toThrow('no a fin de mes');
  });
});

// Fixture sintético con el mismo formato que el texto extraído del PDF real.
const POSICIONES = 'CEDEAR DE EMPRESA UNO (AAA) 10,00 ARS 1.000,000 10.000,00 10.000,00 ON EMPRESA DOS CL.1 01/01/30 USD (BBB2O) 100,00 USD MEP 1,50 150,00 225.000,00*';

function resumen(saldos: string, total = 'Total Posición al 31-05-2030 ARS 1.235.000,00 TOTAL DE LA INVERSION ARS 1.235.000,00') {
  return `Desde 01-05-2030 cotización Dólar MEP 1.500,00 POSICION AL CIERRE DEL 30-04-2030 INSTRUMENTO CANTIDAD MONEDA PRECIO TOTAL EN MONEDA TOTAL ARS CEDEAR VIEJO (ZZZ) 1,00 ARS 1,000 1,00 1,00 Total Posición al 30-04-2030 ARS 1,00 POSICION AL CIERRE DEL 31-05-2030 INSTRUMENTO CANTIDAD MONEDA PRECIO TOTAL EN MONEDA TOTAL ARS ${POSICIONES} ${saldos} ${total}`;
}

describe('parseResumenBroker', () => {
  it('lee la última sección de posición, con USD al MEP para filas en pesos', () => {
    const p = parseResumenBroker(resumen(''));
    expect(p.fecha).toBe('2030-05-31');
    expect(p.dolarMep).toBe(1500);
    expect(p.rows).toEqual([
      { ticker: 'AAA', tenenciaARS: 10000, tenenciaUSD: 10000 / 1500 },
      { ticker: 'BBB2O', tenenciaARS: 225000, tenenciaUSD: 150 },
    ]);
  });

  it('separa los saldos en cuenta de las posiciones', () => {
    const p = parseResumenBroker(resumen(
      'Saldo ARS 900.000,00 ARS 900.000,00 900.000,00 Saldo USD CABLE 2,00 USD CABLE 2,00 3.100,00** Saldo USD MEP 60,00 USD MEP 60,00 90.000,00*',
    ));
    expect(p.rows.map((r) => r.ticker)).toEqual(['AAA', 'BBB2O']);
    expect(p.saldos).toEqual([
      { moneda: 'ARS', montoEnMoneda: 900000, tenenciaARS: 900000, tenenciaUSD: 600 },
      { moneda: 'USD CABLE', montoEnMoneda: 2, tenenciaARS: 3100, tenenciaUSD: 2 },
      { moneda: 'USD MEP', montoEnMoneda: 60, tenenciaARS: 90000, tenenciaUSD: 60 },
    ]);
  });

  it('conserva el signo de un saldo en descubierto', () => {
    const p = parseResumenBroker(resumen('Saldo USD MEP -12,50 USD MEP -12,50 -18.750,00*'));
    expect(p.saldos).toEqual([
      { moneda: 'USD MEP', montoEnMoneda: -12.5, tenenciaARS: -18750, tenenciaUSD: -12.5 },
    ]);
  });

  it('toma el total de la última sección, no el de una anterior', () => {
    expect(parseResumenBroker(resumen('')).totalPosicionArs).toBe(1235000);
  });

  it('lee el pendiente de liquidación, que va aparte del total', () => {
    const p = parseResumenBroker(resumen('', 'Total Posición al 31-05-2030 ARS 1.235.000,00 Posición pendiente de liquidación al 31-05-2030 ARS 6.000,50 TOTAL DE LA INVERSION ARS 1.234.000,00'));
    expect(p.totalPosicionArs).toBe(1235000);
    expect(p.pendienteLiquidacionArs).toBe(6000.5);
  });

  it('acepta un total sin la moneda delante', () => {
    expect(parseResumenBroker(resumen('', 'Total Posición al 31-05-2030 1.235.000,00')).totalPosicionArs).toBe(1235000);
  });

  it('sin saldos ni total, los deja vacíos en vez de fallar', () => {
    const p = parseResumenBroker(`cotización Dólar MEP 1.500,00 POSICION AL CIERRE DEL 31-05-2030 ${POSICIONES}`);
    expect(p.saldos).toEqual([]);
    expect(p.totalPosicionArs).toBeNull();
    expect(p.pendienteLiquidacionArs).toBeNull();
  });

  it('lee un resumen que no cierra a fin de mes: el mes lo elige el usuario', () => {
    const texto = `POSICION AL CIERRE DEL 31-10-2030 ${POSICIONES} POSICION AL CIERRE DEL 01-11-2030 ${POSICIONES}`;
    expect(parseResumenBroker(texto).fecha).toBe('2030-11-01');
  });

  it('falla si no hay sección de posición o no hay instrumentos', () => {
    expect(() => parseResumenBroker('otro documento')).toThrow('POSICION AL CIERRE');
    expect(() => parseResumenBroker('POSICION AL CIERRE DEL 31-05-2030 nada')).toThrow('instrumentos');
  });

  it('lee una fila partida en dos renglones (nombre largo: salto de línea tras el ticker)', () => {
    // Bug real: con un espacio literal entre campos, estas filas se descartaban
    // sin error y la posición faltaba en la carga.
    const partidas = 'BONO PROVINCIAL DE NOMBRE MUY LARGO TASA VARIABLE 30/04/30 $ (CCC30)\n2.000,00 ARS 105,700 2.114,00 2.114,00 '
      + 'ON EMPRESA TRES CON DESCRIPCION EXTENSA USD (DDD3O)\n10,00 USD\nMEP 1,00 10,00 15.000,00*';
    const texto = resumen('').replace(POSICIONES, `${POSICIONES} ${partidas}`);
    const p = parseResumenBroker(texto);
    expect(p.rows.map((r) => r.ticker)).toEqual(['AAA', 'BBB2O', 'CCC30', 'DDD3O']);
    expect(p.rows[2]).toEqual({ ticker: 'CCC30', tenenciaARS: 2114, tenenciaUSD: 2114 / 1500 });
    expect(p.rows[3]).toEqual({ ticker: 'DDD3O', tenenciaARS: 15000, tenenciaUSD: 10 });
  });
});
