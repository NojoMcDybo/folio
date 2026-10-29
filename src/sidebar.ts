/**
 * Seitenleiste: nur die Miniaturen, ohne Rahmen, mit leichtem Schatten zum Kontrast.
 *
 * Auf- und wegwischbar bzw. per Ziehen hinein und heraus:
 *  - Griff am linken Rand (und ein unsichtbarer Randstreifen) ziehen oder anklicken
 *  - zwei Finger auf dem Touchpad nach rechts, wenn die Seite am linken Anschlag steht
 *  - die geoeffnete Leiste nach links ziehen oder wischen
 *  - Strg+B
 * Die Leiste folgt dem Finger/Zeiger stufenlos (`--open` 0..1) und rastet beim Loslassen ein,
 * abhaengig von Position und Geschwindigkeit.
 */

import type { PDFDocumentProxy } from "pdfjs-dist";
import { ThumbQueue, releaseCanvas, type ThumbRequest } from "./thumbs";

/** Breite der Leiste samt Rand: so weit faehrt sie nach links weg. */
export const SIDEBAR_SLIDE = 148;
const THUMB_WIDTH = 104;
const STORE = "folio.sidebar";

type Thumb = {
  page: number;
  el: HTMLButtonElement;
  canvas: HTMLCanvasElement;
  request: ThumbRequest | null;
  drawn: boolean;
};

export type SidebarOptions = {
  root: HTMLElement;
  list: HTMLElement;
  grip: HTMLElement;
  edge: HTMLElement;
  /** Wo Touchpad-Wischen (Wheel mit deltaX) das Oeffnen ausloest. */
  wheelHost: HTMLElement;
  go: (page: number) => void;
  isBookmarked: (page: number) => boolean;
};

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

export class PageSidebar {
  private doc: PDFDocumentProxy | null = null;
  private queue: ThumbQueue | null = null;
  private items: Thumb[] = [];
  private built = false;
  private aspect = 1 / Math.SQRT2;
  private current = 1;
  private openness = 0;
  private near: IntersectionObserver | null = null;
  private far: IntersectionObserver | null = null;
  private gesture: {
    id: number; x0: number; y0: number; open0: number; source: "grip" | "edge" | "list";
    active: boolean; vx: number; lastX: number; lastT: number;
  } | null = null;
  private suppressClick = false;
  private wheelSum = 0;
  private wheelTimer = 0;
  private rendering = false;
  private settleTimer = 0;

