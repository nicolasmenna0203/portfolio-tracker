import InfoTip from './InfoTip';

interface KPICardProps {
  label: string;
  value: string;
  sub?: string;
  subColor?: string;
  accentColor?: string;
  /** Texto de ayuda mostrado en el ⓘ junto al label. */
  tooltip?: string;
  /** Contenido extra bajo el valor (ej. un selector de período). No hereda el estilo de `sub`. */
  extra?: React.ReactNode;
}

export default function KPICard({ label, value, sub, subColor, accentColor = 'var(--primary)', tooltip, extra }: KPICardProps) {
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
          {tooltip && <InfoTip label={label}>{tooltip}</InfoTip>}
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
