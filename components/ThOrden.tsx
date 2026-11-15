'use client';

// Encabezado de columna que ordena la tabla. Lleva un botón adentro: con el
// `onClick` puesto en el `<th>`, como estaba, no se llegaba con Tab ni se podía
// activar con el teclado, y el lector de pantalla no sabía por qué columna
// estaba ordenada (`aria-sort`). Estilos en globals.css (.th-orden).

interface Props<K extends string> {
  clave: K;
  label: string;
  /** Columna por la que está ordenada la tabla ahora. */
  activa: K;
  desc: boolean;
  onOrden: (clave: K) => void;
  align?: 'left' | 'right';
  /** Aclaración de la columna, como `title`. */
  title?: string;
}

export default function ThOrden<K extends string>({
  clave, label, activa, desc, onOrden, align = 'right', title,
}: Props<K>) {
  const esActiva = activa === clave;
  return (
    <th
      aria-sort={esActiva ? (desc ? 'descending' : 'ascending') : 'none'}
      title={title}
      style={{
        textAlign: align, padding: '10px 12px', fontSize: 12, fontWeight: 600,
        color: esActiva ? 'var(--primary)' : 'var(--muted)', whiteSpace: 'nowrap',
      }}
    >
      <button type="button" className="th-orden" onClick={() => onOrden(clave)}>
        {label}
        {esActiva && <span className="flecha" aria-hidden="true">{desc ? '▼' : '▲'}</span>}
      </button>
    </th>
  );
}
