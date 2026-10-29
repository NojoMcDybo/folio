/**
 * Kontextmenue fuer Seiten (Rechtsklick auf eine Miniatur, Eintrag im Ansichtsmenue).
 */

export type MenuItem =
  | { separator: true }
  | { label: string; kbd?: string; disabled?: boolean; danger?: boolean; action: () => void };

export class PageMenu {
  private returnFocus: HTMLElement | null = null;

  constructor(private menu: HTMLElement) {
    document.addEventListener("pointerdown", (e) => {
      if (!this.menu.hidden && !this.menu.contains(e.target as Node)) this.close();
    }, true);
    window.addEventListener("blur", () => this.close());
    menu.addEventListener("keydown", (e) => {
      const items = [...menu.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];
      const at = items.indexOf(document.activeElement as HTMLButtonElement);
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); this.close(true); }
      else if (e.key === "ArrowDown") { e.preventDefault(); items[(at + 1) % items.length]?.focus(); }
      else if (e.key === "ArrowUp") { e.preventDefault(); items[(at - 1 + items.length) % items.length]?.focus(); }
    });
  }

  get isOpen() { return !this.menu.hidden; }

  open(items: MenuItem[], x: number, y: number) {
    this.returnFocus = document.activeElement as HTMLElement | null;
    this.menu.replaceChildren(...items.map((item) => {
      if ("separator" in item) {
        const hr = document.createElement("div");
        hr.className = "pm-sep";
        hr.setAttribute("role", "separator");
        return hr;
      }
      const b = document.createElement("button");
      b.type = "button";
      b.setAttribute("role", "menuitem");
      b.className = "pm-item" + (item.danger ? " danger" : "");
      b.disabled = !!item.disabled;
      const label = document.createElement("span");
      label.textContent = item.label;
      b.appendChild(label);
      if (item.kbd) {
        const k = document.createElement("kbd");
        k.textContent = item.kbd;
        b.appendChild(k);
      }
      b.addEventListener("click", () => { this.close(); item.action(); });
      return b;
    }));
    this.menu.hidden = false;
    const w = this.menu.offsetWidth;
    const h = this.menu.offsetHeight;
    this.menu.style.left = `${Math.round(Math.min(Math.max(8, x), innerWidth - w - 8))}px`;
    this.menu.style.top = `${Math.round(Math.min(Math.max(8, y), innerHeight - h - 8))}px`;
    this.menu.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus({ preventScroll: true });
  }

  close(restoreFocus = false) {
    if (this.menu.hidden) return;
    this.menu.hidden = true;
    if (restoreFocus) this.returnFocus?.focus?.();
    this.returnFocus = null;
  }
}