  constructor(private o: SidebarOptions) {
    const { root, grip, edge, list } = o;

    const start = (source: "grip" | "edge" | "list") => (e: PointerEvent) => {
      if (e.button !== 0 || this.gesture || !this.doc) return;
      this.gesture = {
        id: e.pointerId, x0: e.clientX, y0: e.clientY, open0: this.openness, source,
        active: false, vx: 0, lastX: e.clientX, lastT: e.timeStamp,
      };
      window.addEventListener("pointermove", this.onMove);
      window.addEventListener("pointerup", this.onUp);
      window.addEventListener("pointercancel", this.onUp);
    };
    grip.addEventListener("pointerdown", start("grip"));
    edge.addEventListener("pointerdown", start("edge"));
    list.addEventListener("pointerdown", start("list"));

    // Nach einem Wisch darf der Klick nicht auch noch eine Seite oeffnen.
    root.addEventListener("click", (e) => {
      if (this.suppressClick) { e.stopPropagation(); e.preventDefault(); }
    }, true);

    grip.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); this.toggle(); }
    });

    list.addEventListener("click", (e) => {
      const el = (e.target as Element).closest<HTMLButtonElement>(".thumb");
      if (el) o.go(Number(el.dataset.page));
    });

    list.addEventListener("keydown", (e) => {
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      const el = (e.target as Element).closest<HTMLElement>(".thumb");
      const next = e.key === "ArrowDown" ? el?.nextElementSibling : el?.previousElementSibling;
      if (next instanceof HTMLElement) { e.preventDefault(); next.focus(); }
    });

    // Wischen mit zwei Fingern: auf der Seite nach rechts oeffnet (nur am linken Anschlag,
    // sonst scrollt die vergroesserte Seite seitlich), in der Leiste nach links schliesst.
    const onWheel = (closing: boolean) => (e: WheelEvent) => {
      if (e.ctrlKey || Math.abs(e.deltaX) < Math.abs(e.deltaY) * 1.5 || !this.doc) return;
      if (closing ? !this.isOpen : this.isOpen) return;
      if (!closing && o.wheelHost.scrollLeft > 0) return;
      const wants = closing ? e.deltaX > 0 : e.deltaX < 0;
      if (!wants) { this.wheelSum = 0; return; }
      this.wheelSum += Math.abs(e.deltaX);
      window.clearTimeout(this.wheelTimer);
      this.wheelTimer = window.setTimeout(() => { this.wheelSum = 0; }, 220);
      if (this.wheelSum > 90) {
        this.wheelSum = 0;
        this.setOpen(!closing);
      }
    };
    o.wheelHost.addEventListener("wheel", onWheel(false), { passive: true });
    root.addEventListener("wheel", onWheel(true), { passive: true });

    this.applyOpenness();
    if (this.restoreOpen()) this.setOpen(true, false);
  }

  get isOpen() { return this.openness >= 1; }

  setDocument(doc: PDFDocumentProxy | null) {
    this.teardown();
    this.doc = doc;
    this.current = 1;
    if (!doc) return;
    this.queue = new ThumbQueue(doc);
    this.rendering = false;
    // Das Seitenverhaeltnis der ersten Seite ist der Platzhalter fuer alle.
    void doc.getPage(1).then((p) => {
      const v = p.getViewport({ scale: 1 });
      this.aspect = v.width / v.height;
      p.cleanup();
      for (const t of this.items) if (!t.drawn) t.el.style.setProperty("--ar", String(this.aspect));
    }).catch(() => {});
    if (this.openness > 0) { this.build(); this.updateRendering(); }
  }

  setCurrent(page: number) {
    this.current = page;
    for (const t of this.items) t.el.classList.toggle("cur", t.page === page);
    if (this.isOpen && !this.o.root.matches(":hover")) this.scrollToCurrent();
  }

  refreshBookmarks() {
    for (const t of this.items) t.el.classList.toggle("bm", this.o.isBookmarked(t.page));
  }

  toggle() { this.setOpen(!this.isOpen); }

  setOpen(open: boolean, remember = true) {
    this.openness = open ? 1 : 0;
    if (open) this.build();
    this.applyOpenness();
    if (remember) {
      try { localStorage.setItem(STORE, open ? "1" : "0"); } catch { /* egal */ }
    }
    if (open) requestAnimationFrame(() => this.scrollToCurrent());
  }

  private restoreOpen() {
    try { return localStorage.getItem(STORE) === "1"; } catch { return false; }
  }

  /** Stand der Leiste in CSS uebertragen. */
  private applyOpenness() {
    const { root, grip } = this.o;
    root.style.setProperty("--open", String(this.openness));
    grip.setAttribute("aria-expanded", String(this.openness >= 1));
    this.updateRendering();
  }

  /** Waehrend Ein-/Ausfahren und offen: sichtbar, bedienbar und rendernd. Nach dem Wegfahren
   *  erst nach der Animation unsichtbar machen und die Zeichenflaechen freigeben. */
  private updateRendering() {
    const { root, grip } = this.o;
    const active = this.openness > 0 || this.gesture?.active === true;
    window.clearTimeout(this.settleTimer);
    if (active) {
      root.classList.add("shown");
      this.setRendering(true);
    } else {
      this.settleTimer = window.setTimeout(() => {
        if (this.openness > 0 || this.gesture?.active) return;
        root.classList.remove("shown");
        this.setRendering(false);
      }, 480);
    }
    root.inert = this.openness === 0;
    root.setAttribute("aria-hidden", String(this.openness < 1));
    grip.classList.toggle("open", this.openness >= 1);
  }

  private setRendering(on: boolean) {
    if (on === this.rendering) return;
    this.rendering = on;
    if (on) this.observeAll(); else this.releaseAll();
  }

  // ---------- Aufbau ----------

  private build() {
    if (this.built || !this.doc) return;
    this.built = true;
    const { list } = this.o;
    const frag = document.createDocumentFragment();
    this.near = new IntersectionObserver((entries) => {
      for (const en of entries) {
        if (!en.isIntersecting) continue;
        const t = this.items[Number((en.target as HTMLElement).dataset.page) - 1];
        if (t && !t.drawn && !t.request) this.draw(t);
      }
    }, { root: list, rootMargin: "700px 0px" });
    this.far = new IntersectionObserver((entries) => {
      for (const en of entries) {
        if (en.isIntersecting) continue;
        const t = this.items[Number((en.target as HTMLElement).dataset.page) - 1];
        if (t) this.release(t);
      }
    }, { root: list, rootMargin: "4000px 0px" });

    for (let n = 1; n <= this.doc.numPages; n++) {
      const el = document.createElement("button");
      el.type = "button";
      el.className = "thumb";
      el.dataset.page = String(n);
      el.style.setProperty("--ar", String(this.aspect));
      el.setAttribute("aria-label", `Seite ${n}`);
      const face = document.createElement("span");
      face.className = "face";
      const canvas = document.createElement("canvas");
      face.appendChild(canvas);
      const label = document.createElement("span");
      label.className = "n";
      label.textContent = String(n);
      el.append(face, label);
      el.classList.toggle("cur", n === this.current);
      el.classList.toggle("bm", this.o.isBookmarked(n));
      frag.appendChild(el);
      this.items.push({ page: n, el, canvas, request: null, drawn: false });
    }
    list.replaceChildren(frag);
    this.observeAll();
  }

  private observeAll() {
    if (!this.built) return;
    // Erneutes Beobachten loest den Rueckruf mit dem aktuellen Stand aus.
    for (const t of this.items) { this.near?.unobserve(t.el); this.near?.observe(t.el); this.far?.observe(t.el); }
  }

  private releaseAll() {
    for (const t of this.items) this.release(t);
  }

  private draw(t: Thumb) {
    if (!this.queue) return;
    t.request = this.queue.request(t.page, THUMB_WIDTH, t.canvas);
    const req = t.request;
    void req.done.then((aspect) => {
      if (t.request !== req) return;
      t.request = null;
      if (aspect === null) return;
      t.drawn = true;
      t.el.style.setProperty("--ar", String(aspect));
      t.el.classList.add("ready");
    });
  }

  private release(t: Thumb) {
    t.request?.cancel();
    t.request = null;
    if (t.drawn) {
      releaseCanvas(t.canvas);
      t.drawn = false;
      t.el.classList.remove("ready");
    }
  }

  private teardown() {
    this.near?.disconnect();
    this.far?.disconnect();
    this.near = this.far = null;
    this.queue?.destroy();
    this.queue = null;
    this.items = [];
    this.built = false;
    this.o.list.replaceChildren();
  }

  private scrollToCurrent() {
    const t = this.items[this.current - 1];
    if (!t) return;
    const { list } = this.o;
    const top = t.el.offsetTop - (list.clientHeight - t.el.offsetHeight) / 2;
    list.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
  }

  // ---------- Zeigerbewegung ----------

  private onMove = (e: PointerEvent) => {
    const g = this.gesture;
    if (!g || e.pointerId !== g.id) return;
    const dx = e.clientX - g.x0;
    const dy = e.clientY - g.y0;
    if (!g.active) {
      if (g.source === "list") {
        // Nur ein deutlicher Zug nach links aus der offenen Leiste ist das Wegwischen;
        // senkrecht bleibt es dem Scrollen (und spaeter dem Umsortieren) ueberlassen.
        if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) { this.finish(false); return; }
        if (!(dx < -10 && Math.abs(dx) > Math.abs(dy) * 1.2)) return;
      } else if (Math.hypot(dx, dy) < 4) return;
      g.active = true;
      this.o.root.classList.add("dragging");
      if (!this.built) this.build();
      (g.source === "list" ? this.o.root : g.source === "grip" ? this.o.grip : this.o.edge).setPointerCapture(e.pointerId);
    }
    const dt = e.timeStamp - g.lastT;
    if (dt > 0) g.vx = 0.6 * g.vx + 0.4 * ((e.clientX - g.lastX) / dt);
    g.lastX = e.clientX; g.lastT = e.timeStamp;
    this.openness = clamp01(g.open0 + dx / SIDEBAR_SLIDE);
    this.applyOpenness();
  };

  private onUp = (e: PointerEvent) => {
    const g = this.gesture;
    if (!g || e.pointerId !== g.id) return;
    this.finish(e.type === "pointerup");
  };

  private finish(released: boolean) {
    const g = this.gesture;
    if (!g) return;
    window.removeEventListener("pointermove", this.onMove);
    window.removeEventListener("pointerup", this.onUp);
    window.removeEventListener("pointercancel", this.onUp);
    this.gesture = null;
    this.o.root.classList.remove("dragging");
    for (const el of [this.o.grip, this.o.edge, this.o.root]) {
      if (el.hasPointerCapture(g.id)) el.releasePointerCapture(g.id);
    }
    if (g.active) {
      // Schnelles Wischen entscheidet, sonst die Haelfte.
      const open = Math.abs(g.vx) > 0.35 ? g.vx > 0 : this.openness > 0.5;
      this.suppressClick = true;
      window.setTimeout(() => { this.suppressClick = false; }, 0);
      this.setOpen(open);
    } else if (released && g.source === "grip") {
      this.toggle();
    }
  }
}
