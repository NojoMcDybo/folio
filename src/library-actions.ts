type LibraryEntry = { path: string; name: string };

/** A reversible library action and a separately confirmed file action. */
export class LibraryActions {
  private entry: LibraryEntry | null = null;
  private opener: HTMLElement | null = null;
  private busy = false;
  private menu = document.getElementById("library-menu")!;
  private dialog = document.getElementById("library-delete") as HTMLDialogElement;
  private error = document.getElementById("library-delete-error")!;
  private confirm = document.getElementById("library-delete-confirm") as HTMLButtonElement;
  private cancel = document.getElementById("library-delete-cancel") as HTMLButtonElement;

  constructor(private remove: (path: string) => boolean,
    private recycle: (path: string) => Promise<void>, private refresh: () => void,
    private notify: (message: string) => void) {
    document.getElementById("library-remove")!.addEventListener("click", () => {
      if (!this.entry) return;
      const { path } = this.entry;
      this.closeMenu();
      if (this.remove(path)) { this.refresh(); this.notify("Eintrag entfernt. Die PDF bleibt auf dem Computer."); }
    });
    document.getElementById("library-trash")!.addEventListener("click", () => {
      if (!this.entry) return;
      this.closeMenu();
      document.getElementById("library-delete-name")!.textContent = this.entry.name;
      document.getElementById("library-delete-path")!.textContent = this.entry.path;
      this.error.textContent = "";
      this.dialog.showModal();
      this.cancel.focus();
    });
    this.cancel.addEventListener("click", () => this.dialog.close());
    this.dialog.addEventListener("cancel", event => { if (this.busy) event.preventDefault(); });
    this.dialog.addEventListener("close", () => this.restoreFocus());
    this.confirm.addEventListener("click", async () => {
      if (!this.entry || this.busy) return;
      this.busy = true;
      this.confirm.disabled = this.cancel.disabled = true;
      this.error.textContent = "";
      this.confirm.textContent = "Wird verschoben …";
      try {
        await this.recycle(this.entry.path);
        const removed = this.remove(this.entry.path);
        this.dialog.close();
        this.refresh();
        this.notify(removed ? "PDF in den Papierkorb verschoben." : "PDF ist im Papierkorb. Der Bibliothekseintrag konnte nicht gespeichert werden.");
      } catch (error) {
        this.error.textContent = "Nicht verschoben: " + String(error);
      } finally {
        this.busy = false;
        this.confirm.disabled = this.cancel.disabled = false;
        this.confirm.textContent = "In den Papierkorb";
      }
    });
    this.menu.addEventListener("keydown", event => {
      if (event.key === "Escape") { event.preventDefault(); this.closeMenu(); this.restoreFocus(); }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const buttons = [...this.menu.querySelectorAll<HTMLButtonElement>("button")];
        buttons[(buttons.indexOf(document.activeElement as HTMLButtonElement) + 1) % buttons.length].focus();
      }
    });
    document.addEventListener("pointerdown", event => {
      if (event.target instanceof Node && !this.menu.contains(event.target) && !this.opener?.contains(event.target)) this.closeMenu();
    });
    document.addEventListener("focusin", event => {
      if (event.target instanceof Node && !this.menu.contains(event.target) && !this.opener?.contains(event.target)) this.closeMenu();
    });
    window.addEventListener("resize", () => this.closeMenu());
    document.getElementById("home")!.addEventListener("scroll", () => this.closeMenu());
  }

  show(entry: LibraryEntry, opener: HTMLElement, point?: { x: number; y: number }) {
    if (this.busy || this.dialog.open) return;
    const wasOpen = !this.menu.hidden && this.opener === opener;
    this.closeMenu();
    if (wasOpen && !point) return;
    this.entry = entry;
    this.opener = opener;
    opener.setAttribute("aria-expanded", "true");
    this.menu.hidden = false;
    const anchor = opener.getBoundingClientRect();
    const rect = this.menu.getBoundingClientRect();
    this.menu.style.left = `${Math.max(10, Math.min(innerWidth - rect.width - 10, point?.x ?? anchor.right - rect.width))}px`;
    this.menu.style.top = `${Math.max(10, Math.min(innerHeight - rect.height - 10, point?.y ?? anchor.bottom + 8))}px`;
    this.menu.querySelector<HTMLButtonElement>("button")!.focus();
  }

  closeMenu() { this.menu.hidden = true; this.opener?.setAttribute("aria-expanded", "false"); }
  private restoreFocus() {
    if (this.opener?.isConnected) this.opener.focus();
    else document.querySelector<HTMLButtonElement>("#grid .drop")?.focus();
  }
}
