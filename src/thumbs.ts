/**
 * Miniaturen fuer Seitenleiste und Kontaktbogen.
 * Eine Warteschlange mit wenigen gleichzeitigen Auftraegen: beim schnellen Scrollen durch
 * ein Buch werden Auftraege fuer Seiten, die schon wieder verschwunden sind, abgebrochen,
 * statt den Hauptfaden mit hunderten Renderaufgaben zu verstopfen.
 */

import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";

type Job = {
  page: number;
  width: number;
  canvas: HTMLCanvasElement;
  resolve: (aspect: number | null) => void;
  task: RenderTask | null;
  cancelled: boolean;
};

export type ThumbRequest = { cancel(): void; done: Promise<number | null> };

export class ThumbQueue {
  private queue: Job[] = [];
  private running = 0;
  private destroyed = false;

  constructor(private doc: PDFDocumentProxy, private limit = 2) {}

  /** Zeichnet die Seite mit der angegebenen CSS-Breite auf `canvas`.
   *  Das Ergebnis ist das Seitenverhaeltnis (Breite / Hoehe) oder null bei Abbruch/Fehler. */
  request(page: number, width: number, canvas: HTMLCanvasElement): ThumbRequest {
    let job!: Job;
    const done = new Promise<number | null>((resolve) => {
      job = { page, width, canvas, resolve, task: null, cancelled: false };
    });
    if (this.destroyed) { job.resolve(null); return { cancel() {}, done }; }
    this.queue.push(job);
    this.pump();
    return {
      done,
      cancel: () => {
        job.cancelled = true;
        const at = this.queue.indexOf(job);
        if (at >= 0) { this.queue.splice(at, 1); job.resolve(null); }
        else job.task?.cancel();
      },
    };
  }

  destroy() {
    this.destroyed = true;
    for (const job of this.queue.splice(0)) job.resolve(null);
  }

  private pump() {
    while (this.running < this.limit && this.queue.length) {
      // Zuletzt angeforderte zuerst: das ist, was gerade im Bild ist.
      const job = this.queue.pop()!;
      this.running++;
      void this.run(job).finally(() => { this.running--; this.pump(); });
    }
  }

  private async run(job: Job) {
    let aspect: number | null = null;
    try {
      if (job.cancelled || this.destroyed) return;
      const page = await this.doc.getPage(job.page);
      if (job.cancelled || this.destroyed) { page.cleanup(); return; }
      const base = page.getViewport({ scale: 1 });
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const viewport = page.getViewport({ scale: (job.width * dpr) / base.width });
      const { canvas } = job;
      canvas.width = Math.max(1, Math.floor(viewport.width));
      canvas.height = Math.max(1, Math.floor(viewport.height));
      const ctx = canvas.getContext("2d", { alpha: false });
      if (!ctx) return;
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      job.task = page.render({ canvas, canvasContext: ctx, viewport });
      await job.task.promise;
      page.cleanup();
      aspect = base.width / base.height;
    } catch {
      // Abbruch (RenderingCancelledException) oder defekte Seite: Platzhalter bleibt.
      aspect = null;
    } finally {
      job.resolve(aspect);
    }
  }
}

/** Platzhalter schrumpfen lassen, ohne das Layout zu veraendern. */
export function releaseCanvas(canvas: HTMLCanvasElement) {
  canvas.width = 0;
  canvas.height = 0;
}
