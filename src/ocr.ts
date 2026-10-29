/**
 * Texterkennung fuer Seiten ohne eigenen Text (Scans, Fotos): das Folio-Gegenstueck zu
 * "Live Text". Die Seite wird gerendert, vom nativen Teil (Windows.Media.Ocr) gelesen und
 * der Text als unsichtbare, auswaehlbare Ebene ueber die Seite gelegt.
 */

import type { PDFDocumentProxy } from "pdfjs-dist";
import { invoke } from "@tauri-apps/api/core";
import { detectEntities } from "./detect";

export type OcrWord = { text: string; x: number; y: number; w: number; h: number };
export type OcrLine = { text: string; words: OcrWord[] };
/** Maße und Wörter in Bildpunkten des gerenderten Bildes. */
export type OcrPage = { lang: string; width: number; height: number; lines: OcrLine[] };

const STORE = "folio.ocr";
const LONG_SIDE = 3400; // etwa 290 dpi auf A4: das Optimum der Windows-Erkennung
const MIN_TEXT = 12; // so viele Zeichen echten Textes, und die Seite gilt als Text-PDF

type State = OcrPage | "none" | "pending" | "failed";

export type OcrOptions = {
  pageDiv: (page: number) => HTMLElement | null;
  say: (message: string) => void;
  /** Anzahl noch wartender/laufender Seiten (0 = fertig) und die aktuelle Seite. */
  busy: (waiting: number, page: number | null) => void;
  /** Erkannte Seiten haben sich geaendert (Menue aktualisieren). */
  changed: () => void;
};

export function loadOcrEnabled(): boolean {
  try { return localStorage.getItem(STORE) !== "off"; } catch { return true; }
}

export class OcrLayer {
  private doc: PDFDocumentProxy | null = null;
  private states = new Map<number, State>();
  private queue: number[] = [];
  private running = false;
  private generation = 0;
  private enabled = loadOcrEnabled();
  private warned = false;
  private measureCtx: CanvasRenderingContext2D | null = null;

  constructor(private o: OcrOptions) {}

  get isEnabled() { return this.enabled; }

  setEnabled(on: boolean) {
    this.enabled = on;
    try { localStorage.setItem(STORE, on ? "on" : "off"); } catch { /* egal */ }
    if (!on) { this.queue = []; this.o.busy(0, null); }
    this.o.changed();
  }

  setDocument(doc: PDFDocumentProxy | null) {
    this.generation++;
    this.doc = doc;
    this.states.clear();
    this.queue = [];
    this.warned = false;
    this.o.busy(0, null);
    this.o.changed();
  }

  /** Seiten, fuer die erkannter Text vorliegt. */
  recognized(): Map<number, OcrPage> {
    const out = new Map<number, OcrPage>();
    for (const [n, s] of this.states) if (typeof s === "object") out.set(n, s);
    return out;
  }

  /** PDF.js hat die Seite gezeichnet: vorhandene Ebene wieder anbringen oder Erkennung einreihen. */
  onPageRendered(page: number, div: HTMLElement) {
    if (!this.doc) return;
    const state = this.states.get(page);
    if (typeof state === "object") { this.attach(div, state); return; }
    if (state === undefined && this.enabled) this.enqueue(page);
  }

  /** Erkennung fuer die Seite erzwingen (auch bei ausgeschalteter Automatik oder vorhandenem Text). */
  async recognizeNow(page: number) {
    if (!this.doc) return;
    this.states.delete(page);
    this.enqueue(page, true);
  }

  private enqueue(page: number, force = false) {
    this.states.set(page, "pending");
    // Zuletzt gezeigte Seite zuerst: das ist die, die der Benutzer gerade liest.
    this.queue = [page, ...this.queue.filter((p) => p !== page)];
    if (force) this.forced.add(page);
    this.o.busy(this.queue.length + (this.running ? 1 : 0), null);
    void this.pump();
  }

  private forced = new Set<number>();

  private async pump() {
    if (this.running) return;
    this.running = true;
    const generation = this.generation;
    try {
      while (this.queue.length && generation === this.generation) {
        const page = this.queue.shift()!;
        this.o.busy(this.queue.length + 1, page);
        await this.run(page, generation);
      }
    } finally {
      this.running = false;
      if (generation === this.generation) this.o.busy(0, null);
    }
  }

