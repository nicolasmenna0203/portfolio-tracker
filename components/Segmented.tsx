'use client';

// Segmented control de iOS: elegir una opción entre pocas excluyentes
// (sub-pestañas, período, dimensión, unidad). Estilos en globals.css (.seg).
//
// Si las opciones no entran en el ancho, el control scrollea en horizontal en
// vez de partirse en dos renglones: una fila de pills apilada en 2 o 3
// renglones empujaba el contenido real fuera de la primera pantalla en mobile.

interface Props<T extends string> {
  /** `corto`: etiqueta para mobile, cuando la completa no entra en 360px. */
  opciones: readonly { id: T; label: string; corto?: string; title?: string }[];
  activa: T;
  onChange: (id: T) => void;
  /** Un nivel más abajo: controles que dependen de otro selector. */
  chico?: boolean;
  /** Nombre del grupo para lectores de pantalla. */
  etiqueta?: string;
  className?: string;
  style?: React.CSSProperties;
}

export default function Segmented<T extends string>({
  opciones, activa, onChange, chico = false, etiqueta, className, style,
}: Props<T>) {
  return (
    <div
      role="group"
      aria-label={etiqueta}
      className={`seg${chico ? ' seg-chico' : ''}${className ? ` ${className}` : ''}`}
      style={style}
    >
      {opciones.map((o) => (
        <button
          key={o.id}
          type="button"
          className="seg-btn"
          aria-pressed={activa === o.id}
          title={o.title}
          aria-label={o.corto ? o.label : undefined}
          onClick={() => onChange(o.id)}
        >
          {o.corto ? (
            <>
              <span className="seg-largo" aria-hidden="true">{o.label}</span>
              <span className="seg-corto" aria-hidden="true">{o.corto}</span>
            </>
          ) : o.label}
        </button>
      ))}
    </div>
  );
}
