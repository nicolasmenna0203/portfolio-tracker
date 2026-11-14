'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import {
  hayFaceId, accederConPasskey, esCancelacion, usaFaceId, pedirOpcionesAcceso, type OpcionesAcceso,
} from '@/lib/passkeyCliente';
import './login.css';

/**
 * Resuelve cuando la página está a la vista y con foco. Al abrir la app desde
 * la pantalla de inicio, la página carga antes de que iOS le dé el foco, y un
 * Face ID pedido en ese momento falla y gasta el único intento sin toque que
 * Safari concede por carga de página.
 */
function cuandoTengaFoco(): Promise<void> {
  const listo = () => document.visibilityState === 'visible' && document.hasFocus();
  if (listo()) return Promise.resolve();
  return new Promise((resolve) => {
    const revisar = () => {
      if (!listo()) return;
      window.removeEventListener('focus', revisar);
      document.removeEventListener('visibilitychange', revisar);
      resolve();
    };
    window.addEventListener('focus', revisar);
    document.addEventListener('visibilitychange', revisar);
  });
}

// El glifo de Face ID de iOS: cuatro esquinas, ojos, nariz y sonrisa.
function IconFaceId({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 8V6a3 3 0 0 1 3-3h2M16 3h2a3 3 0 0 1 3 3v2M21 16v2a3 3 0 0 1-3 3h-2M8 21H6a3 3 0 0 1-3-3v-2" />
      <line x1="9" y1="9" x2="9" y2="10.5" />
      <line x1="15" y1="9" x2="15" y2="10.5" />
      <path d="M12 9v4h-1" />
      <path d="M9.5 16a3.5 3.5 0 0 0 5 0" />
    </svg>
  );
}

/**
 * `conContrasena` viene del servidor (page.tsx): en producción la contraseña
 * está apagada y se entra solo con passkey. Ahí no hay formulario, y donde no
 * hay Face ID (una compu sin Windows Hello) el botón abre el QR para usar la
 * passkey del celular. Ver docs/decisiones/0037-ingreso-solo-con-passkey.md
 */
