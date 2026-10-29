/**
 * Inhaltsverzeichnis erkennen, wenn die PDF keine Lesezeichen mitbringt.
 *
 * Zwei Wege, in dieser Reihenfolge:
 *  1. Ein gedrucktes Inhaltsverzeichnis ("Titel ..... 14") in den ersten Seiten lesen und die
 *     gedruckten Seitenzahlen auf PDF-Seiten abbilden (ueber Seitenbezeichnungen oder, wenn die
 *     fehlen, ueber den Versatz, den die Ueberschriften selbst verraten).
 *  2. Ueberschriften an ihrer Schriftgroesse erkennen: alles deutlich groesser als der
 *     Fliesstext, ohne Kopf- und Fusszeilen.
 * Das Ergebnis ist eine Vermutung; der Aufrufer zeigt sie als "erkannt" an.
 *
 * Reine Logik ohne PDF.js und DOM: die Zeilen kommen ueber `Source.pageLines`.
 */

export type Line = { text: string; x: number; y: number; size: number };

export type DetectedItem = { title: string; page: number; level: number };

export type Detected = { source: "printed" | "headings"; items: DetectedItem[] };

export type Source = {
  numPages: number;
  /** Zeilen einer Seite (0-basiert), von oben nach unten. */
  pageLines: (index: number) => Promise<Line[]>;
  /** PDF.js `getPageLabels()`; null, wenn die PDF keine hat. */
  labels: string[] | null;
  /** Fortschritt 0..1 (optional). */
  progress?: (fraction: number) => void;
  cancelled?: () => boolean;
};

export const norm = (s: string) =>
  s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim();

const stripNumber = (s: string) => s.replace(/^\s*(?:kapitel\s+)?\d+(?:\.\d+)*\.?\s+/i, "");

// ---------- Zeilen aus Textstuecken ----------

export type RawItem = { str: string; x: number; y: number; size: number; width: number };

/** Textstuecke einer Seite zu Zeilen zusammenfassen. Grosse Luecken werden zu "\t" (Tabulator),
 *  damit "Titel <Luecke> 14" auch ohne Fuellpunkte als Verzeichniszeile erkennbar bleibt. */
export function linesFromItems(items: RawItem[]): Line[] {
  const parts = items.filter((i) => i.str.trim() !== "" || i.width > 0);
  parts.sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: { y: number; size: number; items: RawItem[] }[] = [];
  for (const item of parts) {
    const last = lines[lines.length - 1];
    if (last && Math.abs(last.y - item.y) <= Math.max(1.5, 0.45 * Math.max(last.size, item.size))) {
      last.items.push(item);
      last.size = Math.max(last.size, item.size);
    } else {
      lines.push({ y: item.y, size: item.size, items: [item] });
    }
  }
  return lines
    .map((l) => {
      l.items.sort((a, b) => a.x - b.x);
      let text = "";
      let end = l.items[0].x;
      for (const it of l.items) {
        const gap = it.x - end;
        if (text && gap > 2.2 * l.size) text += "\t";
        else if (text && gap > 0.18 * l.size && !text.endsWith(" ") && !it.str.startsWith(" ")) text += " ";
        text += it.str;
        end = it.x + it.width;
      }
      return { text: text.replace(/[ ]+/g, " ").trim(), x: l.items[0].x, y: l.y, size: l.size };
    })
    .filter((l) => l.text !== "");
}

// ---------- Gedrucktes Inhaltsverzeichnis ----------

export type TocEntry = { title: string; printed: string; level: number; x: number };

const LEADER = String.raw`[.·•…](?:\s?[.·•…]){2,}`;
const PAGE = String.raw`(\d{1,4}|[ivxlcdm]{1,7})`;
const RE_LEADER = new RegExp(String.raw`^(.*?\p{L}.*?)\s*${LEADER}\s*${PAGE}$`, "iu");
const RE_TAB = new RegExp(String.raw`^(.*?\p{L}.*?)\s*\t+\s*${PAGE}$`, "iu");
const RE_NUMBERED = /^(\d+(?:\.\d+)*\.?\s+.*?[\p{L})])\s+(\d{1,4})$/u;

/** Eine Zeile des Verzeichnisses: Titel und gedruckte Seitenzahl, oder null. */
export function parseTocLine(text: string): { title: string; printed: string; strict: boolean } | null {
  const t = text.trim();
  for (const [re, strict] of [[RE_LEADER, true], [RE_TAB, true], [RE_NUMBERED, false]] as const) {
    const m = re.exec(t);
    if (!m) continue;
    const title = m[1].replace(/\t+/g, " ").replace(/\s+/g, " ").replace(/[\s.·•…_-]+$/u, "").trim();
    const letters = (title.match(/\p{L}/gu) ?? []).length;
    if (letters < 2 || title.length < 3) continue;
    return { title, printed: m[2], strict };
  }
  return null;
}

