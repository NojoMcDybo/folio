/**
 * Aktionen auf markiertem Text: Kopieren, Nachschlagen, Uebersetzen, im Web suchen - und was zu
 * einer erkannten Adresse, E-Mail oder Telefonnummer passt. Windows hat kein systemweites
 * "Nachschlagen" wie macOS; die Dienste stehen deshalb hier als Adressen und lassen sich ohne
 * weiteres austauschen.
 */

import type { Entity } from "./detect";
import type { MenuItem } from "./page-menu";

export const LOOKUP_URL = "https://de.wiktionary.org/wiki/";
export const TRANSLATE_URL = "https://www.deepl.com/translator#auto/de/";
export const SEARCH_URL = "https://duckduckgo.com/?q=";

export type TextActions = { open: (url: string) => void; copy: (text: string) => void };

export function cleanSelection(raw: string): string {
  return raw.replace(/\s+/g, " ").trim().slice(0, 500);
}

/** Ein einzelnes Wort, das sich nachschlagen laesst. */
export function lookupWord(text: string): string | null {
  const w = text.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
  return w && !/\s/.test(w) && w.length <= 40 && /\p{L}/u.test(w) ? w : null;
}

export function textMenuItems(selection: string, entity: Entity | null, a: TextActions): MenuItem[] {
  const text = cleanSelection(selection);
  const items: MenuItem[] = [];
  if (entity) {
    if (entity.type === "url") items.push({ label: "Link öffnen", action: () => a.open(entity.href) });
    else if (entity.type === "email") items.push({ label: "E-Mail schreiben …", action: () => a.open(entity.href) });
    else items.push({ label: `Anrufen: ${entity.text}`, action: () => a.open(entity.href) });
    items.push({ label: entity.type === "url" ? "Adresse kopieren" : entity.type === "email" ? "E-Mail-Adresse kopieren" : "Nummer kopieren", action: () => a.copy(entity.text) });
    items.push({ separator: true });
  }
  if (text) {
    items.push({ label: "Kopieren", kbd: "Strg+C", action: () => a.copy(text) });
    const word = lookupWord(text);
    if (word) items.push({ label: `Nachschlagen „${word.length > 22 ? word.slice(0, 21) + "…" : word}“`, action: () => a.open(LOOKUP_URL + encodeURIComponent(word)) });
    items.push({ label: "Übersetzen …", action: () => a.open(TRANSLATE_URL + encodeURIComponent(text)) });
    items.push({ label: "Im Web suchen …", action: () => a.open(SEARCH_URL + encodeURIComponent(text)) });
  }
  return items;
}
