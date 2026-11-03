'use client';

// Sub-pestañas: el segundo nivel de navegación de una pestaña (Tenencias,
// Performance, Finanzas). Va siempre como primera fila del contenido, por encima
// de los controles de la vista elegida, que dependen de ella y por eso son más
// chicos (pills de 11px y peso 600).
//
// `pill-row`: en mobile pasa de 2 filas apiladas a una sola deslizable (ver
// globals.css) — el mismo gesto que la barra de pestañas.

interface Props<T extends string> {
  tabs: readonly { id: T; label: string }[];
  activa: T;
  onChange: (id: T) => void;
}

export default function SubTabs<T extends string>({ tabs, activa, onChange }: Props<T>) {
  return (
    <div className="sub-tabs pill-row" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', flexShrink: 0 }}>
      {tabs.map((t) => {
        const activo = activa === t.id;
        return (
          <button
            key={t.id}
            onClick={() => onChange(t.id)}
            className="pill-touch"
            aria-pressed={activo}
            style={{
              padding: '4px 14px', borderRadius: 20, fontSize: 12, fontWeight: 700,
              cursor: 'pointer', border: '1px solid',
              borderColor: activo ? 'var(--primary)' : 'var(--border)',
              background: activo ? 'var(--primary-dim)' : 'transparent',
              color: activo ? 'var(--primary)' : 'var(--muted)',
            }}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}
