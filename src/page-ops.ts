/**
 * Seitenoperationen als reine Rechnung: welche Seiten wohin, und wie sich dabei Seitenzahlen
 * (Lesezeichen, Leseposition) verschieben. Kein DOM, kein PDF.js - damit testbar.
 *
 * Seitenzahlen nach aussen sind 1-basiert (wie im Reader); die Anweisungen an PDF.js
 * (`extractPages`) arbeiten mit 0-basierten Indizes.
 */

import type { PDFDocumentProxy } from "pdfjs-dist";

export type PageInfo = Parameters<PDFDocumentProxy["extractPages"]>[0][number];

/** Zahlen sortieren, doppelte entfernen, auf 1..count begrenzen. */
export function normalize(pages: number[], count: number): number[] {
  return [...new Set(pages)].filter((p) => Number.isInteger(p) && p >= 1 && p <= count).sort((a, b) => a - b);
}

/** Neue Reihenfolge nach dem Verschieben: `order[neuePosition] = alteSeite0`.
 *  `to` ist die Einfuegestelle in der urspruenglichen Liste (0..count): der Block landet davor. */
export function moveOrder(count: number, moving: number[], to: number): number[] {
  const block = normalize(moving, count).map((p) => p - 1);
  const isMoving = new Set(block);
  const rest = Array.from({ length: count }, (_, i) => i).filter((i) => !isMoving.has(i));
  // Wie viele der unbewegten Seiten liegen vor der Einfuegestelle?
  const insertAt = rest.filter((i) => i < Math.min(Math.max(0, to), count)).length;
  return [...rest.slice(0, insertAt), ...block, ...rest.slice(insertAt)];
}

export const isIdentity = (order: number[]) => order.every((old, pos) => old === pos);

export function reorderInfos(order: number[]): PageInfo[] {
  return order.map((old, pos) => ({ document: null, includePages: [old], pageIndices: [pos] }));
}

export function deleteInfos(pages: number[]): PageInfo[] {
  return [{ document: null, excludePages: pages.map((p) => p - 1) }];
}

export function extractInfos(pages: number[]): PageInfo[] {
  return [{ document: null, includePages: pages.map((p) => p - 1) }];
}

/** Alle Seiten der Dokumente `others` hinter Seite `after` (0 = ganz an den Anfang) einfuegen. */
export function insertInfos(others: Uint8Array[], after: number, count: number): PageInfo[] {
  const infos: PageInfo[] = [{ document: null }];
  let at = Math.min(Math.max(0, after), count) - 1;
  // Jeder Eintrag bekommt `insertAfter` relativ zur Grundfolge; mehrere hintereinander in der
  // Reihenfolge der Dokumente: spaetere landen hinter den frueheren, nicht davor.
  for (const document of others) infos.push({ document, insertAfter: at });
  return infos;
}

/** Abbildung alter Seitenzahlen auf neue (null = Seite gibt es nicht mehr). */
export type PageMap = (oldPage: number) => number | null;

export const identityMap: PageMap = (p) => p;

export function mapAfterDelete(removed: number[]): PageMap {
  const gone = new Set(removed);
  const sorted = [...gone].sort((a, b) => a - b);
  return (p) => (gone.has(p) ? null : p - sorted.filter((r) => r < p).length);
}

export function mapAfterMove(order: number[]): PageMap {
  const to = new Map<number, number>();
  order.forEach((old0, pos) => to.set(old0 + 1, pos + 1));
  return (p) => to.get(p) ?? null;
}

export function mapAfterInsert(after: number, inserted: number): PageMap {
  return (p) => (p > after ? p + inserted : p);
}

/** Welche Seite soll nach einem Loeschen angezeigt werden? Die, die an die Stelle der ersten
 *  geloeschten rutscht, sonst die letzte. */
export function pageAfterDelete(removed: number[], remaining: number): number {
  const first = Math.min(...removed);
  return Math.max(1, Math.min(first, remaining));
}

/** Seitenbereiche fuer Beschriftungen: [1,2,3,7] -> "1–3, 7". */
export function describePages(pages: number[]): string {
  const sorted = normalize(pages, Infinity);
  const parts: string[] = [];
  for (let i = 0; i < sorted.length; ) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++;
    parts.push(j > i + 1 ? `${sorted[i]}–${sorted[j]}` : sorted.slice(i, j + 1).join(", "));
    i = j + 1;
  }
  return parts.join(", ");
}

/** Speichergrenze fuer Rueckgaengig: aelteste Staende fallen heraus, mindestens einer bleibt. */
export function trimStack<T extends { bytes: Uint8Array }>(stack: T[], budget: number, maxSteps: number): T[] {
  let out = stack.slice(-maxSteps);
  let total = out.reduce((n, s) => n + s.bytes.byteLength, 0);
  while (out.length > 1 && total > budget) {
    total -= out[0].bytes.byteLength;
    out = out.slice(1);
  }
  return out;
}
