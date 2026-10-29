/**
 * Zuschneiden: die Seite gross zeigen, den Ausschnitt mit Griffen aufziehen. Das Ergebnis sind
 * Bruchteile der sichtbaren Seite (0..1); fuer jede betroffene Seite werden sie in deren eigene
 * PDF-Koordinaten umgerechnet, damit "alle Seiten" auch bei gemischten Formaten stimmt.
 */

import type { PDFDocumentProxy } from "pdfjs-dist";

export type Fractions = [number, number, number, number]; // x0, y0, x1, y1 von oben links

export type CropRequest = { pages: number[]; fractions: Fractions };

const MIN = 28; // kleinster Ausschnitt in Bildschirmpixeln

type Box = { x0: number; y0: number; x1: number; y1: number };
type Handle = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw" | "move";

export class CropDialog {
  private stage: HTMLElement;
  private canvas: HTMLCanvasElement;
  private frame: HTMLElement;
  private scopes: HTMLElement;
  private rect: Box = { x0: 0, y0: 0, x1: 0, y1: 0 };
  private size = { w: 0, h: 0 };
  private finish: ((r: CropRequest | null) => void) | null = null;
  private drag: { h: Handle; x: number; y: number; start: Box; id: number } | null = null;
  private scopeSets: Record<string, number[]> = {};

