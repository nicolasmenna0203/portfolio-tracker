'use client';

import { useEffect, useState } from 'react';
import { hayFaceId, registrarPasskey, esCancelacion } from '@/lib/passkeyCliente';

// Activa el bloqueo con Face ID en este dispositivo: registra una passkey y,
// desde ahí, la app pide Face ID cada vez que se abre.
// Ver docs/decisiones/0035-bloqueo-con-passkey-en-cada-apertura.md
//
// No se muestra donde no hay autenticador del dispositivo, ni en /demo (el
// panel que lo contiene decide eso).

// `confianza`: compu recordada 30 días sin bloqueo (docs/decisiones/0038-compu-de-confianza.md).
// Activar Face ID ahí la pasa a pedirlo en cada apertura.
type Estado = 'cargando' | 'no-disponible' | 'inactivo' | 'confianza' | 'registrando' | 'activo';

export default function FaceIdAjuste() {
  const [estado, setEstado] = useState<Estado>('cargando');
  const [error, setError] = useState('');

  useEffect(() => {
    let vivo = true;
    (async () => {
      if (!(await hayFaceId())) {
        if (vivo) setEstado('no-disponible');
        return;
      }
      try {
        const res = await fetch('/api/auth/sesion', { cache: 'no-store' });
        const data = res.ok ? ((await res.json()) as { bloqueo?: boolean; confianza?: boolean }) : {};
        if (vivo) setEstado(data.bloqueo ? 'activo' : data.confianza ? 'confianza' : 'inactivo');
      } catch {
        if (vivo) setEstado('inactivo');
      }
    })();
    return () => { vivo = false; };
  }, []);

  if (estado === 'cargando' || estado === 'no-disponible') return null;

  async function activar() {
    const antes = estado;
    setError('');
    setEstado('registrando');
    try {
      await registrarPasskey();
      setEstado('activo');
      window.dispatchEvent(new Event('faceid-activado'));
    } catch (err) {
      setEstado(antes);
      if (err instanceof DOMException && err.name === 'InvalidStateError') {
        setError('Este dispositivo ya tiene una passkey registrada. Entrá con Face ID desde el inicio de sesión para activar el bloqueo.');
      } else if (!esCancelacion(err)) {
        setError(err instanceof Error ? err.message : 'No se pudo activar Face ID');
      }
    }
  }

  return (
    <div style={{
      background: 'var(--card)', borderRadius: 'var(--radio-card)', padding: '20px 24px',
      display: 'flex', flexDirection: 'column', gap: 12,
    }}>
      <div>
        <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--primary)', marginBottom: 3 }}>
          Seguridad
        </p>
        <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', margin: 0 }}>
          Bloqueo con Face ID
        </p>
        <p className="card-sub" style={{ marginTop: 4 }}>
          {estado === 'activo'
            ? 'Activo en este dispositivo: la app pide Face ID cada vez que se abre, o al volver después de un par de minutos.'
            : estado === 'confianza'
              ? 'Esta compu está recordada: no pide la passkey por 30 días desde que entraste. Activarlo la pasa a pedir Face ID (o Windows Hello) cada vez que se abre.'
              : 'Pide Face ID (o Touch ID) cada vez que abrís la app en este dispositivo.'}
        </p>
      </div>

      {estado === 'activo' ? (
        <p style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 600, color: 'var(--up)', margin: 0 }}>
          <span aria-hidden="true">✓</span> Activado
        </p>
      ) : (
        <button
          type="button"
          className="g-btn primario"
          onClick={activar}
          disabled={estado === 'registrando'}
          style={{ alignSelf: 'flex-start', minHeight: 44, padding: '0 20px' }}
        >
          {estado === 'registrando' ? 'Esperando Face ID…' : 'Activar Face ID'}
        </button>
      )}

      {error && <p className="nota" role="alert" style={{ color: 'var(--down)' }}>{error}</p>}
    </div>
  );
}
