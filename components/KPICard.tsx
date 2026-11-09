import InfoTip from './InfoTip';

// Tarjeta de un indicador, al estilo de los resúmenes de Salud o Bolsa: label
// chico en gris, la cifra grande en SF Rounded (--font-display) y debajo el
// contexto en el color del signo. El tamaño de cada parte vive en globals.css
// (.kpi-*) porque cambia con el breakpoint y con la posición en la grilla (la
// primera tarjeta es la principal).

interface KPICardProps {
  label: string;
  value: string;
  sub?: string;
  subColor?: string;
  /** Texto de ayuda mostrado en el ⓘ junto al label. */
  tooltip?: string;
  /** Contenido extra bajo el valor (ej. un selector de período). No hereda el estilo de `sub`. */
  extra?: React.ReactNode;
}

export default function KPICard({ label, value, sub, subColor, tooltip, extra }: KPICardProps) {
  return (
    // No overflow:hidden acá: el popover del tooltip (ⓘ) necesita poder
    // salirse del borde de la card.
    <div className="kpi-card">
      <div className="kpi-left">
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <p className="kpi-label">{label}</p>
          {tooltip && <InfoTip label={label}>{tooltip}</InfoTip>}
        </div>

        <p className="kpi-value">{value}</p>

        {sub && (
          <p className="kpi-sub" style={subColor ? { color: subColor } : undefined}>
            {sub}
          </p>
        )}

        {extra}
      </div>
    </div>
  );
}
