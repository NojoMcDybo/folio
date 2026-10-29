/**
 * Ansichtsmenue am Knopf oben links: Seitenanordnung, Kontaktbogen, Seitenleiste,
 * Lesezeichen. Schlicht und ohne Glas, wie die Farbauswahl.
 */

import { VIEW_MODES, type ViewMode } from "./view-modes";

export type ViewMenuActions = {
  setMode: (mode: ViewMode) => void;
  sheet: () => void;
  sidebar: () => void;
  toggleBookmark: () => void;
  goTo: (page: number) => void;
  pages: (x: number, y: number) => void;
  toggleOcr: () => void;
  ocrNow: () => void;
  embedOcr: () => void;
};

export class ViewMenu {
  private modeButtons = new Map<ViewMode, HTMLButtonElement>();

  constructor(
    private button: HTMLButtonElement,
    private menu: HTMLElement,
    private bookmarkRow: HTMLButtonElement,
    private bookmarkList: HTMLElement,
    actions: ViewMenuActions,
  ) {
    for (const el of menu.querySelectorAll<HTMLButtonElement>("[data-mode]")) {
      const mode = el.dataset.mode as ViewMode;
      this.modeButtons.set(mode, el);
      el.addEventListener("click", () => actions.setMode(mode));
    }
    button.addEventListener("click", () => this.toggle());
    menu.querySelector("#view-sheet")!.addEventListener("click", () => { this.close(); actions.sheet(); });
    menu.querySelector("#view-sidebar")!.addEventListener("click", () => { this.close(); actions.sidebar(); });
    menu.querySelector("#view-pages")!.addEventListener("click", () => {
      const r = menu.getBoundingClientRect();
      this.close();
      actions.pages(r.left, r.top + 120);
    });
    menu.querySelector("#view-ocr")!.addEventListener("click", () => actions.toggleOcr());
    menu.querySelector("#view-ocr-now")!.addEventListener("click", () => { this.close(); actions.ocrNow(); });
    menu.querySelector("#view-ocr-embed")!.addEventListener("click", () => { this.close(); actions.embedOcr(); });
    bookmarkRow.addEventListener("click", () => actions.toggleBookmark());
    bookmarkList.addEventListener("click", (e) => {
      const chip = (e.target as Element).closest<HTMLElement>("[data-page]");
      if (chip) { this.close(); actions.goTo(Number(chip.dataset.page)); }
    });
    menu.addEventListener("keydown", (e) => {
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); this.close(true); }
    });
    document.addEventListener("pointerdown", (e) => {
      if (this.menu.hidden) return;
      const t = e.target as Node;
      if (!this.menu.contains(t) && !this.button.contains(t)) this.close();
    }, true);
  }

  get isOpen() { return !this.menu.hidden; }

  setMode(mode: ViewMode) {
    for (const [m, el] of this.modeButtons) el.setAttribute("aria-checked", String(m === mode));
  }

  /** Texterkennung: Automatik an/aus und wie viele Seiten erkannten Text haben (Einbetten erst dann). */
  setOcr(enabled: boolean, recognized: number) {
    const auto = this.menu.querySelector<HTMLElement>("#view-ocr")!;
    auto.setAttribute("aria-checked", String(enabled));
    auto.querySelector("kbd")!.textContent = enabled ? "an" : "aus";
    const embed = this.menu.querySelector<HTMLElement>("#view-ocr-embed")!;
    embed.hidden = recognized === 0;
    embed.querySelector("kbd")!.textContent = recognized === 1 ? "1 Seite" : `${recognized} Seiten`;
  }

  setBookmarks(pages: number[], currentHas: boolean) {
    this.bookmarkRow.querySelector(".vm-label")!.textContent =
      currentHas ? "Lesezeichen entfernen" : "Lesezeichen setzen";
    this.bookmarkList.replaceChildren(...pages.map((p) => {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "vm-chip";
      chip.dataset.page = String(p);
      chip.textContent = `Seite ${p}`;
      return chip;
    }));
    this.bookmarkList.hidden = pages.length === 0;
  }

  toggle() { if (this.isOpen) this.close(true); else this.open(); }

  open() {
    this.menu.hidden = false;
    const r = this.button.getBoundingClientRect();
    const w = this.menu.offsetWidth;
    const h = this.menu.offsetHeight;
    this.menu.style.left = Math.round(Math.min(Math.max(10, r.left), innerWidth - w - 10)) + "px";
    this.menu.style.top = Math.round(Math.min(r.bottom + 10, Math.max(10, innerHeight - h - 10))) + "px";
    this.button.setAttribute("aria-expanded", "true");
    this.button.classList.add("on");
  }

  close(restoreFocus = false) {
    if (this.menu.hidden) return;
    this.menu.hidden = true;
    this.button.setAttribute("aria-expanded", "false");
    this.button.classList.remove("on");
    if (restoreFocus) this.button.focus();
  }

  static label(mode: ViewMode) { return VIEW_MODES[mode].label; }
}
