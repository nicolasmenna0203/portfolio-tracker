'use client';

// Pestaña Brief: el brief de noticias y fundamentales de cada semana, el mismo
// que va en el mail del domingo, con el historial de las semanas anteriores.
// Lo guarda el job del domingo en la hoja Briefs (lib/briefsGuardados.ts);
// acá solo se lee. Decisión: docs/decisiones/0041-historial-de-briefs-en-el-sheet.md
//
// El texto lo escribió un modelo con datos de la web: React escapa todo y los
// links ya vienen filtrados a http(s) por parsearBrief.

import { useEffect, useMemo, useState } from 'react';
import { usePathname } from 'next/navigation';
import type { BriefSemanal } from '@/lib/briefSemanal';
import { Cargando, AvisoError, Vacio } from './Estados';

// Rol en el plan → etiqueta y color. El color va en el punto, nunca en el
// texto (misma regla que .chip en globals.css). Un rol desconocido se muestra
// tal cual, en gris.
const ROLES: Record<string, { label: string; color: string }> = {
  CORE:       { label: 'Núcleo',              color: 'var(--up)' },
  SATELITE:   { label: 'Satélite',            color: 'var(--warn)' },
  LEGADO:     { label: 'Satélite con salida', color: 'color-mix(in srgb, var(--warn) 55%, var(--down))' },
  CONSOLIDAR: { label: 'A consolidar',        color: 'var(--muted)' },
  RADAR:      { label: 'Radar',               color: 'color-mix(in srgb, var(--primary) 55%, var(--down))' },
};
const ORDEN_ROLES = Object.keys(ROLES);

function rolDe(rol: string) {
  return ROLES[rol] ?? { label: rol || 'Sin rol', color: 'var(--muted)' };
}