  constructor(private dlg: HTMLDialogElement) {
    dlg.innerHTML = `
      <div class="crop-box">
        <header><h2>Seite zuschneiden</h2><span class="crop-hint">Rahmen aufziehen, dann zuschneiden. Die Datei ändert sich erst beim Sichern.</span></header>
        <div class="crop-stage"><canvas></canvas><div class="crop-frame">
          ${["nw", "n", "ne", "e", "se", "s", "sw", "w"].map((h) => `<i data-h="${h}"></i>`).join("")}
        </div></div>
        <div class="crop-scopes" role="radiogroup" aria-label="Anwenden auf"></div>
        <div class="askrow">
          <button type="button" class="crop-reset">Zurücksetzen</button>
          <button type="button" class="crop-cancel">Abbrechen</button>
          <button type="button" class="crop-apply">Zuschneiden</button>
        </div>
      </div>`;
    this.stage = dlg.querySelector(".crop-stage")!;
    this.canvas = dlg.querySelector("canvas")!;
    this.frame = dlg.querySelector(".crop-frame")!;
    this.scopes = dlg.querySelector(".crop-scopes")!;

    this.frame.addEventListener("pointerdown", (e) => {
      const t = e.target as HTMLElement;
      const h = (t.dataset.h as Handle | undefined) ?? "move";
      this.drag = { h, x: e.clientX, y: e.clientY, start: { ...this.rect }, id: e.pointerId };
      this.frame.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    this.frame.addEventListener("pointermove", (e) => this.onMove(e));
    const up = (e: PointerEvent) => {
      if (this.drag?.id === e.pointerId) { this.drag = null; try { this.frame.releasePointerCapture(e.pointerId); } catch { /* schon los */ } }
    };
    this.frame.addEventListener("pointerup", up);
    this.frame.addEventListener("pointercancel", up);

    dlg.querySelector(".crop-reset")!.addEventListener("click", () => this.reset());
    dlg.querySelector(".crop-cancel")!.addEventListener("click", () => this.close(null));
    dlg.querySelector(".crop-apply")!.addEventListener("click", () => this.apply());
    dlg.addEventListener("cancel", (e) => { e.preventDefault(); this.close(null); });
    dlg.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !(e.target as HTMLElement).closest("button")) { e.preventDefault(); this.apply(); }
    });
  }

  /** `selection`: ausdruecklich markierte Seiten (leer = keine). */
  async open(doc: PDFDocumentProxy, page: number, selection: number[]): Promise<CropRequest | null> {
    const p = await doc.getPage(page);
    const base = p.getViewport({ scale: 1 });
    const maxW = Math.min(innerWidth * 0.78, 780);
    const maxH = Math.max(160, innerHeight - 330);
    const scale = Math.min(maxW / base.width, maxH / base.height);
    const vp = p.getViewport({ scale });
    const dpr = Math.min(2, devicePixelRatio || 1);
    const rendered = p.getViewport({ scale: scale * dpr });
    this.canvas.width = Math.floor(rendered.width);
    this.canvas.height = Math.floor(rendered.height);
    this.size = { w: vp.width, h: vp.height };
    this.canvas.style.width = `${vp.width}px`;
    this.canvas.style.height = `${vp.height}px`;
    this.stage.style.width = `${vp.width}px`;
    this.stage.style.height = `${vp.height}px`;
    const ctx = this.canvas.getContext("2d", { alpha: false })!;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    await p.render({ canvas: this.canvas, canvasContext: ctx, viewport: rendered }).promise;

    // Wirkungsbereiche
    const all = Array.from({ length: doc.numPages }, (_, i) => i + 1);
    this.scopeSets = { page: [page], ...(selection.length > 1 ? { selection } : {}), all };
    const labels: Record<string, string> = {
      page: `Diese Seite (${page})`,
      selection: `Markierte Seiten (${selection.length})`,
      all: `Alle Seiten (${doc.numPages})`,
    };
    this.scopes.replaceChildren(...Object.keys(this.scopeSets).map((k, i) => {
      const label = document.createElement("label");
      const input = document.createElement("input");
      input.type = "radio"; input.name = "crop-scope"; input.value = k; input.checked = i === 0 || (k === "selection");
      label.append(input, " " + labels[k]);
      return label;
    }));
    // Nur eine Option vorgewaehlt: Markierung, falls vorhanden, sonst diese Seite.
    const firstChecked = this.scopes.querySelector<HTMLInputElement>("input:checked");
    for (const input of this.scopes.querySelectorAll<HTMLInputElement>("input")) input.checked = input === firstChecked;
    this.scopes.hidden = Object.keys(this.scopeSets).length < 2;

    this.reset();
    if (!this.dlg.open) this.dlg.showModal();
    return new Promise((resolve) => { this.finish = resolve; });
  }

  private reset() {
    this.rect = { x0: 0, y0: 0, x1: this.size.w, y1: this.size.h };
    this.paint();
  }

  private paint() {
    const { x0, y0, x1, y1 } = this.rect;
    Object.assign(this.frame.style, { left: `${x0}px`, top: `${y0}px`, width: `${x1 - x0}px`, height: `${y1 - y0}px` });
  }

  private onMove(e: PointerEvent) {
    const d = this.drag;
    if (!d || e.pointerId !== d.id) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    const { w, h } = this.size;
    const s = d.start;
    const r = { ...s };
    if (d.h === "move") {
      const mx = Math.min(Math.max(dx, -s.x0), w - s.x1);
      const my = Math.min(Math.max(dy, -s.y0), h - s.y1);
      r.x0 = s.x0 + mx; r.x1 = s.x1 + mx; r.y0 = s.y0 + my; r.y1 = s.y1 + my;
    } else {
      if (d.h.includes("w")) r.x0 = Math.min(Math.max(0, s.x0 + dx), s.x1 - MIN);
      if (d.h.includes("e")) r.x1 = Math.max(Math.min(w, s.x1 + dx), s.x0 + MIN);
      if (d.h.includes("n")) r.y0 = Math.min(Math.max(0, s.y0 + dy), s.y1 - MIN);
      if (d.h.includes("s")) r.y1 = Math.max(Math.min(h, s.y1 + dy), s.y0 + MIN);
    }
    this.rect = r;
    this.paint();
  }

  private apply() {
    const key = this.scopes.querySelector<HTMLInputElement>("input:checked")?.value ?? "page";
    const { x0, y0, x1, y1 } = this.rect;
    const { w, h } = this.size;
    this.close({ pages: this.scopeSets[key] ?? this.scopeSets.page, fractions: [x0 / w, y0 / h, x1 / w, y1 / h] });
  }

  private close(result: CropRequest | null) {
    this.dlg.close();
    const done = this.finish;
    this.finish = null;
    done?.(result);
  }
}

/** Je Seite das Rechteck in deren PDF-Koordinaten (unrotiert, wie pdfops es erwartet). */
export async function cropEdits(doc: PDFDocumentProxy, request: CropRequest) {
  const [fx0, fy0, fx1, fy1] = request.fractions;
  const edits: Array<{ pages: number[]; rect: [number, number, number, number] }> = [];
  for (const n of request.pages) {
    const page = await doc.getPage(n);
    const v = page.getViewport({ scale: 1 });
    const a = v.convertToPdfPoint(fx0 * v.width, fy0 * v.height);
    const b = v.convertToPdfPoint(fx1 * v.width, fy1 * v.height);
    page.cleanup();
    edits.push({ pages: [n], rect: [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])] });
  }
  return edits;
}