function levelOf(title: string): number | null {
  const m = /^(\d+(?:\.\d+)*)\.?\s/.exec(title);
  return m ? m[1].split(".").length : null;
}

/** Eintraege einer Seite, falls sie nach Inhaltsverzeichnis aussieht (sonst leer). */
export function parseTocPage(lines: Line[]): TocEntry[] {
  const entries: Array<TocEntry & { strict: boolean }> = [];
  for (const l of lines) {
    const p = parseTocLine(l.text);
    if (p) entries.push({ title: p.title, printed: p.printed, level: 1, x: l.x, strict: p.strict });
  }
  const strict = entries.filter((e) => e.strict).length;
  if (entries.length < 5 || (strict < 4 && entries.length < 8)) return [];
  // Ebenen: Nummerierung, sonst Einrueckung.
  const numbered = entries.filter((e) => levelOf(e.title) !== null).length;
  if (numbered >= entries.length * 0.6) {
    for (const e of entries) e.level = Math.min(4, levelOf(e.title) ?? 1);
  } else {
    const xs = [...new Set(entries.map((e) => Math.round(e.x / 6)))].sort((a, b) => a - b);
    for (const e of entries) e.level = Math.min(4, xs.indexOf(Math.round(e.x / 6)) + 1);
  }
  return entries.map(({ strict: _s, ...e }) => e);
}

const KEYWORD = /^(inhalts?verzeichnis|inhalt|table of contents|contents|sommaire|índice|indice|obsah|innehåll)$/i;

async function findPrintedToc(src: Source): Promise<{ entries: TocEntry[]; lastPage: number } | null> {
  const scan = Math.min(src.numPages, Math.max(12, Math.ceil(src.numPages * 0.12)), 40);
  const entries: TocEntry[] = [];
  let first = -1;
  let last = -1;
  for (let i = 0; i < scan; i++) {
    if (src.cancelled?.()) return null;
    const lines = await src.pageLines(i);
    const here = parseTocPage(lines);
    const titled = lines.slice(0, 4).some((l) => KEYWORD.test(norm(l.text)));
    if (here.length >= (titled ? 4 : 5)) {
      if (first < 0) first = i;
      // Eine Verzeichnisseite folgt der naechsten; eine Luecke beendet das Verzeichnis.
      if (last >= 0 && i > last + 1) break;
      entries.push(...here);
      last = i;
    } else if (first >= 0 && i > last) {
      break;
    }
  }
  return entries.length >= 5 ? { entries, lastPage: last } : null;
}

/** Gedruckte Seitenzahl -> PDF-Seite (1-basiert). */
async function mapPages(src: Source, entries: TocEntry[], tocLast: number): Promise<Array<number | null> | null> {
  const labels = src.labels;
  const meaningfulLabels = !!labels && labels.some((l, i) => l !== String(i + 1));
  if (meaningfulLabels) {
    const byLabel = new Map<string, number>();
    labels!.forEach((l, i) => { if (!byLabel.has(l.toLowerCase())) byLabel.set(l.toLowerCase(), i + 1); });
    const mapped = entries.map((e) => byLabel.get(e.printed.toLowerCase()) ?? null);
    if (mapped.filter((p) => p !== null).length >= entries.length * 0.7) return mapped;
  }
  const arabic = entries.filter((e) => /^\d+$/.test(e.printed));
  if (arabic.length < 4) return null;
  const titleLines = async (index: number) => (await src.pageLines(index)).map((l) => norm(stripNumber(l.text)));
  const matches = (lines: string[], title: string) => {
    const t = norm(stripNumber(title));
    return t.length >= 4 && lines.some((l) => l === t || (l.length >= 6 && t.startsWith(l)) || (t.length >= 6 && l.startsWith(t)));
  };
  const cache = new Map<number, string[]>();
  const linesAt = async (index: number) => {
    if (index < 0 || index >= src.numPages) return [];
    if (!cache.has(index)) cache.set(index, await titleLines(index));
    return cache.get(index)!;
  };
  // Versatz aus den ersten Eintraegen herleiten: die Seite suchen, auf der der Titel als Zeile steht.
  const horizon = Math.min(src.numPages, tocLast + 90);
  for (const probe of arabic.slice(0, 4)) {
    const printed = Number(probe.printed);
    for (let i = tocLast + 1; i < horizon; i++) {
      if (src.cancelled?.()) return null;
      if (!matches(await linesAt(i), probe.title)) continue;
      const offset = i + 1 - printed;
      // Gegenprobe an weiteren Eintraegen
      const others = arabic.filter((e) => e !== probe).slice(0, 5);
      let hit = 0;
      for (const o of others) if (matches(await linesAt(Number(o.printed) + offset - 1), o.title)) hit++;
      if (hit >= Math.max(1, Math.ceil(others.length / 2))) {
        return entries.map((e) => (/^\d+$/.test(e.printed) ? Number(e.printed) + offset : null))
          .map((p) => (p !== null && p >= 1 && p <= src.numPages ? p : null));
      }
    }
  }
  return null;
}

