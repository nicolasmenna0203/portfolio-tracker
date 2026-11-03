import { formatMesLabel } from '@/lib/parser';
import type { EstadoCargas } from '@/types';
import { IconTenencias, IconMovimientos, IconHaberes } from './HeaderIcons';

const ARCHIVOS = [
  { id: 'tenencias',   label: 'Tenencias',   Icono: IconTenencias   },
  { id: 'movimientos', label: 'Movimientos', Icono: IconMovimientos },
  { id: 'haberes',     label: 'Haberes',     Icono: IconHaberes     },
] as const;

function mesLabel(mes: string): string {
  const [y, m] = mes.split('-').map(Number);
  return formatMesLabel(Date.UTC(y, m - 1, 1));
}

function estadoDe(estado: EstadoCargas | null, id: typeof ARCHIVOS[number]['id']) {
  if (!estado) return 'desconocido';
  return estado[id] ? 'cargado' : 'pendiente';
}

/** Texto del estado completo, para lectores de pantalla. */
export function describirEstadoCargas(estado: EstadoCargas | null): string {
  if (!estado) return 'Estado de los archivos no disponible';
  const partes = ARCHIVOS.map((a) => `${a.label} ${estado[a.id] ? 'cargado' : 'pendiente'}`);
  return `${mesLabel(estado.mes)}: ${partes.join(', ')}`;
}

/** Los tres íconos de la barra superior, dentro del botón de carga. */
export function EstadoCargasIconos({ estado }: { estado: EstadoCargas | null }) {
  return (
    <span className="estado-cargas">
      {ARCHIVOS.map(({ id, label, Icono }) => {
        const e = estadoDe(estado, id);
        return (
          <span
            key={id}
            className="estado-carga"
            data-estado={e}
            title={estado ? `${label} de ${mesLabel(estado.mes)}: ${e}` : `${label}: estado no disponible`}
          >
            <Icono size={16} />
          </span>
        );
      })}
    </span>
  );
}

/**
 * Los mismos íconos con su nombre, en el panel de carga. En el celular no hay
 * tooltip: acá se ve a qué archivo corresponde cada uno.
 */
export function EstadoCargasDetalle({ estado }: { estado: EstadoCargas | null }) {
  if (!estado) return null;
  return (
    <div className="estado-cargas-detalle">
      <span className="estado-cargas-mes">{mesLabel(estado.mes)}</span>
      {ARCHIVOS.map(({ id, label, Icono }) => (
        <span key={id} className="estado-cargas-item">
          <span className="estado-carga" data-estado={estadoDe(estado, id)}>
            <Icono size={16} />
          </span>
          {label}
          <span className="estado-cargas-marca" data-cargado={estado[id]}>
            {estado[id] ? '✓' : 'falta'}
          </span>
        </span>
      ))}
    </div>
  );
}
