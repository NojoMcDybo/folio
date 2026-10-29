/**
 * Kontaktbogen: alle Seiten als Raster ueber dem Leser. Auswahl springt zur Seite.
 */

import type { PDFDocumentProxy } from "pdfjs-dist";
import { ThumbQueue, releaseCanvas, type ThumbRequest } from "./thumbs";

const CELL_WIDTH = 180;

export class ContactSheet {
  private queue: ThumbQueue | null = null;
  private observers: IntersectionObserver[] = [];
  private requests = new Map<HTMLElement, ThumbRequest>();
  private returnFocus: HTMLElement | null = null;

  constructor(
    private overlay: HTMLElement,
    private grid: HTMLElement,
    closeButton: HTMLElement,
    private go: (page: number) => void,
    private isBookmarked: (page: number) => boolean,
  ) {
    closeButton.addEventListener("click", () => this.close());
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) this.close();
    });
    grid.addEventListener("click", (e) => {
      const cell = (e.target as Element).closest<HTMLElement>(".cell");
      if (!cell) return;
      const page = Number(cell.dataset.page);
      this.close();
      this.go(page);
    });
    overlay.addEventListener("keydown", (e) => {
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); this.close(); return; }
      const cell = (e.target as Element).closest<HTMLElement>(".cell");
      if (!cell) return;
      const cells = [...this.grid.children] as HTMLElement[];
      const at = cells.indexOf(cell);
      const perRow = Math.max(1, Math.round(this.grid.clientWidth / (cell.offsetWidth + 18)));
      const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : e.key === "ArrowDown" ? perRow : e.key === "ArrowUp" ? -perRow : 0;
      if (!step) return;
      e.preventDefault();
      cells[Math.min(cells.length - 1, Math.max(0, at + step))]?.focus();
    });
  }

  get isOpen() { return !this.overlay.hidden; }

  toggle(doc: PDFDocumentProxy | null, current: number) {
    if (this.isOpen) this.close(); else if (doc) this.open(doc, current);
  }

  open(doc: PDFDocumentProxy, current: number) {
    this.close(false);
    this.returnFocus = document.activeElement as HTMLElement | null;
    this.queue = new ThumbQueue(doc, 3);
    const frag = document.createDocumentFragment();
    for (let n = 1; n <= doc.numPages; n++) {
      const cell = document.createElement("button");
      cell.type = "button";
      cell.className = "cell";
      cell.dataset.page = String(n);
      cell.setAttribute("aria-label", `Seite ${n}`);
      cell.classList.toggle("cur", n === current);
      cell.classList.toggle("bm", this.isBookmarked(n));
      const face = document.createElement("span");
      face.className = "face";
      face.appendChild(document.createElement("canvas"));
      const label = document.createElement("span");
      label.className = "n";
      label.textContent = String(n);
      cell.append(face, label);
      frag.appendChild(cell);
    }
    this.grid.replaceChildren(frag);
    this.overlay.hidden = false;
    this.overlay.scrollTop = 0;

    const near = new IntersectionObserver((entries) => {
      for (const en of entries) {
        const cell = en.target as HTMLElement;
        if (!en.isIntersecting || this.requests.has(cell) || cell.classList.contains("ready")) continue;
        const canvas = cell.querySelector("canvas")!;
        const req = this.queue!.request(Number(cell.dataset.page), CELL_WIDTH, canvas);
        this.requests.set(cell, req);
        void req.done.then((aspect) => {
          if (this.requests.get(cell) !== req) return;
          this.requests.delete(cell);
          if (aspect !== null) { cell.style.setProperty("--ar", String(aspect)); cell.classList.add("ready"); }
        });
      }
    }, { root: this.overlay, rootMargin: "600px 0px" });
    const far = new IntersectionObserver((entries) => {
      for (const en of entries) {
        if (en.isIntersecting) continue;
        const cell = en.target as HTMLElement;
        this.requests.get(cell)?.cancel();
        this.requests.delete(cell);
        if (cell.classList.contains("ready")) {
          releaseCanvas(cell.querySelector("canvas")!);
          cell.classList.remove("ready");
        }
      }
    }, { root: this.overlay, rootMargin: "3000px 0px" });
    this.observers = [near, far];
    for (const cell of this.grid.children) { near.observe(cell); far.observe(cell); }

    const target = this.grid.children[current - 1] as HTMLElement | undefined;
    target?.scrollIntoView({ block: "center" });
    target?.focus({ preventScroll: true });
  }

  close(restoreFocus = true) {
    if (!this.isOpen && !this.queue) return;
    for (const o of this.observers.splice(0)) o.disconnect();
    for (const r of this.requests.values()) r.cancel();
    this.requests.clear();
    this.queue?.destroy();
    this.queue = null;
    this.grid.replaceChildren();
    this.overlay.hidden = true;
    if (restoreFocus) this.returnFocus?.focus?.();
    this.returnFocus = null;
  }
}
