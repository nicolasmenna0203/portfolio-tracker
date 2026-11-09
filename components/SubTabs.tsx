'use client';

// Sub-pestañas: el segundo nivel de navegación de una pestaña (Tenencias,
// Performance, Finanzas). Va siempre como primera fila del contenido, por encima
// de los controles de la vista elegida, que dependen de ella y por eso van en
// la variante chica del mismo control.

import Segmented from './Segmented';

interface Props<T extends string> {
  tabs: readonly { id: T; label: string; corto?: string }[];
  activa: T;
  onChange: (id: T) => void;
}

export default function SubTabs<T extends string>({ tabs, activa, onChange }: Props<T>) {
  return <Segmented opciones={tabs} activa={activa} onChange={onChange} etiqueta="Vistas" className="sub-tabs" />;
}
