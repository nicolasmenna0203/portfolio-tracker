import { NextRequest, NextResponse } from 'next/server';
import { fetchDashboardData } from '@/lib/sheets';
import { calcularAlertaSemanal, armarContenidoMail, enviarAlertaSemanal } from '@/lib/alertas';
import { equalsSeguro } from '@/lib/timingSafe';

export const runtime = 'nodejs';

/**
 * Dispara la alerta semanal de cobros (dividendos, renta, amortización,
 * balances) de los próximos 7 días.
 *
 * Pensada para invocarse desde un cron externo, no desde el browser — por eso
 * no usa la cookie de sesión sino un secret propio (CRON_SECRET) pasado como
 * `Authorization: Bearer <secret>`.
 *
 * El trigger es el workflow `.github/workflows/alerta-semanal.yml` (domingo
 * 21:00 ART = lunes 00:00 UTC). Se eligió GitHub Actions en vez de Vercel Cron
 * por el horario exacto: ver docs/decisiones/0015-cron-semanal-en-github-actions.md
 *
 * Envío por Resend (RESEND_API_KEY) al destinatario de ALERTA_EMAIL.
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
    const alerta = await calcularAlertaSemanal(data, 7);
    const contenido = armarContenidoMail(alerta);

    await enviarAlertaSemanal(destinatario, alerta);

    return NextResponse.json({ ok: true, ...contenido, eventos: alerta.eventos.length });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
