// Envío de mails por la API HTTP de Resend, directo con fetch (sin el paquete
// `resend`), con la misma convención que el resto de lib/ (Yahoo,
// bonistas.com) de no sumar SDKs para un solo POST.
//
// Lo usan la alerta semanal (lib/alertas.ts) y los avisos de seguridad
// (lib/avisoSeguridad.ts).

// Remitente por defecto de Resend cuando no hay dominio propio verificado.
// Solo puede mandar al mismo mail con el que te registraste en Resend.
const REMITENTE_DEFAULT = 'onboarding@resend.dev';

/**
 * Envía un mail vía la API de Resend.
 * Requiere RESEND_API_KEY. Opcionalmente RESEND_FROM si se verificó un
 * dominio propio en Resend (si no, se usa el remitente sandbox de Resend,
 * que solo entrega al mail con el que te registraste ahí).
 */
export async function enviarMail(
  destinatario: string,
  { asunto, texto, html }: { asunto: string; texto: string; html?: string },
): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    throw new Error('RESEND_API_KEY no configurada.');
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: process.env.RESEND_FROM || REMITENTE_DEFAULT,
      to: [destinatario],
      subject: asunto,
      ...(html ? { html } : {}),
      text: texto,
    }),
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    const detalle = await res.text().catch(() => '');
    throw new Error(`Resend: HTTP ${res.status} ${detalle}`);
  }
}
