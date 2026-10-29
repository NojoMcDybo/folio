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
  /** Ausgewaehlte Seiten (leer = keine ausdrueckliche Auswahl) haben sich geaendert. */
  selectionChanged?: () => void;
  /** Block von Seiten vor die Einfuegestelle `to` (0..Seitenzahl, Index der alten Liste) ziehen. */
  onMove?: (pages: number[], to: number) => void;
  /** Rechtsklick auf eine Miniatur. */
  onContextMenu?: (pages: number[], x: number, y: number) => void;
  /** Beim Ziehen ueber den Fensterrand hinaus: Seiten herausloesen, nativer Drag uebernimmt. */
  onDragOut?: (pages: number[]) => void;
  /** Der Zeiger naehert sich beim Ziehen dem Fensterrand: Zeit, das Herausziehen vorzubereiten. */
  onNearEdge?: (pages: number[]) => void;
};

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const range = (a: number, b: number) => Array.from({ length: Math.abs(b - a) + 1 }, (_, i) => Math.min(a, b) + i);

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
    active: boolean; vx: number; lastX: number; lastT: number; touch: boolean; page: number;
  } | null = null;
  private suppressClick = false;
  private wheelSum = 0;
  private wheelTimer = 0;
  private rendering = false;
  private settleTimer = 0;
  private sel = new Set<number>();
  private anchor = 0;
  private marker: HTMLElement | null = null;
  private reorder: {
    id: number; pages: number[]; ghost: HTMLElement; to: number; x: number; y: number; raf: number; warned: boolean;
  } | null = null;
  private longPress = 0;

  constructor(private o: SidebarOptions) {
    const { root, grip, edge, list } = o;

    const start = (source: "grip" | "edge" | "list") => (e: PointerEvent) => {
      if (e.button !== 0 || this.gesture || !this.doc) return;
      this.gesture = {
        id: e.pointerId, x0: e.clientX, y0: e.clientY, open0: this.openness, source,
        active: false, vx: 0, lastX: e.clientX, lastT: e.timeStamp,
        touch: e.pointerType !== "mouse",
        page: Number((e.target as Element).closest<HTMLElement>(".thumb")?.dataset.page ?? 0),
      };
      // Finger und Stift muessen die Leiste scrollen koennen: dort beginnt das Umsortieren erst
      // nach einem langen Druck. Die Maus beginnt es mit dem ersten Zug.
      window.clearTimeout(this.longPress);
      if (source === "list" && this.gesture.touch && this.gesture.page && o.onMove) {
        const g = this.gesture;
        this.longPress = window.setTimeout(() => {
          if (this.gesture === g && !g.active) this.beginReorder(e.clientX, e.clientY, g);
        }, 380);
      }
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
      if (!el) return;
      const page = Number(el.dataset.page);
      if (e.shiftKey || e.ctrlKey || e.metaKey) {
        // Auswahl erweitern, ohne wegzublaettern: wer markiert, will etwas mit den Seiten tun.
        if (e.shiftKey) {
          const from = this.anchor || this.current;
          this.sel = new Set(range(from, page));
        } else {
          if (!this.sel.size) this.sel.add(this.current);
          if (this.sel.has(page)) this.sel.delete(page); else this.sel.add(page);
          this.anchor = page;
        }
        this.paintSelection();
        return;
      }
      this.sel.clear();
      this.anchor = page;
      this.paintSelection();
      o.go(page);
    });

    list.addEventListener("contextmenu", (e) => {
      const el = (e.target as Element).closest<HTMLElement>(".thumb");
      if (!el || !o.onContextMenu) return;
      e.preventDefault();
      const page = Number(el.dataset.page);
      if (!this.sel.has(page)) { this.sel = new Set([page]); this.anchor = page; this.paintSelection(); }
      o.onContextMenu(this.selection(), e.clientX, e.clientY);
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

  /** Ausdruecklich markierte Seiten, aufsteigend. Leer, wenn nur geblaettert wurde. */
  selection(): number[] { return [...this.sel].sort((a, b) => a - b); }

  setSelection(pages: number[]) {
    this.sel = new Set(pages);
    this.anchor = pages[0] ?? 0;
    this.paintSelection();
  }

  clearSelection() {
    if (!this.sel.size) return;
    this.sel.clear();
    this.paintSelection();
  }

  private paintSelection() {
    for (const t of this.items) t.el.classList.toggle("sel", this.sel.has(t.page));
    this.o.selectionChanged?.();
  }

  /** Einfuegestelle (0..Seitenzahl) zu einem Punkt auf dem Bildschirm, null ausserhalb der offenen Leiste. */
  insertionAt(clientX: number, clientY: number): number | null {
    if (!this.isOpen || !this.built) return null;
    const r = this.o.root.getBoundingClientRect();
    if (clientX < r.left - 8 || clientX > r.right + 8 || clientY < r.top || clientY > r.bottom) return null;
    for (const t of this.items) {
      const b = t.el.getBoundingClientRect();
      if (clientY < b.top + b.height / 2) return t.page - 1;
    }
    return this.items.length;
  }

  /** Markierung zwischen den Miniaturen (null = ausblenden). */
  showMarker(index: number | null) {
    const { list } = this.o;
    if (index === null || !this.items.length) { this.marker?.classList.remove("on"); return; }
    if (!this.marker) {
      this.marker = document.createElement("div");
      this.marker.className = "thumb-marker";
      list.appendChild(this.marker);
    }
    const before = this.items[index];
    const after = this.items[index - 1];
    const y = before ? before.el.offsetTop - 8 : (after ? after.el.offsetTop + after.el.offsetHeight + 8 : 0);
    this.marker.style.top = `${y}px`;
    this.marker.classList.add("on");
  }

  /** Das Miniaturbild einer Seite als Zeichenflaeche (Vorschau beim Herausziehen), sonst null. */
  previewOf(page: number): HTMLCanvasElement | null {
    const t = this.items[page - 1];
    return t?.drawn ? t.canvas : null;
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
      el.classList.toggle("sel", this.sel.has(n));
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
    this.marker = null;
    this.sel.clear();
    this.o.list.replaceChildren();
  }

  private scrollToCurrent() {
    const t = this.items[this.current - 1];
    if (!t) return;
    const { list } = this.o;
    const top = t.el.offsetTop - (list.clientHeight - t.el.offsetHeight) / 2;
    list.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
  }

  // ---------- Umsortieren ----------

  private beginReorder(x: number, y: number, g: NonNullable<PageSidebar["gesture"]>) {
    const page = g.page;
    const pages = this.sel.has(page) ? this.selection() : [page];
    // Die Wischgeste ist damit erledigt; ab jetzt gehoert der Zeiger dem Ziehen.
    window.removeEventListener("pointermove", this.onMove);
    window.removeEventListener("pointerup", this.onUp);
    window.removeEventListener("pointercancel", this.onUp);
    window.clearTimeout(this.longPress);
    this.gesture = null;
    const ghost = document.createElement("div");
    ghost.className = "thumb-ghost";
    const preview = this.previewOf(page);
    const cv = document.createElement("canvas");
    if (preview && preview.width) {
      cv.width = preview.width; cv.height = preview.height;
      cv.getContext("2d")?.drawImage(preview, 0, 0);
    }
    cv.style.aspectRatio = String(this.items[page - 1]?.el.style.getPropertyValue("--ar") || this.aspect);
    ghost.appendChild(cv);
    if (pages.length > 1) {
      const badge = document.createElement("span");
      badge.textContent = String(pages.length);
      ghost.appendChild(badge);
    }
    document.body.appendChild(ghost);
    for (const p of pages) this.items[p - 1]?.el.classList.add("lifting");
    this.o.list.classList.add("reordering");
    this.suppressClick = true;
    this.o.list.setPointerCapture(g.id);
    this.reorder = { id: g.id, pages, ghost, to: -1, x, y, raf: 0, warned: false };
    window.addEventListener("pointermove", this.onReorderMove);
    window.addEventListener("pointerup", this.onReorderEnd);
    window.addEventListener("pointercancel", this.onReorderEnd);
    window.addEventListener("keydown", this.onReorderKey, true);
    this.onReorderMove({ pointerId: g.id, clientX: x, clientY: y } as PointerEvent);
    this.reorder.raf = requestAnimationFrame(this.autoScroll);
  }

  private onReorderMove = (e: PointerEvent) => {
    const r = this.reorder;
    if (!r || e.pointerId !== r.id) return;
    r.x = e.clientX; r.y = e.clientY;
    r.ghost.style.transform = `translate(${e.clientX - 52}px, ${e.clientY - 20}px) rotate(-2deg)`;
    // Ueber den Fensterrand hinaus: das ist ein Herausziehen in den Explorer oder die Bibliothek.
    const m = 6;
    if (this.o.onDragOut && (e.clientX < -m || e.clientY < -m || e.clientX > innerWidth + m || e.clientY > innerHeight + m)) {
      const pages = r.pages;
      this.endReorder();
      this.o.onDragOut(pages);
      return;
    }
    const near = 48;
    if (e.clientX < near || e.clientY < near || e.clientX > innerWidth - near || e.clientY > innerHeight - near) {
      if (!r.warned) { r.warned = true; this.o.onNearEdge?.(r.pages); }
    }
    const to = this.insertionAt(e.clientX, e.clientY);
    r.to = to ?? -1;
    this.showMarker(to);
  };

  private onReorderEnd = (e: PointerEvent) => {
    const r = this.reorder;
    if (!r || e.pointerId !== r.id) return;
    const { pages, to } = r;
    const drop = e.type === "pointerup" && to >= 0;
    this.endReorder();
    if (drop) this.o.onMove?.(pages, to);
  };

  private onReorderKey = (e: KeyboardEvent) => {
    if (e.key !== "Escape") return;
    e.preventDefault(); e.stopPropagation();
    this.endReorder();
  };

  private endReorder() {
    const r = this.reorder;
    if (!r) return;
    cancelAnimationFrame(r.raf);
    r.ghost.remove();
    for (const t of this.items) t.el.classList.remove("lifting");
    this.o.list.classList.remove("reordering");
    this.showMarker(null);
    try { this.o.list.releasePointerCapture(r.id); } catch { /* schon los */ }
    this.reorder = null;
    window.removeEventListener("pointermove", this.onReorderMove);
    window.removeEventListener("pointerup", this.onReorderEnd);
    window.removeEventListener("pointercancel", this.onReorderEnd);
    window.removeEventListener("keydown", this.onReorderKey, true);
    window.setTimeout(() => { this.suppressClick = false; }, 0);
  }

  /** Am oberen/unteren Rand der Leiste scrollt sie beim Ziehen von selbst weiter. */
  private autoScroll = () => {
    const r = this.reorder;
    if (!r) return;
    const box = this.o.list.getBoundingClientRect();
    const edge = 56;
    const dy = r.y < box.top + edge ? -(box.top + edge - r.y) : r.y > box.bottom - edge ? r.y - (box.bottom - edge) : 0;
    if (dy && r.x < box.right + 40) {
      this.o.list.scrollTop += Math.max(-22, Math.min(22, dy / 3));
      r.to = this.insertionAt(r.x, r.y) ?? -1;
      this.showMarker(r.to >= 0 ? r.to : null);
    }
    r.raf = requestAnimationFrame(this.autoScroll);
  };

  // ---------- Zeigerbewegung ----------

  private onMove = (e: PointerEvent) => {
    const g = this.gesture;
    if (!g || e.pointerId !== g.id) return;
    const dx = e.clientX - g.x0;
    const dy = e.clientY - g.y0;
    if (!g.active) {
      if (g.source === "list") {
        const leftward = dx < -10 && Math.abs(dx) > Math.abs(dy) * 1.2;
        // Maus: jeder andere Zug ab einer Miniatur ist Umsortieren; nur ein deutlicher Zug nach
        // links ist das Wegwischen der Leiste.
        if (!g.touch && g.page && this.o.onMove && !leftward && Math.hypot(dx, dy) > 6) {
          this.beginReorder(e.clientX, e.clientY, g);
          return;
        }
        // Finger/Stift: senkrechter Zug vor dem langen Druck ist Scrollen.
        if (Math.hypot(dx, dy) > 8) window.clearTimeout(this.longPress);
        if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) { this.finish(false); return; }
        if (!leftward) return;
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
    window.clearTimeout(this.longPress);
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
