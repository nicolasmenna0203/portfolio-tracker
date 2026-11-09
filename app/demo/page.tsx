import { buildDemoDashboardData } from '@/lib/demo/dashboardData';
import Dashboard from '@/components/Dashboard';

// Página pública de demostración: arma un DashboardData 100% sintético (ver
// lib/demo/dashboardData.ts) y renderiza el mismo <Dashboard> que usa la app
// real, sin login ni acceso a Google Sheets. Los hooks/componentes que hacen
// fetch desde el cliente (lib/useFx.ts, etc.) detectan el pathname `/demo` y
// apuntan a /api/demo/* en vez de /api/* — ver esos archivos.
//
// Los montos van siempre ocultos (`valoresSiempreOcultos`): aunque sean
// sintéticos, la demo es pública y se muestra la forma, no las cifras.
export const dynamic = 'force-static';

export default function DemoPage() {
  const data = buildDemoDashboardData();

  return (
    <>
      {/* Una línea discreta, no una franja: avisa sin competir con el contenido. */}
      <div
        role="note"
        style={{
          flexShrink: 0,
          padding: 'calc(6px + env(safe-area-inset-top)) 16px 6px',
          background: 'var(--primary-dim)',
          color: 'var(--primary)',
          fontSize: 12,
          fontWeight: 600,
          textAlign: 'center',
        }}
      >
        Demo con datos ficticios y montos ocultos
      </div>
      <Dashboard data={data} valoresSiempreOcultos />
    </>
  );
}
