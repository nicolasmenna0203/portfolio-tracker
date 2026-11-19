// Decisión y alternativas descartadas: docs/decisiones/0040-brief-de-noticias-y-fundamentales-escrito-por-una-sesion-programada.md
//
// ── Brief semanal de noticias y fundamentales ───────────────────────────────
//
// El bloque "Lo importante de la semana" del mail del domingo: noticias y
// lectura fundamental de cada activo del plan, en lenguaje llano. No lo
// escribe este código: lo escribe una sesión programada de Claude el sábado
// (investiga en la web y redacta) y lo commitea como `brief.json` en la rama
// `datos-semanales` del repo privado, que no se publica ni se deploya. El
// workflow del domingo lo lee con el token del propio repo y lo manda en el
// cuerpo del POST al job (app/api/alertas/semanal/route.ts). El dashboard no
// llama a ninguna API de modelos ni necesita credenciales nuevas.
//
// Se incluye solo si es de esta semana: un brief viejo es peor que ninguno,
// porque se leería como noticia actual.
//
// Todo lo que viene en el JSON es texto que escribió un modelo con datos de la
// web: se valida la forma, se recortan los largos y se escapa al renderizar.
// Los links solo pasan si son http(s).

/** Un brief de más días que esto no se incluye: es de otra semana. */
const DIAS_VIGENCIA = 4;

const MAX_RESUMEN = 900;
const MAX_CAMPO = 500;
const MAX_ACTIVOS = 25;
const MAX_FUENTES = 3;
const MAX_VIGILAR = 6;

export interface FuenteBrief {
  titulo: string;
  url: string;
}

export interface ActivoBrief {
  ticker: string;
  /** Rol en el plan, tal como lo escribió la sesión (CORE, SATELITE, ...). */
  rol: string;
  /** Qué pasó en la semana (noticia o dato). */
  noticia: string;
  /** Lectura de valuación / resultados, si la hubo. */
  fundamentales: string;
  /** Qué significa para el plan. */
  lectura: string;
  fuentes: FuenteBrief[];
}

export interface BriefSemanal {
  fecha: string; // YYYY-MM-DD
  resumen: string;
  activos: ActivoBrief[];
  /** Eventos de la semana entrante a tener en cuenta (balances, Fed...). */
  aVigilar: string[];
}

function texto(v: unknown, max: number): string {
  if (typeof v !== 'string') return '';
  const t = v.replace(/\s+/g, ' ').trim();
  return t.length > max ? t.slice(0, max - 1).trimEnd() + '…' : t;
}

function urlValida(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  try {
    const u = new URL(v.trim());
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null;
  } catch {
    return null;
  }
}

/**
 * JSON crudo → brief validado. Devuelve null si no tiene la forma mínima
 * (fecha válida y al menos un resumen o un activo). Los campos de más se
 * ignoran y los de menos quedan vacíos: el modelo puede variar la forma.
 */
export function parsearBrief(raw: unknown): BriefSemanal | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const fecha = typeof o.fecha === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(o.fecha) ? o.fecha : null;
  if (!fecha) return null;

  const activos: ActivoBrief[] = (Array.isArray(o.activos) ? o.activos : [])
    .slice(0, MAX_ACTIVOS)
    .map((a): ActivoBrief | null => {
      if (!a || typeof a !== 'object') return null;
      const x = a as Record<string, unknown>;
      const ticker = texto(x.ticker, 20).toUpperCase();
      if (!ticker) return null;
      const fuentes = (Array.isArray(x.fuentes) ? x.fuentes : [])
        .map((f): FuenteBrief | null => {
          if (!f || typeof f !== 'object') return null;
          const url = urlValida((f as Record<string, unknown>).url);
          if (!url) return null;
          return { titulo: texto((f as Record<string, unknown>).titulo, 120) || new URL(url).hostname, url };
        })
        .filter((f): f is FuenteBrief => f != null)
        .slice(0, MAX_FUENTES);
      const item = {
        ticker,
        rol: texto(x.rol, 20).toUpperCase(),
        noticia: texto(x.noticia, MAX_CAMPO),
        fundamentales: texto(x.fundamentales, MAX_CAMPO),
        lectura: texto(x.lectura, MAX_CAMPO),
        fuentes,
      };
      return item.noticia || item.fundamentales || item.lectura ? item : null;
    })
    .filter((a): a is ActivoBrief => a != null);

  const resumen = texto(o.resumen, MAX_RESUMEN);
  if (!resumen && activos.length === 0) return null;

  const aVigilar = (Array.isArray(o.a_vigilar) ? o.a_vigilar : [])
    .map((v) => texto(v, 200))
    .filter(Boolean)
    .slice(0, MAX_VIGILAR);

  return { fecha, resumen, activos, aVigilar };
}

/** ¿El brief es de esta semana respecto de `ahora`? */
export function briefVigente(b: BriefSemanal, ahora: Date): boolean {
  const dias = (ahora.getTime() - Date.parse(b.fecha + 'T00:00:00Z')) / 86_400_000;
  return dias >= -1 && dias <= DIAS_VIGENCIA;
}

/**
 * Lo que llega en el cuerpo del POST → brief listo para el mail, o null si no
 * vino, no tiene la forma esperada o es de otra semana.
 */
export function briefDesdePayload(raw: unknown, ahora = new Date()): BriefSemanal | null {
  const brief = parsearBrief(raw);
  return brief && briefVigente(brief, ahora) ? brief : null;
}
