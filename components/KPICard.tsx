import { useState } from 'react';

interface KPICardProps {
  label: string;
  value: string;
  sub?: string;
  subColor?: string;
  accentColor?: string;
  /** Texto de ayuda mostrado en un popover al hacer click en el ⓘ junto al label. */
  tooltip?: string;
  /** Contenido extra bajo el valor (ej. un selector de período). No hereda el estilo de `sub`. */
  extra?: React.ReactNode;
}

export default function KPICard({ label, value, sub, subColor, accentColor = 'var(--primary)', tooltip, extra }: KPICardProps) {
  const [tooltipAbierto, setTooltipAbierto] = useState(false);
  return (
    <div
      className="kpi-card-mobile"
      style={{
        background: 'var(--card)',
        border: '1px solid var(--border)',
        borderRadius: 12,
        padding: '14px 20px 12px',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        flex: 1,
        minWidth: 0,
        position: 'relative',
        // No overflow:hidden acá: el popover del tooltip (ⓘ) necesita poder
        // salirse del borde de la card. La barra de acento de abajo ya tiene
        // el mismo border-radius que la card, así que no se nota el cambio.
      }}
    >
      <div
        style={{
          position: 'absolute',
          top: 0, left: 0, right: 0,
          height: 2,
          background: `linear-gradient(to right, ${accentColor}, transparent)`,
          borderRadius: '12px 12px 0 0',
        }}
      />

      <div className="kpi-left">
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <p
            className="kpi-label"
            style={{
              fontSize: 10,
              fontWeight: 600,
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
              color: 'var(--muted)',
              margin: 0,
            }}
          >
            {label}
          </p>
          {tooltip && (
            <span style={{ position: 'relative', flexShrink: 0 }}>
              <button
                onClick={() => setTooltipAbierto((v) => !v)}
                onBlur={() => setTooltipAbierto(false)}
                aria-label={`Qué es ${label}`}
                className="kpi-info"
                style={{
                  width: 14, height: 14, borderRadius: '50%', border: '1px solid var(--border)',
                  background: 'transparent', color: 'var(--muted)', fontSize: 9, lineHeight: 1,
                  cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  padding: 0, position: 'relative',
                }}
              >
                ⓘ
              </button>
              {/* `maxWidth` en vw: a 220px fijos el popover de una card de la
                  columna derecha se salía de la pantalla en mobile y la parte
                  final del texto quedaba inalcanzable (el body no scrollea en
                  horizontal). Con el tope por viewport se angosta solo. */}
              {tooltipAbierto && (
                <div style={{
                  position: 'absolute', top: 18, left: 0, zIndex: 10,
                  width: 220, maxWidth: 'min(220px, calc(100vw - 48px))',
                  background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 8,
                  padding: '8px 10px', fontSize: 11, lineHeight: 1.45, color: 'var(--text-sec)',
                  boxShadow: '0 8px 32px rgba(0,0,0,0.5)', fontWeight: 400, textTransform: 'none',
                  letterSpacing: 'normal',
                }}>
                  {tooltip}
                </div>
              )}
            </span>
          )}
        </div>

        <p
          className="kpi-value"
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 22,
            fontWeight: 600,
            color: 'var(--text)',
            letterSpacing: '-0.01em',
            lineHeight: 1.1,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            margin: '4px 0 0',
          }}
        >
          {value}
        </p>

        {sub && (
          <p
            className="kpi-sub"
            style={{
              fontSize: 11,
              color: subColor ?? 'var(--muted)',
              marginTop: 4,
              marginBottom: 0,
            }}
          >
            {sub}
          </p>
        )}

        {extra}
      </div>
    </div>
  );
}
