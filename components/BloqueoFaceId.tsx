'use client';

import { useEffect, useState } from 'react';
import { COOKIE_OCULTA } from '@/lib/cookiesAuth';

// Guardia del bloqueo con Face ID. Ver docs/decisiones/0035-bloqueo-con-passkey-en-cada-apertura.md
// y docs/decisiones/0036-bloquear-al-salir-con-una-marca-del-cliente.md
//
// Quien bloquea de verdad es el middleware: sin un desbloqueo vigente, ni la
// página ni las APIs responden. Este componente hace tres cosas que el
// servidor no puede:
//
// 1. **Marca al salir.** Al irse la app al fondo pone la cookie `app_oculta`,
//    sincrónicamente (document.cookie, sin red: iOS suspende la página enseguida).
//    Con esa marca el middleware bloquea aunque el desbloqueo siga vigente, así
//    que cerrar la app y volver a abrirla pide Face ID siempre. Si se vuelve
//    antes de `TOLERANCIA_MS`, la misma página saca la marca: cambiar un
//    momento de app no bloquea. Solo un ingreso válido la borra del lado del
//    servidor.
// 2. **Latido.** Mientras la app está a la vista renueva el desbloqueo cada
//    30 s. Al irse al fondo el latido se corta y el desbloqueo vence solo: es
//    el respaldo si la marca no se llegó a poner.
// 3. **Tapa.** Al ocultarse la app tapa el contenido, para que el selector de
//    apps de iOS no muestre montos en la captura, y la saca recién cuando el
//    latido confirma que el desbloqueo sigue vigente.
//
// Se monta solo en el dashboard real (app/page.tsx), no en /demo.

const LATIDO_MS = 30_000;

/** Volver antes de esto no bloquea: el tiempo de mirar otra app y volver. */
const TOLERANCIA_MS = 10_000;

function ponerMarca() {
  const seguro = location.protocol === 'https:' ? '; secure' : '';
  document.cookie = `${COOKIE_OCULTA}=${Date.now()}; path=/; max-age=${60 * 60 * 24 * 7}; samesite=lax${seguro}`;
}

/** Saca la marca si la app volvió dentro de la tolerancia; si no, la deja. */
function levantarMarcaSiFueUnMomento() {
  const m = document.cookie.match(new RegExp(`(?:^|; )${COOKIE_OCULTA}=(\d+)`));
  if (m && Date.now() - Number(m[1]) < TOLERANCIA_MS) {
    document.cookie = `${COOKIE_OCULTA}=; path=/; max-age=0`;
  }
}

export default function BloqueoFaceId() {
  const [bloqueo, setBloqueo] = useState(false);
  const [tapado, setTapado] = useState(false);

  useEffect(() => {
    let vivo = true;
    let conBloqueo = false;

    const latido = async () => {
      try {
        // `manual`: si la sesión se cayó entera, el middleware redirige y el
        // fetch recibiría el HTML del login como si fuera un 200.
        const res = await fetch('/api/auth/sesion', { cache: 'no-store', redirect: 'manual' });
        if (!vivo) return;
        if (res.status === 401 || res.type === 'opaqueredirect') {
          // `replace`: que "atrás" no vuelva al dashboard. Recargar además
          // descarta de memoria los datos que ya estaban cargados.
          window.location.replace(res.status === 401 ? '/login?bloqueado=1' : '/login');
          return;
        }
        if (!res.ok) return; // un error del servidor no es motivo para bloquear
        const data = (await res.json()) as { bloqueo?: boolean };
        conBloqueo = data.bloqueo === true;
        setBloqueo(conBloqueo);
        setTapado(false);
      } catch {
        // Sin red: el desbloqueo vence igual del lado del servidor.
      }
    };

    const alCambiarVisibilidad = () => {
      // La marca va siempre, no solo con `conBloqueo`: hasta que responde el
      // primer latido no se sabe si el dispositivo tiene bloqueo, y salir en ese
      // momento no tiene que escaparse. En una sesión sin bloqueo el middleware
      // la ignora.
      if (document.visibilityState === 'hidden') {
        ponerMarca();
        if (conBloqueo) setTapado(true);
      } else {
        levantarMarcaSiFueUnMomento();
        void latido();
      }
    };

    // La app restaurada del bfcache de Safari no vuelve a montar nada.
    const alMostrar = (e: PageTransitionEvent) => { if (e.persisted) void latido(); };

    void latido();
    const intervalo = setInterval(() => {
      if (document.visibilityState === 'visible') void latido();
    }, LATIDO_MS);
    document.addEventListener('visibilitychange', alCambiarVisibilidad);
    window.addEventListener('pageshow', alMostrar);
    // Tras activar Face ID desde el panel de carga, el bloqueo empieza ya.
    window.addEventListener('faceid-activado', latido);

    return () => {
      vivo = false;
      clearInterval(intervalo);
      document.removeEventListener('visibilitychange', alCambiarVisibilidad);
      window.removeEventListener('pageshow', alMostrar);
      window.removeEventListener('faceid-activado', latido);
    };
  }, []);

  if (!bloqueo || !tapado) return null;

  return (
    <div className="bloqueo-tapa" aria-hidden="true">
      {/* eslint-disable-next-line @next/next/no-img-element -- SVG estático: next/image no lo optimiza */}
      <img src="/icon.svg" alt="" width={64} height={64} />
    </div>
  );
}