  private async run(n: number, generation: number) {
    const doc = this.doc;
    if (!doc) return;
    const force = this.forced.delete(n);
    try {
      const page = await doc.getPage(n);
      if (!force) {
        const text = await page.getTextContent();
        const chars = text.items.reduce((sum, it) => sum + ("str" in it ? it.str.replace(/\s/g, "").length : 0), 0);
        if (chars >= MIN_TEXT) { page.cleanup(); if (generation === this.generation) this.states.set(n, "none"); return; }
      }
      const base = page.getViewport({ scale: 1 });
      const long = Math.max(base.width, base.height);
      // Nie groesser als das, was Windows.Media.Ocr annimmt (MaxImageDimension, meist 10000).
      const scale = Math.min(8, Math.max(1, LONG_SIDE / long), 9000 / long);
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      const ctx = canvas.getContext("2d", { alpha: false })!;
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvas, canvasContext: ctx, viewport }).promise;
      page.cleanup();
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
      if (!blob) throw new Error("Bild konnte nicht erzeugt werden");
      const result = await invoke<{ lang: string; lines: OcrLine[] }>("ocr_page", new Uint8Array(await blob.arrayBuffer()), {
        headers: { "x-lang": navigator.language || "" },
      });
      if (generation !== this.generation) return;
      const lines = result?.lines ?? [];
      const words = lines.reduce((sum, l) => sum + l.words.length, 0);
      if (!words) { this.states.set(n, "none"); return; }
      const recognized: OcrPage = { lang: result.lang, width: canvas.width, height: canvas.height, lines };
      this.states.set(n, recognized);
      const div = this.o.pageDiv(n);
      if (div) this.attach(div, recognized);
      this.o.changed();
    } catch (error) {
      if (generation !== this.generation) return;
      this.states.set(n, "failed");
      if (!this.warned) {
        this.warned = true;
        this.o.say("Texterkennung nicht möglich: " + String(error));
      }
    }
  }

  // ---------- Ebene ----------

  private measure(text: string): number {
    this.measureCtx ??= document.createElement("canvas").getContext("2d");
    const ctx = this.measureCtx!;
    ctx.font = '100px "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif';
    return ctx.measureText(text).width / 100; // Breite in em
  }

  /** Legt die unsichtbare Textebene auf die Seite. Positionen in Prozent und Container-Einheiten:
   *  sie wachsen beim Zoomen von selbst mit, ohne dass hier etwas neu gerechnet wird. */
  attach(div: HTMLElement, page: OcrPage) {
    div.querySelector(":scope > .ocrLayer")?.remove();
    const layer = document.createElement("div");
    layer.className = "ocrLayer";
    const aspect = page.width / page.height;
    const frag = document.createDocumentFragment();
    for (const line of page.lines) {
      const text = line.words.map((w) => w.text).join(" ");
      const entities = detectEntities(text);
      let offset = 0;
      for (const w of line.words) {
        const start = offset;
        offset += w.text.length + 1;
        if (!w.text.trim() || w.w <= 0 || w.h <= 0) continue;
        const span = document.createElement("span");
        span.className = "ocr-word";
        span.textContent = w.text;
        const fontCqh = w.h * 0.82 / page.height * 100; // Schriftgroesse in cqh
        const natural = this.measure(w.text) * fontCqh; // natuerliche Breite in cqh
        const target = (w.w / page.width) * 100 * aspect; // Zielbreite in cqh (1 cqw = aspect * cqh)
        const k = natural > 0 ? Math.min(4, Math.max(0.25, target / natural)) : 1;
        span.style.cssText =
          `left:${(w.x / page.width) * 100}%;top:${((w.y + (w.h - w.h * 0.82) / 2) / page.height) * 100}%;` +
          `font-size:${fontCqh}cqh;transform:scaleX(${k});`;
        const entity = entities.find((e) => start < e.end && start + w.text.length > e.start);
        if (entity) { span.classList.add("ocr-link"); span.dataset.href = entity.href; span.dataset.kind = entity.type; }
        frag.append(span, " ");
      }
      frag.append("\n");
    }
    layer.appendChild(frag);
    // Direkt hinter die Zeichenflaeche, unter Anmerkungen und Textfeldern.
    const wrapper = div.querySelector(":scope > .canvasWrapper");
    if (wrapper?.nextSibling) div.insertBefore(layer, wrapper.nextSibling); else div.appendChild(layer);
  }
}

// ---------- Einbetten ----------

export type EmbedPage = {
  page: number;
  words: Array<{ text: string; x: number; y: number; angle: number; width: number; size: number }>;
};

/** Woerter in PDF-Koordinaten (unrotierte Seite) fuer `pdf_embed_text`. */
export async function embedPayload(doc: PDFDocumentProxy, pages: Map<number, OcrPage>): Promise<EmbedPage[]> {
  const out: EmbedPage[] = [];
  for (const [n, p] of [...pages].sort((a, b) => a[0] - b[0])) {
    const page = await doc.getPage(n);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: p.width / base.width });
    const words: EmbedPage["words"] = [];
    for (const line of p.lines) for (const w of line.words) {
      if (!w.text.trim()) continue;
      const baseline = w.y + w.h * 0.8;
      const [x0, y0] = viewport.convertToPdfPoint(w.x, baseline);
      const [x1, y1] = viewport.convertToPdfPoint(w.x + w.w, baseline);
      words.push({
        text: w.text,
        x: x0,
        y: y0,
        angle: (Math.atan2(y1 - y0, x1 - x0) * 180) / Math.PI,
        width: Math.hypot(x1 - x0, y1 - y0),
        size: (w.h * 0.8) / viewport.scale,
      });
    }
    page.cleanup();
    out.push({ page: n - 1, words });
  }
  return out;
}

/** Rohkoerper fuer `pdf_embed_text`: 4 Byte Laenge (little endian), JSON, PDF. */
export function frameEmbed(pages: EmbedPage[], pdf: Uint8Array): Uint8Array {
  const json = new TextEncoder().encode(JSON.stringify(pages));
  const out = new Uint8Array(4 + json.length + pdf.length);
  new DataView(out.buffer).setUint32(0, json.length, true);
  out.set(json, 4);
  out.set(pdf, 4 + json.length);
  return out;
}
