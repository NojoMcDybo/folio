/**
 * Erkennt in Text Internetadressen, E-Mail-Adressen und Telefonnummern. Reine Funktion, damit sie
 * fuer den normalen Textlayer, die Texterkennung (OCR) und das Kontextmenue dieselbe ist.
 */

export type EntityType = "url" | "email" | "phone";

export type Entity = { type: EntityType; text: string; start: number; end: number; href: string };

const URL_RE = /\b(?:https?:\/\/|www\.)[^\s<>"'«»]+/giu;
const EMAIL_RE = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)*\.\p{L}{2,}/giu;
const PHONE_RE = /(?<![\p{L}\p{N}@./])(?:\+|00)?\(?\d[\d\s()./-]{5,}\d(?![\p{L}\p{N}])/gu;

/** Satzzeichen, die zum Satz und nicht zur Adresse gehoeren. */
function trimUrl(raw: string): string {
  let s = raw;
  for (;;) {
    const last = s[s.length - 1];
    if (/[.,;:!?'"»]/.test(last)) s = s.slice(0, -1);
    else if (last === ")" && (s.match(/\(/g)?.length ?? 0) < (s.match(/\)/g)?.length ?? 0)) s = s.slice(0, -1);
    else if (last === "]" && (s.match(/\[/g)?.length ?? 0) < (s.match(/\]/g)?.length ?? 0)) s = s.slice(0, -1);
    else return s;
  }
}

/** Die Ziffern einer Nummer; "00" am Anfang wird zu "+". */
export function phoneDigits(text: string): string {
  const plus = /^\s*(?:\+|00)/.test(text);
  const digits = text.replace(/\D/g, "").replace(/^00/, "");
  return (plus ? "+" : "") + digits;
}

function plausiblePhone(text: string): boolean {
  const t = text.trim();
  const digits = t.replace(/\D/g, "");
  if (digits.length < 7 || digits.length > 15) return false;
  // Datum, Dezimalzahl, Versionsnummer, ISBN
  if (/^\d{1,2}[./-]\d{1,2}[./-]\d{2,4}$/.test(t)) return false;
  if (/^\d+[.,]\d+$/.test(t)) return false;
  if (/^\d+(\.\d+){2,}$/.test(t) && !t.startsWith("0")) return false;
  if (/^97[89]/.test(digits) && digits.length === 13) return false;
  const international = /^(?:\+|00)/.test(t);
  const national = /^0\d/.test(t) || /^\(0?\d/.test(t);
  const grouped = /[\s()./-]/.test(t);
  // Eine blosse Ziffernfolge ohne Vorwahlzeichen ist meist eine Nummer (Rechnung, Konto), kein Anschluss.
  return international || (national && (grouped || digits.length >= 10));
}

export function detectEntities(text: string): Entity[] {
  const found: Entity[] = [];
  for (const m of text.matchAll(URL_RE)) {
    const t = trimUrl(m[0]);
    if (t.length < 6) continue;
    found.push({ type: "url", text: t, start: m.index!, end: m.index! + t.length, href: /^www\./i.test(t) ? "https://" + t : t });
  }
  for (const m of text.matchAll(EMAIL_RE)) {
    found.push({ type: "email", text: m[0], start: m.index!, end: m.index! + m[0].length, href: "mailto:" + m[0] });
  }
  for (const m of text.matchAll(PHONE_RE)) {
    const t = m[0].replace(/[\s.,/-]+$/, "");
    if (!plausiblePhone(t)) continue;
    found.push({ type: "phone", text: t, start: m.index!, end: m.index! + t.length, href: "tel:" + phoneDigits(t) });
  }
  // Ueberlappungen: Adressen vor Telefonnummern (in einer URL stehen oft Ziffern), sonst der fruehere.
  const rank = { url: 0, email: 1, phone: 2 } as const;
  found.sort((a, b) => a.start - b.start || rank[a.type] - rank[b.type]);
  const out: Entity[] = [];
  for (const e of found) {
    const prev = out[out.length - 1];
    if (prev && e.start < prev.end) {
      if (rank[e.type] < rank[prev.type] && e.start <= prev.start) out[out.length - 1] = e;
      continue;
    }
    out.push(e);
  }
  return out;
}

/** Eintrag, der an der Zeichenstelle `index` liegt (Klick/Rechtsklick auf ein Wort). */
export function entityAt(text: string, index: number): Entity | null {
  return detectEntities(text).find((e) => index >= e.start && index <= e.end) ?? null;
}