export default function LoginCliente({ conContrasena }: { conContrasena: boolean }) {
  const [user, setUser] = useState('');
  const [pass, setPass] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPass, setShowPass] = useState(false);
  const userRef = useRef<HTMLInputElement>(null);

  // Face ID: `faceId` dice si el dispositivo lo tiene; `bloqueado` si se llegó
  // acá porque venció el desbloqueo (middleware.ts). Si se viene de un bloqueo
  // o el dispositivo ya usó Face ID, se pide solo al abrir y la contraseña
  // queda detrás de un botón. Si Safari no lo deja abrir sin un toque, tocar
  // en cualquier parte de la pantalla lo abre.
  // Ver docs/decisiones/0035-bloqueo-con-passkey-en-cada-apertura.md
  const [faceId, setFaceId] = useState(false);
  const [bloqueado, setBloqueado] = useState(false);
  const [conPassword, setConPassword] = useState(conContrasena);
  const [esperandoFaceId, setEsperandoFaceId] = useState(false);
  const [tocarParaEscanear, setTocarParaEscanear] = useState(false);
  const enCurso = useRef(false);
  const opciones = useRef<OpcionesAcceso | null>(null);

  const precargar = useCallback(() => {
    opciones.current = null;
    pedirOpcionesAcceso().then((o) => { opciones.current = o; }, () => {});
  }, []);

  const entrar = useCallback(() => {
    // Navegación completa y no router.push: así el middleware ve las cookies
    // nuevas en el primer pedido y no queda nada del estado anterior.
    window.location.replace('/');
  }, []);

  const ingresarConFaceId = useCallback(async () => {
    if (enCurso.current) return;
    enCurso.current = true;
    setError('');
    setEsperandoFaceId(true);
    try {
      await accederConPasskey(opciones.current);
      entrar();
    } catch (err) {
      if (!esCancelacion(err)) setError(err instanceof Error ? err.message : 'No se pudo usar Face ID');
      // Cancelado o frenado por falta de toque: desde ahora, un toque en
      // cualquier parte vuelve a intentar.
      setTocarParaEscanear(true);
      setEsperandoFaceId(false);
      enCurso.current = false;
      precargar(); // un POST fallido consume el reto
    }
  }, [entrar, precargar]);

  useEffect(() => {
    // Leído del window y no con useSearchParams, que obligaría a envolver la
    // página en un Suspense solo por este flag.
    const esBloqueo = new URLSearchParams(window.location.search).get('bloqueado') === '1';
    let vivo = true;
    (async () => {
      const disponible = await hayFaceId();
      if (!vivo) return;
      setFaceId(disponible);
      if (disponible && (esBloqueo || usaFaceId() || !conContrasena)) {
        setBloqueado(esBloqueo);
        setConPassword(false);
        precargar();
        await cuandoTengaFoco();
        if (vivo) void ingresarConFaceId();
      } else if (conContrasena) {
        userRef.current?.focus();
      } else {
        precargar();
      }
    })();
    return () => { vivo = false; };
  }, [ingresarConFaceId, precargar, conContrasena]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user, pass }),
      });

      if (res.ok) {
        entrar();
      } else if (!(res.headers.get('content-type') ?? '').includes('application/json')) {
        // El firewall de Vercel limita los intentos por IP y responde 403 o 429
        // con una página propia (no JSON): sin este caso, res.json() falla y se
        // mostraría "Error de conexión". Un 403 en JSON es otra cosa: la
        // contraseña está apagada, y el mensaje viene en el cuerpo.
        setError('Demasiados intentos. Esperá un minuto y volvé a probar.');
      } else {
        const data = await res.json();
        setError(data.error ?? 'Error al iniciar sesión');
      }
    } catch {
      setError('Error de conexión');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className="login-root"
      // Sin formulario a la vista, toda la pantalla es el botón de Face ID: si
      // Safari no lo abrió solo, cualquier toque lo abre.
      onClick={!conPassword && faceId ? () => void ingresarConFaceId() : undefined}
    >
      <div className="login-card">
        {/* El ícono de la app (app/icon.svg), como en el inicio de sesión de iOS. */}
        {/* eslint-disable-next-line @next/next/no-img-element -- SVG estático: next/image no lo optimiza */}
        <img className="login-logo" src="/icon.svg" alt="" width={64} height={64} />

        <h1 className="login-title">{bloqueado ? 'Portfolio bloqueado' : 'Portfolio'}</h1>
        <p className="login-subtitle">
          {!conPassword && faceId && tocarParaEscanear
            ? 'Tocá la pantalla para usar Face ID.'
            : bloqueado ? 'Desbloqueá con Face ID para seguir.' : 'Ingresá para ver tu cartera.'}
        </p>

        {(faceId || !conContrasena) && (
          <button
            type="button"
            onClick={ingresarConFaceId}
            disabled={esperandoFaceId}
            className={`login-submit login-faceid${esperandoFaceId ? ' login-submit--disabled' : ''}`}
          >
            {esperandoFaceId
              ? <span className="login-spinner" />
              : faceId
                ? <><IconFaceId /> {bloqueado ? 'Desbloquear con Face ID' : 'Ingresar con Face ID'}</>
                : 'Ingresar con passkey'}
          </button>
        )}

        {conContrasena && faceId && !conPassword && (
          <button
            type="button"
            className="login-link"
            onClick={(e) => { e.stopPropagation(); setConPassword(true); }}
          >
            Usar contraseña
          </button>
        )}

        {faceId && conPassword && <div className="login-separador"><span>o con contraseña</span></div>}

        {/* El error del Face ID se muestra acá cuando el formulario está oculto. */}
        {!conPassword && error && <div className="login-error" style={{ marginTop: 14, textAlign: 'left' }}>{error}</div>}

        {conPassword && <form onSubmit={handleSubmit} className="login-form" autoComplete="off">
          <div className="login-field-group">
            <label className="login-label" htmlFor="user">Usuario</label>
            <div className="login-input-wrapper">
              <span className="login-input-icon">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                  <circle cx="12" cy="7" r="4" />
                </svg>
              </span>
              <input
                id="user"
                ref={userRef}
                type="text"
                value={user}
                onChange={(e) => setUser(e.target.value)}
                placeholder="usuario"
                className="login-input"
                autoComplete="username"
                spellCheck={false}
              />
            </div>
          </div>

          <div className="login-field-group">
            <label className="login-label" htmlFor="pass">Contraseña</label>
            <div className="login-input-wrapper">
              <span className="login-input-icon">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                  <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                </svg>
              </span>
              <input
                id="pass"
                type={showPass ? 'text' : 'password'}
                value={pass}
                onChange={(e) => setPass(e.target.value)}
                placeholder="••••••"
                className="login-input login-input--pass"
                autoComplete="current-password"
              />
              <button
                type="button"
                onClick={() => setShowPass((v) => !v)}
                className="login-eye-btn"
                tabIndex={-1}
                aria-label={showPass ? 'Ocultar contraseña' : 'Mostrar contraseña'}
              >
                {showPass ? (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
                    <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
                    <line x1="1" y1="1" x2="23" y2="23" />
                  </svg>
                ) : (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                )}
              </button>
            </div>
          </div>

          {error && (
            <div className="login-error">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading || !user || !pass}
            className={`login-submit${loading || !user || !pass ? ' login-submit--disabled' : ''}`}
          >
            {loading ? (
              <span className="login-spinner" />
            ) : (
              <>
                Ingresar
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="5" y1="12" x2="19" y2="12" />
                  <polyline points="12 5 19 12 12 19" />
                </svg>
              </>
            )}
          </button>
        </form>}

        <p className="login-footer">Dashboard personal de inversiones</p>
      </div>
    </div>
  );
}
