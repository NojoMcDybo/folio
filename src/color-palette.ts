const KEY = "folio.pen-colors";
const DEFAULTS = ["#ffd23f", "#65d6a4", "#68b5ff", "#ef91c3", "#ff786d"];
const isColor = (value: unknown): value is string => typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);

function load(fallback = { colors: [...DEFAULTS], selected: 0 }) {
  try {
    const data = JSON.parse(localStorage.getItem(KEY) ?? "null");
    if (Array.isArray(data?.colors) && data.colors.length === 5 && data.colors.every(isColor)) {
      return { colors: data.colors.map((c: string) => c.toLowerCase()) as string[], selected: Number.isInteger(data.selected) && data.selected >= 0 && data.selected < 5 ? data.selected as number : 0 };
    }
  } catch { /* Invalid or unavailable storage uses the initial palette. */ }
  return { colors: [...fallback.colors], selected: fallback.selected };
}

/** Five editable, persistent quick choices shared by marker, pen and text. */
export class ColorPalette {
  private state = load();
  private input: HTMLInputElement;
  private hex: HTMLInputElement;
  private slots: HTMLButtonElement[] = [];
  private status: HTMLElement;

  constructor(private opener: HTMLButtonElement, private panel: HTMLElement,
    private onChange: () => void, private notify: (message: string) => void) {
    this.input = panel.querySelector<HTMLInputElement>("#color")!;
    this.hex = panel.querySelector<HTMLInputElement>("#color-hex")!;
    this.status = panel.querySelector<HTMLElement>("#color-status")!;
    const group = panel.querySelector<HTMLElement>("#color-slots")!;
    this.slots = this.state.colors.map((_, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "color-slot";
      button.addEventListener("click", () => {
        // Reload other slots so editing in another document isn't overwritten.
        this.state = load(this.state);
        this.state.selected = index;
        this.persist();
        this.render();
        this.onChange();
      });
      group.append(button);
      return button;
    });
    opener.addEventListener("click", () => {
      if (!panel.hidden) { this.close(); return; }
      panel.hidden = false;
      opener.setAttribute("aria-expanded", "true");
      this.render();
      this.position();
      this.slots[this.state.selected].focus();
    });
    panel.querySelector("#color-close")!.addEventListener("click", () => this.close(true));
    this.input.addEventListener("input", () => { this.hex.value = this.input.value.toUpperCase(); });
    this.hex.addEventListener("input", () => { if (isColor(this.hex.value)) this.input.value = this.hex.value; });
    panel.querySelector("form")!.addEventListener("submit", event => {
      event.preventDefault();
      if (!this.hex.reportValidity() || !isColor(this.hex.value)) return;
      const latest = load(this.state);
      latest.selected = this.state.selected;
      latest.colors[latest.selected] = this.hex.value.toLowerCase();
      this.state = latest;
      const saved = this.persist();
      this.render();
      this.onChange();
      this.status.textContent = saved ? `Platz ${this.state.selected + 1} gespeichert.` : "Farbe nur für dieses Fenster übernommen.";
    });
    panel.addEventListener("keydown", event => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); this.close(true); }
    });
    document.addEventListener("pointerdown", event => {
      if (event.target instanceof Node && !panel.contains(event.target) && !opener.contains(event.target)) this.close();
    });
    document.addEventListener("focusin", event => {
      if (event.target instanceof Node && !panel.contains(event.target) && !opener.contains(event.target)) this.close();
    });
    window.addEventListener("resize", () => { if (!panel.hidden) this.position(); });
    this.render();
  }

  get color() { return this.state.colors[this.state.selected]; }

  close(restoreFocus = false) {
    this.panel.hidden = true;
    this.opener.setAttribute("aria-expanded", "false");
    if (restoreFocus) this.opener.focus();
  }

  private persist() {
    try { localStorage.setItem(KEY, JSON.stringify(this.state)); return true; }
    catch { this.notify("Die Farben konnten nicht dauerhaft gespeichert werden."); return false; }
  }

  private render() {
    this.opener.style.setProperty("--swatch", this.color);
    this.slots.forEach((button, index) => {
      const color = this.state.colors[index];
      button.style.setProperty("--swatch", color);
      button.setAttribute("aria-pressed", String(index === this.state.selected));
      button.setAttribute("aria-label", `Farbe ${index + 1}: ${color.toUpperCase()}`);
      button.title = `Platz ${index + 1} · ${color.toUpperCase()}`;
      button.textContent = String(index + 1);
    });
    this.input.value = this.color;
    this.hex.value = this.color.toUpperCase();
    this.panel.querySelector("#color-label")!.textContent = `Farbe für Platz ${this.state.selected + 1}`;
    this.panel.querySelector("#color-save")!.textContent = `Platz ${this.state.selected + 1} speichern`;
    this.status.textContent = "Fünf Farben, auch beim nächsten Start.";
  }

  private position() {
    const anchor = this.opener.getBoundingClientRect();
    const rect = this.panel.getBoundingClientRect();
    const top = anchor.top - rect.height - 12;
    this.panel.style.left = `${Math.max(10, Math.min(innerWidth - rect.width - 10, anchor.right - rect.width))}px`;
    this.panel.style.top = `${Math.max(10, Math.min(innerHeight - rect.height - 10, top >= 10 ? top : anchor.bottom + 12))}px`;
  }
}