// ---------- Ueberschriften nach Schriftgroesse ----------

export async function detectHeadings(src: Source): Promise<DetectedItem[] | null> {
  const budget = Math.min(src.numPages, 600);
  const pages: Line[][] = [];
  for (let i = 0; i < budget; i++) {
    if (src.cancelled?.()) return null;
    pages.push(await src.pageLines(i));
    src.progress?.(i / budget);
  }
  // Fliesstextgroesse: die Groesse, die die meisten Zeichen traegt.
  const weight = new Map<number, number>();
  for (const lines of pages) for (const l of lines) {
    const key = Math.round(l.size * 2) / 2;
    weight.set(key, (weight.get(key) ?? 0) + l.text.length);
  }
  if (!weight.size) return null;
  const body = [...weight.entries()].sort((a, b) => b[1] - a[1])[0][0];

  // Kopf- und Fusszeilen: gleicher Text auf vielen Seiten.
  const seen = new Map<string, number>();
  for (const lines of pages) for (const t of new Set(lines.map((l) => norm(l.text).replace(/\d+/g, "#")))) seen.set(t, (seen.get(t) ?? 0) + 1);
  const repeated = (text: string) => (seen.get(norm(text).replace(/\d+/g, "#")) ?? 0) >= Math.max(4, Math.ceil(pages.length * 0.25));

  type Cand = { text: string; page: number; size: number; y: number };
  const cands: Cand[] = [];
  pages.forEach((lines, pageIndex) => {
    let prev: Cand | null = null;
    for (const l of lines) {
      const big = l.size >= body * 1.12 && l.size >= body + 1.2;
      const text = l.text.replace(/\t+/g, " ").trim();
      const letters = (text.match(/\p{L}/gu) ?? []).length;
      const ok = big && letters >= 3 && text.length <= 110 && letters >= text.length * 0.5 && !repeated(text) && !parseTocLine(l.text);
      if (!ok) { prev = null; continue; }
      // Umgebrochene Ueberschrift: gleiche Groesse, direkt darunter -> eine Zeile.
      if (prev && Math.abs(prev.size - l.size) < 0.6 && prev.y - l.y < l.size * 1.8) {
        prev.text += " " + text;
        prev.y = l.y;
        continue;
      }
      prev = { text, page: pageIndex + 1, size: l.size, y: l.y };
      cands.push(prev);
    }
  });
  if (cands.length < 3 || new Set(cands.map((c) => c.page)).size < 2) return null;

  // Ebenen nach Groessenstufen, groesste zuerst.
  const sizes = [...new Set(cands.map((c) => Math.round(c.size * 2) / 2))].sort((a, b) => b - a);
  const tiers: number[] = [];
  for (const s of sizes) if (!tiers.length || tiers[tiers.length - 1] - s > 0.9) tiers.push(s);
  const levelOfSize = (size: number) => {
    let level = 0;
    for (let i = 0; i < tiers.length; i++) if (size >= tiers[i] - 0.9) { level = i; break; }
    return Math.min(4, level + 1);
  };
  const items = cands.slice(0, 400).map((c) => ({ title: c.text, page: c.page, level: levelOfSize(c.size) }));
  // Zu viele Ebenen mit zu wenigen Eintraegen sind Rauschen (Zierschrift, Zitate).
  return items.length >= 3 ? items : null;
}

// ---------- Einstieg ----------

export async function detectOutline(src: Source): Promise<Detected | null> {
  const printed = await findPrintedToc(src);
  if (printed) {
    const pages = await mapPages(src, printed.entries, printed.lastPage);
    if (pages) {
      const items: DetectedItem[] = [];
      printed.entries.forEach((e, i) => { if (pages[i] !== null) items.push({ title: e.title, page: pages[i]!, level: e.level }); });
      if (items.length >= 4) return { source: "printed", items };
    }
  }
  const headings = await detectHeadings(src);
  return headings ? { source: "headings", items: headings } : null;
}
