// Lo que se ve mientras el servidor lee el Sheet (app/page.tsx espera a
// `fetchDashboardData`). Sin esto la pantalla quedaba en blanco hasta tener
// todos los datos; con esto Next manda este esqueleto de inmediato y después
// lo reemplaza por el dashboard.
//
// Repite la forma del Resumen —barra, indicadores, gráfico— con las mismas
// clases que el dashboard real, así el cambio de uno al otro no mueve nada.

export default function Loading() {
  return (
    <main
      role="status"
      aria-label="Cargando el dashboard"
      aria-busy="true"
      style={{
        maxWidth: 1280, margin: '0 auto', padding: '16px 24px 20px',
        display: 'flex', flexDirection: 'column', minHeight: 0,
      }}
    >
      <div className="app-bar" style={{ marginBottom: 14 }}>
        <div className="app-bar-marca">
          <span className="skeleton" style={{ width: 150, height: 28 }} />
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, flex: 1, minHeight: 0 }}>
        <span className="skeleton" style={{ width: 260, maxWidth: '80%', height: 32, borderRadius: 9, flexShrink: 0 }} />
        <div className="kpi-grid-resumen">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="kpi-card" style={{ gap: 10 }}>
              <span className="skeleton" style={{ width: '45%', height: 12 }} />
              <span className="skeleton" style={{ width: '70%', height: i === 0 ? 32 : 24 }} />
              <span className="skeleton" style={{ width: '55%', height: 10 }} />
            </div>
          ))}
        </div>
        <div className="card" style={{ flex: 1, minHeight: 280, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <span className="skeleton" style={{ width: 180, maxWidth: '60%', height: 14 }} />
          <span className="skeleton" style={{ flex: 1, borderRadius: 10 }} />
        </div>
      </div>
    </main>
  );
}
