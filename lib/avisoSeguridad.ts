// Avisos por mail de los ingresos que no tienen que pasar sin que el dueño se
// entere: el alta de una passkey (una passkey ajena es un acceso que sobrevive
// a rotar la contraseña y SESSION_SECRET) y la entrada con contraseña, que en
// producción solo existe prendida a mano para recuperar el acceso.
// Ver docs/decisiones/0037-ingreso-solo-con-passkey.md
//
// No se avisa cada ingreso con passkey: pasa en cada apertura de la app.
//
// Nunca frena el ingreso: la ruta lo manda con `after()`, después de responder,
// y si el mail falla queda en el log. Fuera de producción no se manda nada: en
// dev se entra con contraseña todo el tiempo.

import type { NextRequest } from 'next/server';
import { enviarMail } from './mail';

export type EventoSeguridad = 'passkey-registrada' | 'ingreso-con-contrasena';

export interface DatosPedido {
  dispositivo: string;
  ip: string;
  /** Ciudad y país según la IP (headers de Vercel), o vacío si no vinieron. */
  lugar: string;
  cuando: Date;
}

/** Nombre del dispositivo, sacado del user agent. */
export function nombreDispositivo(userAgent: string): string {
  if (/iPhone/.test(userAgent)) return 'iPhone';
  if (/iPad/.test(userAgent)) return 'iPad';
  if (/Macintosh/.test(userAgent)) return 'Mac';
  if (/Android/.test(userAgent)) return 'Android';
  if (/Windows/.test(userAgent)) return 'Windows';
  return 'Otro';
}

/** Lo que se sabe del pedido para el aviso. Se lee antes de responder. */
export function datosDelPedido(req: Pick<NextRequest, 'headers'>, cuando = new Date()): DatosPedido {
  const h = req.headers;
  const ip = h.get('x-forwarded-for')?.split(',')[0]?.trim() || 'desconocida';
  // Vercel manda la ciudad URL-encoded ("Buenos%20Aires").
  let ciudad = h.get('x-vercel-ip-city') ?? '';
  try { ciudad = decodeURIComponent(ciudad); } catch { /* queda como vino */ }
  const lugar = [ciudad, h.get('x-vercel-ip-country') ?? ''].filter(Boolean).join(', ');
  return { dispositivo: nombreDispositivo(h.get('user-agent') ?? ''), ip, lugar, cuando };
}

const TITULO: Record<EventoSeguridad, string> = {
  'passkey-registrada': 'Se registró una passkey nueva',
  'ingreso-con-contrasena': 'Se entró con contraseña',
};

const QUE_HACER: Record<EventoSeguridad, string> = {
  'passkey-registrada':
    'Si no fuiste vos, borrá la fila nueva de la hoja Passkeys del Sheet y rotá SESSION_SECRET en Vercel: ' +
    'eso cierra todas las sesiones y la passkey ya no sirve para entrar.',
  'ingreso-con-contrasena':
    'La contraseña solo funciona con PERMITIR_CONTRASENA=true. Si no la prendiste vos para recuperar el acceso, ' +
    'apagala, cambiá BASIC_AUTH_PASS, rotá SESSION_SECRET y revisá la hoja Passkeys.',
};

export function armarAviso(evento: EventoSeguridad, d: DatosPedido): { asunto: string; texto: string } {
  const cuando = d.cuando.toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' });
  const texto = [
    `${TITULO[evento]} en el dashboard.`,
    '',
    `Cuándo: ${cuando}`,
    `Dispositivo: ${d.dispositivo}`,
    `IP: ${d.ip}${d.lugar ? ` (${d.lugar})` : ''}`,
    '',
    QUE_HACER[evento],
  ].join('\n');
  return { asunto: `Portfolio · ${TITULO[evento]}`, texto };
}

/** Manda el aviso. No tira: un mail caído no puede frenar ni romper un ingreso. */
export async function avisarSeguridad(evento: EventoSeguridad, datos: DatosPedido): Promise<void> {
  if (process.env.NODE_ENV !== 'production') return;
  const destinatario = process.env.ALERTA_EMAIL;
  if (!destinatario) {
    console.error('[avisoSeguridad] sin ALERTA_EMAIL: no se avisó', evento);
    return;
  }
  try {
    await enviarMail(destinatario, armarAviso(evento, datos));
  } catch (err) {
    console.error('[avisoSeguridad] no se pudo mandar el aviso', evento, err);
  }
}
