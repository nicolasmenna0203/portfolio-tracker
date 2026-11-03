// Decisión y alternativas descartadas: docs/decisiones/0016-perfil-inversor-como-memoria-del-asesor.md
//
// ── Perfil del inversor: memoria persistente del asesor ─────────────────────
//
// El MCP ya da los datos de la cartera, pero no el marco para interpretarlos:
// objetivo, criterios de venta, postura sobre el riesgo argentino. Sin eso el
// análisis es genérico y hay que re-explicarlo en cada conversación.
//
// Ese marco vive en PERFIL-INVERSOR.md, en la raíz del proyecto y FUERA del
// repositorio (está en .gitignore: el repo es público y esto es perfil
// personal). Se lee en cada consulta — sin cache — porque el archivo lo puede
// editar el usuario a mano en cualquier momento y una respuesta basada en una
// versión vieja sería peor que no tener perfil.
//
// La escritura está acotada a propósito al log de decisiones (append al final,
// formato fijo). Registrar cualquier cosa que el usuario diga llenaría el
// archivo de observaciones de conversación —"le preocupa la concentración"—
// que no son criterios permanentes y que, acumuladas, hacen ilegible lo que sí
// importa. Nada reescribe ni borra las secciones de criterios: eso lo edita
// solo el usuario.

import { readFile, appendFile, access } from 'node:fs/promises';
import { join } from 'node:path';

const ARCHIVO = 'PERFIL-INVERSOR.md';

/** Ruta absoluta al perfil. La raíz del proyecto es el cwd del server MCP. */
function rutaPerfil(): string {
  return join(process.cwd(), ARCHIVO);
}

export interface PerfilInversor {
  existe: boolean;
  contenido?: string;
  /** Guía para el modelo sobre cómo usar lo que acaba de leer. */
  comoUsarlo?: string;
  error?: string;
}

/**
 * Lee el perfil completo. Si el archivo no existe devuelve `existe: false` con
 * una explicación, en vez de un error: es un estado válido (todavía no se creó)
 * y el modelo tiene que poder seguir respondiendo sin él.
 */
export async function leerPerfil(): Promise<PerfilInversor> {
  const ruta = rutaPerfil();
  try {
    await access(ruta);
  } catch {
    return {
      existe: false,
      error:
        `No hay ${ARCHIVO} en la raíz del proyecto. El análisis va a ser genérico: ` +
        'no hay objetivo, criterios de venta ni tesis registradas. Vale avisarlo ' +
        'antes de dar una lectura interpretativa.',
    };
  }

  try {
    const contenido = await readFile(ruta, 'utf-8');
    return {
      existe: true,
      contenido,
      comoUsarlo:
        'Este es el marco para interpretar los datos, no datos en sí. Cada sección ' +
        'termina en una implicancia concreta para el análisis: seguila. Si una ' +
        'recomendación tuya contradice un criterio de acá, decilo explícitamente en ' +
        'vez de ignorarlo. Las "preguntas abiertas" son huecos conocidos: si la ' +
        'consulta toca alguno, señalá que falta definirlo.',
    };
  } catch (err) {
    return {
      existe: false,
      error: `No se pudo leer ${ARCHIVO}: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

export interface EntradaLog {
  decision: string;
  razonamiento: string;
  queLaInvalidaria: string;
}

export interface ResultadoRegistro {
  ok: boolean;
  entrada?: string;
  aviso?: string;
  error?: string;
}

/**
 * Agrega una entrada al log de decisiones, al final del archivo.
 *
 * Los tres campos son obligatorios y el motivo es el filtro: si no se puede
 * articular qué invalidaría la decisión, probablemente sea una observación de
 * conversación y no un criterio que valga la pena preservar.
 */
export async function registrarDecision(entrada: EntradaLog): Promise<ResultadoRegistro> {
  const decision = entrada.decision?.trim();
  const razonamiento = entrada.razonamiento?.trim();
  const queLaInvalidaria = entrada.queLaInvalidaria?.trim();

  if (!decision || !razonamiento || !queLaInvalidaria) {
    return {
      ok: false,
      error:
        'Faltan campos. Los tres son obligatorios: decision, razonamiento y ' +
        'queLaInvalidaria. Si no se puede completar el tercero, esto no es una ' +
        'decisión registrable sino una observación de la conversación — no la registres.',
    };
  }

  const ruta = rutaPerfil();
  try {
    await access(ruta);
  } catch {
    return {
      ok: false,
      error: `No existe ${ARCHIVO} en la raíz del proyecto, no hay dónde registrar.`,
    };
  }

  const fecha = new Date().toISOString().slice(0, 10);
  const bloque =
    `\n### ${fecha} — ${decision}\n\n` +
    `**Razonamiento:** ${razonamiento}\n\n` +
    `**Qué la invalidaría:** ${queLaInvalidaria}\n`;

  try {
    await appendFile(ruta, bloque, 'utf-8');
    return {
      ok: true,
      entrada: bloque.trim(),
      aviso:
        `Registrado en ${ARCHIVO} con fecha ${fecha}. Mostrale al usuario exactamente ` +
        'qué se guardó y aclarale que puede editarlo o borrarlo del archivo si no ' +
        'refleja lo que quiso decir.',
    };
  } catch (err) {
    return {
      ok: false,
      error: `No se pudo escribir en ${ARCHIVO}: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
