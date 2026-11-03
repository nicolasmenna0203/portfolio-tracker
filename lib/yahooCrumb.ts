// Decisión y alternativas descartadas: docs/decisiones/0008-yahoo-cookie-crumb-y-yield-desde-chart.md
//
// Cookie + "crumb" que exigen los endpoints quoteSummary de Yahoo Finance.
// Compartido por lib/yahooEarnings.ts y lib/yahooFundamentals.ts para no
// reimplementar el mecanismo dos veces.

export const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

let crumbCache: { crumb: string; cookie: string; ts: number } | null = null;
const CRUMB_TTL = 30 * 60 * 1000; // 30 min

/** Obtiene (y cachea) el par cookie+crumb necesario para quoteSummary. */
export async function getCrumb(): Promise<{ crumb: string; cookie: string } | null> {
  if (crumbCache && Date.now() - crumbCache.ts < CRUMB_TTL) {
    return { crumb: crumbCache.crumb, cookie: crumbCache.cookie };
  }
  try {
    // fc.yahoo.com responde 404 pero igual devuelve las cookies A1/A3 en Set-Cookie.
    const resCookie = await fetch('https://fc.yahoo.com', {
      headers: { 'User-Agent': UA },
      signal: AbortSignal.timeout(8000),
    });
    const setCookie = resCookie.headers.get('set-cookie') ?? '';
    const cookie = setCookie.split(',').map((c) => c.split(';')[0].trim()).filter(Boolean).join('; ');
    if (!cookie) return null;

    const resCrumb = await fetch('https://query1.finance.yahoo.com/v1/test/getcrumb', {
      headers: { 'User-Agent': UA, Cookie: cookie },
      signal: AbortSignal.timeout(8000),
    });
    const crumb = (await resCrumb.text()).trim();
    if (!crumb || crumb.includes('<')) return null;

    crumbCache = { crumb, cookie, ts: Date.now() };
    return { crumb, cookie };
  } catch {
    return null;
  }
}
