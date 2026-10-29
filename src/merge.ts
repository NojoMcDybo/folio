/**
 * PDFs zusammenfuehren: ueber PDF.js' extractPages, das auch Anmerkungen und Ziele mitnimmt.
 */

import * as pdfjsLib from "pdfjs-dist";

/** Haengt die Dokumente in der gegebenen Reihenfolge aneinander. */
export async function mergeBytes(parts: Uint8Array[]): Promise<Uint8Array> {
  if (parts.length < 2) throw new Error("Zum Zusammenführen sind mindestens zwei PDFs nötig.");
  // Kopien: PDF.js darf die Puffer uebernehmen, der Aufrufer behaelt seine Bytes.
  const base = await pdfjsLib.getDocument({ data: parts[0].slice() }).promise;
  try {
    const merged = await base.extractPages([{ document: null }, ...parts.slice(1).map((document) => ({ document: document.slice() }))]);
    if (!merged?.byteLength) throw new Error("PDF.js konnte die Dokumente nicht zusammenführen (beschädigt oder geschützt?).");
    return merged;
  } finally {
    void base.loadingTask.destroy();
  }
}
