---
numero: NNNN
titulo: Título en presente ("Calcular TIR propia de bonos provinciales")
estado: Aceptada          # Aceptada | Reemplazada por NNNN | Revertida
fecha: YYYY-MM-DD
codigo: lib/archivo.ts    # archivos que materializan la decisión
---

# NNNN — Título

## Contexto

Qué había que resolver y qué restricciones eran reales: datos que no existen,
fuentes que no publican lo necesario, límites del runtime o del plan de hosting.
2-6 frases. Sin narrar el proceso — solo el estado del mundo que forzó la decisión.

## Alternativas descartadas

Una línea por alternativa evaluada, con el motivo concreto del descarte. Si no
hay ninguna, probablemente esto no sea un ADR sino documentación de "cómo
funciona", que va en el README.

- **Nombre** — qué ofrecía y por qué no alcanzó.

## Decisión

Qué se hizo. Si hay constantes, fórmulas o umbrales, van acá con su origen
explícito: dato oficial, calibrado contra un tercero, estimado o arbitrario. La
diferencia importa cuando alguien quiera cambiarlos.

## Consecuencias y límites

Lo que esta decisión hace cierto para siempre, sobre todo lo incómodo: qué queda
mal medido, qué se sobreestima, qué no se puede comparar con qué.

- **Límite:** ...
- **Revisar si:** condición observable que invalidaría la decisión.

---

## Cómo usar esta plantilla

1. Leer el número en `Próximo número` del [índice](README.md).
2. Copiar este archivo a `NNNN-slug-en-espanol.md`. El slug describe la
   **decisión**, no el archivo de código: una decisión puede abarcar varios
   archivos y un archivo puede tener varias decisiones.
3. Llenarlo, agregar la fila al índice e incrementar `Próximo número`.
4. Agregar el comentario-puntero al tope del header de cada archivo listado en
   `codigo:`, para que quien lo abra encuentre el ADR sin buscarlo:
   `// Decisión y alternativas descartadas: docs/decisiones/NNNN-....md`

**Los ADRs no se editan cuando cambiás de opinión.** Se escribe uno nuevo, el
viejo pasa a `estado: Reemplazada por NNNN` y su fila se mueve a "Reemplazadas"
en el índice. Un ADR viejo es historia válida, no un error: por eso no puede
"quedar desactualizado", solo ser reemplazado.

**Recordá que el código se publica.** Nada de tickers de posiciones reales, montos,
nombres de broker/depositario/banco ni perfil personal. Se habla de clases de
activo y de fuentes de datos, no de la cartera. La regla completa está en
[CLAUDE.md](../../CLAUDE.md).
