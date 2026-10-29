/**
 * Anbindung der Inhaltsverzeichnis-Erkennung an PDF.js: Textstuecke je Seite holen (mit
 * Zwischenspeicher), Schriftgroesse und Position daraus ableiten.
 */

import type { PDFDocumentProxy } from "pdfjs-dist";
import { detectOutline, linesFromItems, type Detected, type Line, type RawItem } from "./toc-detect";

export async function detectDocumentOutline(
  doc: PDFDocumentProxy,
  progress: (fraction: number) => void,
  cancelled: () => boolean,
): Promise<Detected | null> {
  const labels = await doc.getPageLabels().catch(() => null);
  const cache = new Map<number, Line[]>();
  let fetched = 0;
  const pageLines = async (index: number): Promise<Line[]> => {
    const hit = cache.get(index);
    if (hit) return hit;
    const page = await doc.getPage(index + 1);
    const content = await page.getTextContent();
    page.cleanup();
    const items: RawItem[] = [];
    for (const it of content.items) {
      if (!("str" in it)) continue;
      const t = it.transform as number[];
      items.push({ str: it.str, x: t[4], y: t[5], size: Math.hypot(t[0], t[1]) || it.height, width: it.width });
    }
    const lines = linesFromItems(items);
    cache.set(index, lines);
    // Pausen zwischen den Seiten, damit die Oberflaeche nicht einfriert.
    if (++fetched % 8 === 0) await new Promise((r) => setTimeout(r, 0));
    return lines;
  };
  return detectOutline({ numPages: doc.numPages, pageLines, labels, progress, cancelled });
}