/** "2026-11-21" → "21/11/2026". */
function fechaCorta(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

export default function BriefTab() {
  const pathname = usePathname();
  const apiBase = pathname?.startsWith('/demo') ? '/api/demo' : '/api';

  const [briefs, setBriefs] = useState<BriefSemanal[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [intento, setIntento] = useState(0);
  const [indice, setIndice] = useState(0); // 0 = la semana más nueva
  const [filtro, setFiltro] = useState<string>('TODOS');

  useEffect(() => {
    let vivo = true;
    setError(null);
    fetch(`${apiBase}/briefs`)
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j?.error ?? `HTTP ${r.status}`);
        return j.briefs as BriefSemanal[];
      })
      .then((b) => { if (vivo) { setBriefs(b); setIndice(0); } })
      .catch((e) => { if (vivo) setError(e instanceof Error ? e.message : String(e)); });
    return () => { vivo = false; };
  }, [apiBase, intento]);

  const brief = briefs?.[indice] ?? null;

  const roles = useMemo(() => {
    if (!brief) return [];
    const presentes = [...new Set(brief.activos.map((a) => a.rol))];
    return presentes.sort((a, b) => {
      const ia = ORDEN_ROLES.indexOf(a), ib = ORDEN_ROLES.indexOf(b);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    });
  }, [brief]);

  // Al cambiar de semana, un filtro por un rol que esa semana no tiene
  // dejaría la lista vacía sin motivo aparente.
  const filtroEfectivo = filtro !== 'TODOS' && roles.includes(filtro) ? filtro : 'TODOS';
  const activos = brief?.activos.filter((a) => filtroEfectivo === 'TODOS' || a.rol === filtroEfectivo) ?? [];

  if (error) {
    return (
      <AvisoError titulo="No se pudieron leer los briefs" onReintentar={() => setIntento((n) => n + 1)}>
        {error}
      </AvisoError>
    );
  }
  if (!briefs) return <Cargando etiqueta="Cargando el brief" alto={180} />;
  if (!brief) {
    return (
      <Vacio titulo="Todavía no hay briefs guardados">
        <p className="nota">El primero se guarda el domingo, cuando sale el mail semanal con el brief del sábado.</p>
      </Vacio>
    );
  }

  return (
    <div className="brief">
      <div className="brief-cabecera">
        <section className="card brief-resumen" aria-labelledby="brief-titulo">
          <div className="card-cabecera brief-semana">
            <h2 id="brief-titulo" className="card-titulo">
              Semana al {fechaCorta(brief.fecha)}
              {indice === 0 && <span className="dato">la más reciente</span>}
            </h2>
            {briefs.length > 1 && (
              <div className="brief-nav" role="group" aria-label="Elegir semana">
                <button
                  type="button"
                  className="g-btn chico"
                  onClick={() => setIndice((i) => Math.min(i + 1, briefs.length - 1))}
                  disabled={indice >= briefs.length - 1}
                  aria-label="Semana anterior"
                >
                  ‹ Anterior
                </button>
                <select
                  id="brief-semana"
                  className="brief-select"
                  value={indice}
                  onChange={(e) => setIndice(Number(e.target.value))}
                  aria-label="Semana"
                >
                  {briefs.map((b, i) => (
                    <option key={b.fecha} value={i}>{fechaCorta(b.fecha)}</option>
                  ))}
                </select>
                <button
                  type="button"
                  className="g-btn chico"
                  onClick={() => setIndice((i) => Math.max(i - 1, 0))}
                  disabled={indice === 0}
                  aria-label="Semana siguiente"
                >
                  Siguiente ›
                </button>
              </div>
            )}
          </div>
          {brief.resumen && <p className="brief-texto">{brief.resumen}</p>}
        </section>

        {brief.aVigilar.length > 0 && (
          <section className="card brief-vigilar" aria-labelledby="brief-vigilar-titulo">
            <h2 id="brief-vigilar-titulo" className="card-titulo">A vigilar la semana siguiente</h2>
            <ul>
              {brief.aVigilar.map((v, i) => <li key={i}>{v}</li>)}
            </ul>
          </section>
        )}
      </div>

      {roles.length > 1 && (
        <div className="chips scroll-x" role="group" aria-label="Filtrar por rol en el plan">
          <button type="button" className="chip" aria-pressed={filtroEfectivo === 'TODOS'} onClick={() => setFiltro('TODOS')}>
            Todos <strong>{brief.activos.length}</strong>
          </button>
          {roles.map((r) => {
            const { label, color } = rolDe(r);
            return (
              <button
                key={r}
                type="button"
                className="chip"
                aria-pressed={filtroEfectivo === r}
                onClick={() => setFiltro(r)}
                style={{ '--chip-color': color } as React.CSSProperties}
              >
                <span className="chip-punto" aria-hidden="true" />
                {label} <strong>{brief.activos.filter((a) => a.rol === r).length}</strong>
              </button>
            );
          })}
        </div>
      )}

      <div className="brief-activos">
        {activos.map((a, i) => {
          const { label, color } = rolDe(a.rol);
          return (
            <article key={`${a.ticker}-${i}`} className="card brief-activo">
              <header className="brief-activo-cab">
                <span className="brief-ticker">{a.ticker}</span>
                <span className="brief-rol" style={{ '--chip-color': color } as React.CSSProperties}>
                  <span className="chip-punto" aria-hidden="true" />
                  {label}
                </span>
              </header>
              <dl className="brief-filas">
                {a.noticia && (<><dt>Qué pasó</dt><dd>{a.noticia}</dd></>)}
                {a.fundamentales && (<><dt>Números</dt><dd>{a.fundamentales}</dd></>)}
                {a.lectura && (<><dt>Para el plan</dt><dd className="brief-lectura">{a.lectura}</dd></>)}
              </dl>
              {a.fuentes.length > 0 && (
                <p className="brief-fuentes">
                  {a.fuentes.map((f) => (
                    <a key={f.url} href={f.url} target="_blank" rel="noopener noreferrer">{f.titulo}</a>
                  ))}
                </p>
              )}
            </article>
          );
        })}
      </div>

      <p className="nota">
        Lo escribe cada sábado una sesión programada de Claude con noticias públicas, y llega también en el mail del domingo.
        En &quot;Para el plan&quot;, lo que va como &quot;Dato&quot; sale de las fuentes y lo que va como &quot;Lectura&quot; es interpretación.
      </p>
    </div>
  );
}
