// Los tres estados que no son "hay datos": cargando, error y vacío. Antes cada
// sección resolvía los suyos (un "Cargando…" de una línea, un recuadro rojo con
// colores propios) y no había dos iguales. Estilos en globals.css (.skeleton,
// .aviso, .vacio).

interface CargandoProps {
  /** Qué se está cargando: lo lee el lector de pantalla, no se ve. */
  etiqueta: string;
  /** Tarjetas de indicador arriba del bloque, si la sección las tiene. */
  kpis?: number;
  /** Alto del bloque principal (el gráfico o la tabla que viene). */
  alto?: number;
}

/**
 * Skeleton con la forma de lo que va a aparecer. Ocupa el mismo lugar que el
 * contenido: cuando llegan los datos la pestaña no pega un salto.
 */
export function Cargando({ etiqueta, kpis = 0, alto = 260 }: CargandoProps) {
  return (
    <div className="cargando" role="status" aria-label={etiqueta} aria-busy="true">
      {kpis > 0 && (
        <div className="kpi-grid">
          {Array.from({ length: kpis }, (_, i) => (
            <div key={i} className="kpi-card" style={{ gap: 10 }}>
              <span className="skeleton" style={{ width: '45%', height: 12 }} />
              <span className="skeleton" style={{ width: '70%', height: 24 }} />
              <span className="skeleton" style={{ width: '55%', height: 10 }} />
            </div>
          ))}
        </div>
      )}
      <div className="card">
        <span className="skeleton" style={{ width: 160, maxWidth: '60%', height: 14 }} />
        <span className="skeleton" style={{ height: alto, borderRadius: 10 }} />
      </div>
    </div>
  );
}

interface AvisoErrorProps {
  /** Qué falló, en una línea. */
  titulo: string;
  /** El detalle (el mensaje del error) y, si hace falta, qué consecuencia tiene. */
  children?: React.ReactNode;
  onReintentar?: () => void;
}

export function AvisoError({ titulo, children, onReintentar }: AvisoErrorProps) {
  return (
    <div className="aviso error" role="alert">
      <p className="aviso-titulo">{titulo}</p>
      {children && <p>{children}</p>}
      {onReintentar && (
        <button type="button" className="g-btn chico" onClick={onReintentar}>Reintentar</button>
      )}
    </div>
  );
}

interface VacioProps {
  titulo?: string;
  children: React.ReactNode;
  /** Dentro de una tarjeta propia (por defecto) o suelto, si ya está en una. */
  suelto?: boolean;
}

export function Vacio({ titulo, children, suelto = false }: VacioProps) {
  return (
    <div className={suelto ? 'vacio' : 'card vacio'}>
      {titulo && <strong>{titulo}</strong>}
      {children}
    </div>
  );
}
