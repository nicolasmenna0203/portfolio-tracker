import { describe, it, expect } from 'vitest';
import { parseHaberesText, limpiarEmpleador } from './haberes';

// Los fixtures son sintéticos: replican el formato exacto de los resúmenes de
// cuenta reales (posición del CUIT, códigos de lote, comprobantes fragmentados)
// con razones sociales y CUIT ficticios. Los CUIT no son válidos por dígito
// verificador, así que no corresponden a ninguna empresa real.

describe('limpiarEmpleador', () => {
  it('saca CUIT y código de lote pegado al nombre', () => {
    expect(limpiarEmpleador('30111111111 240130007empresa uno sa')).toBe('empresa uno sa');
  });

  it('saca el dígito de sufijo pegado a la última palabra', () => {
    expect(limpiarEmpleador('30111111111 240228007empresa uno sa2')).toBe('empresa uno sa');
  });

  it('saca "cuit" y el CUIT cuando aparecen después del nombre', () => {
    expect(limpiarEmpleador('240327007empresa uno sa cuit 30111111111')).toBe('empresa uno sa');
  });

  it('cae a "CUIT <número>" cuando el pago es DEBIN y no hay nombre de empleador', () => {
    expect(limpiarEmpleador('Id debin a1b2c3d4e5f6g7h8i9j0k1 cuit 30222222222')).toBe('CUIT 30222222222');
  });

  it('extrae el nombre cuando va ANTES del CUIT y descarta el comprobante fragmentado (formato interbanking)', () => {
    expect(limpiarEmpleador('interbanking externa Empresa dos srl 30222222222 02 30851 67')).toBe('Empresa dos srl');
  });
});

describe('parseHaberesText', () => {
  const sampleText = `SuperCuenta Mi resumen de cuenta TITULAR DE PRUEBA CUIL: 20-00000000-0 Movimientos en pesos Fecha Comprobante Movimiento Caja de Ahorro en pesos Saldo en cuenta 13/01/24 Saldo Inicial $ 0,67 $ 0,67 31/01/24 67332701 Acreditacion de haberes 30111111111 240130007empresa uno sa $ 276.000,00 $ 276.000,67 31/01/24 67495399 Transferencia no gravada A titular de prueba / varios - var / 20000000000 -$ 276.000,00 $ 0,67 29/02/24 68817961 Acreditacion de haberes 30111111111 240228007empresa uno sa2 $ 367.200,00 $ 367.200,67 27/03/24 70551592 Acreditacion de haberes 240327007empresa uno sa cuit 30111111111 $ 349.000,00 $ 349.000,00 Movimientos en dólares No tenés movimientos en dólares en este período.`;

  it('extrae las acreditaciones de haberes con fecha, empleador y monto, ignorando otras líneas (ej. transferencias)', () => {
    const { rows } = parseHaberesText(sampleText);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toEqual({
      fecha: '31/01/2024',
      empleador: 'empresa uno sa',
      montoArs: 276000,
      montoUsd: 0,
    });
    expect(rows[1].montoArs).toBe(367200);
    expect(rows[2].fecha).toBe('27/03/2024');
  });

  it('agrupa los meses detectados sin duplicados y ordenados', () => {
    const { mesesKeys } = parseHaberesText(sampleText);
    expect(mesesKeys).toEqual(['2024-01', '2024-02', '2024-03']);
  });

  it('tira error si no encuentra ninguna acreditación de haberes', () => {
    expect(() => parseHaberesText('sin movimientos relevantes acá')).toThrow(/No se encontraron/);
  });

  it('reconoce el formato DEBIN ("Acreditacion haberes debin", sin "de", sin nombre) usando el CUIT como empleador', () => {
    const debinText = `Infinity Mi resumen de cuenta TITULAR DE PRUEBA Movimientos en pesos Fecha Comprobante Movimiento Cuenta sueldo en pesos Cuenta Corriente en pesos Saldo en cuenta 03/07/26 Saldo Inicial $ 0,40 $ 0,00 $ 0,40 08/07/26 89653638 Acreditacion haberes debin Id debin a1b2c3d4e5f6g7h8i9j0k1 cuit 30222222222 $ 1.900.000,55 $ 1.900.001,37 12/07/26 94541228 Transf recibida cvu mismo titular De titular de prueba / billetera virtual /2000 0000000 $ 345.750,00 $ 2.245.751,37`;
    const { rows } = parseHaberesText(debinText);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      fecha: '08/07/2026',
      empleador: 'CUIT 30222222222',
      montoArs: 1900000.55,
      montoUsd: 0,
    });
  });

  it('reconoce el formato "Pago haberes interbanking externa" (nombre antes del CUIT, comprobante fragmentado)', () => {
    const interbankingText = `Infinity Mi resumen de cuenta TITULAR DE PRUEBA Movimientos en pesos Fecha Comprobante Movimiento Cuenta sueldo en pesos Cuenta Corriente en pesos Saldo en cuenta 28/11/25 Saldo Inicial $ 446,34 $ 0,00 $ 446,34 05/12/25 3085167 Pago haberes interbanking externa Empresa dos srl 30222222222 02 30851 67 $ 1.500.000,38 $ 1.500.446,72 23/12/25 3221086 Pago haberes interbanking externa Empresa dos srl 30222222222 02 32210 86 $ 700.000,51 $ 700.090,52`;
    const { rows } = parseHaberesText(interbankingText);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({
      fecha: '05/12/2025',
      empleador: 'Empresa dos srl',
      montoArs: 1500000.38,
      montoUsd: 0,
    });
    expect(rows[1].montoArs).toBe(700000.51);
  });

  // Comprobante individual de transferencia (ej. "Office Banking" de un banco):
  // un PDF de una sola operación, sin tabla de movimientos. El fixture replica
  // el formato real (orden de campos, "Datos del pagador" antes de "Datos del
  // destinatario") con razón social y CUIT ficticios.
  it('reconoce el comprobante individual de transferencia y usa los datos del PAGADOR como empleador', () => {
    const comprobanteText = `Identificador de la operación: AB12Cde340 Datos del pago Tipo de transferencia Nro. de Transferencia Sueldos 5 Fecha de envío Monto 15/03/2026 $ 500.000,00 Concepto Descripción Acreditamiento De Haberes MARZO 2026 Datos del pagador CUIT/CUIL Razón Social 30333333333 EMPRESA TRES SA Cuenta a debitar CC$ 111222333 Datos del destinatario CUIT/CUIL Razón social 20111111110 Titular De Prueba Cuenta en Cuenta de destino Banco De Prueba 0000000000000000000000`;
    const { rows } = parseHaberesText(comprobanteText);
    expect(rows).toEqual([{
      fecha: '15/03/2026',
      empleador: 'EMPRESA TRES SA',
      montoArs: 500000,
      montoUsd: 0,
    }]);
  });

  it('agrupa el mes del comprobante individual igual que con un extracto de cuenta', () => {
    const comprobanteText = `Datos del pago Fecha de envío Monto 15/03/2026 $ 500.000,00 Concepto Acreditamiento De Haberes MARZO 2026 Datos del pagador CUIT/CUIL Razón Social 30333333333 EMPRESA TRES SA Cuenta a debitar`;
    const { mesesKeys } = parseHaberesText(comprobanteText);
    expect(mesesKeys).toEqual(['2026-03']);
  });
});
