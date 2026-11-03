import { fetchDashboardData } from '@/lib/sheets';
import Dashboard from '@/components/Dashboard';

// Revalidar datos cada 60 segundos. Nota: este cache es por-URL, no por-sesión;
// como el dashboard es de un solo usuario (auth compartida) no filtra datos
// entre cuentas, pero dejaría de ser seguro si en algún momento hay más de un
// usuario con datos propios detrás del mismo login.
export const revalidate = 60;

export default async function Home() {
  let data;
  try {
    data = await fetchDashboardData();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div
          className="rounded-xl p-8 max-w-lg text-center"
          style={{ background: 'var(--card)', border: '1px solid #ef553b' }}
        >
          <p className="text-lg font-semibold mb-2" style={{ color: '#ef553b' }}>
            Error cargando datos
          </p>
          <p style={{ color: 'var(--muted)' }} className="text-sm">
            {msg}
          </p>
        </div>
      </div>
    );
  }

  return <Dashboard data={data} />;
}
