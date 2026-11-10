import { NextRequest, NextResponse } from 'next/server';
import { fetchDashboardData } from '@/lib/sheets';
import { calcularAlertaSemanal, enviarAlertaSemanal } from '@/lib/alertas';
import { equalsSeguro } from '@/lib/timingSafe';
import { registrarPagosBonos, type ResultadoRegistro } from '@/lib/pagosBonos';

export const runtime = 'nodejs';

/**
 * Dispara la alerta semanal de cobros (dividendos, renta, amortización,
 * balances) de los próximos 7 días.
 *
 * Pensada para invocarse desde un cron externo, no desde el browser — por eso
 * no usa la cookie de sesión sino un secret propio (CRON_SECRET) pasado como
 * `Authorization: Bearer <secret>`.
 *
 * El trigger es el workflow `.github/workflows/alerta-semanal.yml`, dos veces
 * el domingo (la segunda es respaldo y no reenvía): GitHub Actions demora los
 * schedule varias horas, ver docs/decisiones/0033-alerta-semanal-con-disparo-de-respaldo-el-domingo.md
 *
 * Envío por Resend (RESEND_API_KEY) al destinatario de ALERTA_EMAIL.
 *
 * De paso anota en la hoja PagosBonos los pagos de bonos de la cartera de esas
 * semanas (lib/pagosBonos.ts), para que no desaparezcan del calendario cuando
 * bonistas deja de publicarlos. Va acá y no en una ruta propia porque necesita
 * el mismo cron semanal y evita abrir otra ruta pública en el middleware.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: 'CRON_SECRET no configurado' }, { status: 500 });
  }

  // Destino único: dashboard de un solo usuario. Si alguna vez hay más de uno,
  // esto pasa a ser una lista separada por comas.
  const destinatario = process.env.ALERTA_EMAIL;
  if (!destinatario) {
    return NextResponse.json({ error: 'ALERTA_EMAIL no configurado' }, { status: 500 });
  }

  const auth = req.headers.get('authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!equalsSeguro(token, secret)) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  }

  try {
    const data = await fetchDashboardData();

    // Registrar los pagos de bonos no depende del mail ni al revés: si falla,
    // el mail sale igual y la respuesta no es 200, para que el workflow lo
    // marque. Volver a correrlo reenvía el mail, pero no duplica filas.
    let registro: ResultadoRegistro | { error: string };
    try {
      registro = await registrarPagosBonos(data);
    } catch (err) {
      registro = { error: err instanceof Error ? err.message : String(err) };
    }

    // `?mail=0`: solo el registro. Lo usa el workflow cuando el disparo llega
    // tarde (ya es lunes): el mail no sale, pero los pagos de bonos de esa
    // semana se anotan igual. Ver docs/decisiones/0033-alerta-semanal-con-disparo-de-respaldo-el-domingo.md
    const conMail = req.nextUrl.searchParams.get('mail') !== '0';
    let eventos: number | null = null;
    if (conMail) {
      const alerta = await calcularAlertaSemanal(data, 7);
      await enviarAlertaSemanal(destinatario, alerta);
      eventos = alerta.eventos.length;
    }

    const registroOk = !('error' in registro);
    return NextResponse.json(
      // Solo un resumen: la respuesta queda en el log de GitHub Actions, y el
      // mail completo (con montos) no tiene por qué quedar ahí.
      { ok: registroOk, mail: conMail ? 'enviado' : 'omitido', eventos, pagosBonos: registro },
      { status: registroOk ? 200 : 500 },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
