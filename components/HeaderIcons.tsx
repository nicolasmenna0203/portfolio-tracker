function Trazo({ size, grosor = 1.5, children }: { size: number; grosor?: number; children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={grosor}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ flexShrink: 0 }}
    >
      {children}
    </svg>
  );
}

export function IconOjo({ size = 18 }: { size?: number }) {
  return (
    <Trazo size={size}>
      <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7z" />
      <circle cx="12" cy="12" r="3" />
    </Trazo>
  );
}

export function IconOjoTachado({ size = 18 }: { size?: number }) {
  return (
    <Trazo size={size}>
      <path d="M3 3l18 18" />
      <path d="M10.6 5.1A10.4 10.4 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.3 4.1" />
      <path d="M6.6 6.6C3.8 8.4 2 12 2 12s3.6 7 10 7c1.9 0 3.6-.6 5-1.5" />
      <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
    </Trazo>
  );
}

export function IconSol({ size = 18 }: { size?: number }) {
  return (
    <Trazo size={size}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </Trazo>
  );
}

export function IconLuna({ size = 18 }: { size?: number }) {
  return (
    <Trazo size={size}>
      <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
    </Trazo>
  );
}

export function IconCargar({ size = 18 }: { size?: number }) {
  return (
    <Trazo size={size}>
      <path d="M12 16V4" />
      <path d="M7 9l5-5 5 5" />
      <path d="M4 20h16" />
    </Trazo>
  );
}

export function IconTenencias({ size = 18 }: { size?: number }) {
  return (
    <Trazo size={size}>
      <rect x="3" y="7" width="18" height="13" rx="2" />
      <path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" />
      <path d="M3 13h18" />
    </Trazo>
  );
}

export function IconMovimientos({ size = 18 }: { size?: number }) {
  return (
    <Trazo size={size}>
      <path d="M4 8h15" />
      <path d="M15 4l4 4-4 4" />
      <path d="M20 16H5" />
      <path d="M9 12l-4 4 4 4" />
    </Trazo>
  );
}

export function IconHaberes({ size = 18 }: { size?: number }) {
  return (
    <Trazo size={size}>
      <rect x="2" y="6" width="20" height="12" rx="2" />
      <circle cx="12" cy="12" r="2.5" />
      <path d="M6 12h.01M18 12h.01" />
    </Trazo>
  );
}

// ── Secciones (tab bar de mobile) ─────────────────────────────────────────────
// Mismo trazo que el resto, un poco más grueso: a 24px en la tab bar, el 1.5
// de los íconos de acción se lee desvaído al lado de la etiqueta.

export function IconSeccionResumen({ size = 24 }: { size?: number }) {
  return (
    <Trazo size={size} grosor={1.7}>
      <path d="M3 17l5-5 4 3 8-8" />
      <path d="M15 7h5v5" />
      <path d="M3 21h18" />
    </Trazo>
  );
}

export function IconSeccionTenencias({ size = 24 }: { size?: number }) {
  return (
    <Trazo size={size} grosor={1.7}>
      <path d="M12 3a9 9 0 1 0 9 9h-9z" />
      <path d="M15 3.5A9 9 0 0 1 20.5 9H15z" />
    </Trazo>
  );
}

export function IconSeccionBenchmarks({ size = 24 }: { size?: number }) {
  return (
    <Trazo size={size} grosor={1.7}>
      <path d="M5 20V10" />
      <path d="M12 20V4" />
      <path d="M19 20v-7" />
    </Trazo>
  );
}

export function IconSeccionCalendario({ size = 24 }: { size?: number }) {
  return (
    <Trazo size={size} grosor={1.7}>
      <rect x="3.5" y="5" width="17" height="15.5" rx="3" />
      <path d="M3.5 10h17" />
      <path d="M8 3v4M16 3v4" />
    </Trazo>
  );
}

export function IconSeccionPerformance({ size = 24 }: { size?: number }) {
  return (
    <Trazo size={size} grosor={1.7}>
      <path d="M4.5 18a8.5 8.5 0 1 1 15 0" />
      <path d="M12 14l4-5" />
      <circle cx="12" cy="14.5" r="1.2" />
    </Trazo>
  );
}

export function IconSeccionFinanzas({ size = 24 }: { size?: number }) {
  return (
    <Trazo size={size} grosor={1.7}>
      <rect x="3" y="6" width="18" height="14" rx="3" />
      <path d="M3 10h18" />
      <path d="M16 15h2" />
      <path d="M6 6l9-3 1.5 3" />
    </Trazo>
  );
}
