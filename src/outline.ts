import type { PDFDocumentProxy } from "pdfjs-dist";

type OutlineItem = NonNullable<Awaited<ReturnType<PDFDocumentProxy["getOutline"]>>>[number];
type Destination = { pageNumber: number; destination: unknown[] };
type Row = { button: HTMLButtonElement; page: number | null };

export class OutlinePanel {
  private doc: PDFDocumentProxy | null = null;
  private generation = 0;
  private loaded = false;
  private rows: Row[] = [];
  private currentPage = 1;
  private navigation = 0;

  constructor(
    private panel: HTMLElement,
    private toggleButton: HTMLButtonElement,
    private list: HTMLElement,
    private status: HTMLElement,
    closeButton: HTMLButtonElement,
    private navigate: (destination: Destination) => void,
    private onOpen: () => void,
  ) {
    toggleButton.addEventListener("click", () => this.toggle());
    closeButton.addEventListener("click", () => this.close(true));
    panel.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault(); event.stopPropagation(); this.close(true);
      }
    });
  }

  setDocument(doc: PDFDocumentProxy) {
    this.generation++;
    this.doc = doc; this.loaded = false; this.rows = []; this.currentPage = 1;
    this.list.replaceChildren(); this.close();
  }

  toggle() {
    if (!this.doc) return;
    if (!this.panel.hidden) { this.close(true); return; }
    this.onOpen();
    this.panel.hidden = false;
    this.panel.dispatchEvent(new Event("outlineopen"));
    this.toggleButton.setAttribute("aria-expanded", "true");
    this.toggleButton.classList.add("on");
    if (!this.loaded) void this.load();
  }

  close(restoreFocus = false) {
    this.panel.hidden = true;
    this.toggleButton.setAttribute("aria-expanded", "false");
    this.toggleButton.classList.remove("on");
    if (restoreFocus) this.toggleButton.focus();
  }

  setCurrentPage(page: number) {
    this.currentPage = page;
    let active: Row | undefined;
    for (const row of this.rows) {
      if (row.page !== null && row.page <= page && (!active || row.page >= active.page!)) active = row;
    }
    for (const row of this.rows) {
      if (row === active) row.button.setAttribute("aria-current", "location");
      else row.button.removeAttribute("aria-current");
    }
  }

  private async load() {
    const doc = this.doc!;
    const generation = this.generation;
    this.loaded = true;
    this.status.textContent = "Inhaltsverzeichnis wird geladen …";
    this.status.hidden = false;
    try {
      const [items, labels] = await Promise.all([doc.getOutline(), doc.getPageLabels().catch(() => null)]);
      if (generation !== this.generation) return;
      if (!items?.length) {
        this.status.textContent = "Diese PDF enthält keine Lesezeichen. Ein gedrucktes Inhaltsverzeichnis wird hier noch nicht automatisch erkannt.";
        return;
      }
      this.status.hidden = true;
      const pending: Array<() => Promise<void>> = [];
      const destinations = new Map<OutlineItem["dest"], Promise<Destination | null>>();
      const resolve = (dest: OutlineItem["dest"]) => {
        if (!destinations.has(dest)) destinations.set(dest, (async () => {
          try {
            const destination = typeof dest === "string" ? await doc.getDestination(dest) : dest;
            if (!Array.isArray(destination) || !destination.length) return null;
            const ref = destination[0];
            const index = typeof ref === "number" ? ref : await doc.getPageIndex(ref);
            if (!Number.isInteger(index) || index < 0 || index >= doc.numPages) return null;
            return { pageNumber: index + 1, destination };
          } catch { return null; }
        })());
        return destinations.get(dest)!;
      };
      const render = (entries: OutlineItem[], depth: number): HTMLUListElement => {
        const ul = document.createElement("ul");
        for (const item of entries) {
          const li = document.createElement("li");
          const line = document.createElement("div");
          line.className = "outline-row";
          line.style.paddingLeft = `${Math.min(depth, 8) * 14}px`;
          const branch = document.createElement(item.items?.length ? "button" : "span");
          branch.className = "outline-branch";
          line.appendChild(branch);
          const button = document.createElement("button");
          button.className = "outline-link";
          const title = document.createElement("span");
          title.className = "outline-title";
          title.textContent = item.title?.trim() || "Ohne Titel";
          if (item.bold) title.style.fontWeight = "650";
          if (item.italic) title.style.fontStyle = "italic";
          const number = document.createElement("span");
          number.className = "outline-page";
          button.append(title, number); line.appendChild(button); li.appendChild(line);
          const row: Row = { button, page: null }; this.rows.push(row);
          if (item.dest === null || item.dest === undefined) {
            button.disabled = true;
            button.title = item.url ? "Externes Lesezeichen – kein Kapitelziel in dieser PDF" : "Kein Seitenziel hinterlegt";
          } else {
            pending.push(async () => {
              const destination = await resolve(item.dest);
              if (generation !== this.generation) return;
              if (!destination) { button.disabled = true; button.title = "Kapitelziel nicht verfügbar"; return; }
              row.page = destination.pageNumber;
              number.textContent = labels?.[destination.pageNumber - 1] || String(destination.pageNumber);
              number.title = `PDF-Seite ${destination.pageNumber}`;
            });
            button.addEventListener("click", async () => {
              const navigation = ++this.navigation;
              const destination = await resolve(item.dest);
              if (generation !== this.generation || navigation !== this.navigation) return;
              if (!destination) return;
              try {
                this.navigate(destination);
                // On narrow windows the document needs the space after choosing.
                if (innerWidth <= 620) this.close(true);
              } catch {
                this.status.textContent = "Dieses Kapitelziel konnte nicht geöffnet werden.";
                this.status.hidden = false;
              }
            });
          }
          if (item.items?.length) {
            const children = render(item.items, depth + 1);
            children.hidden = true;
            branch.textContent = "›";
            branch.setAttribute("aria-label", `Unterkapitel: ${title.textContent}`);
            branch.setAttribute("aria-expanded", "false");
            branch.addEventListener("click", () => {
              children.hidden = !children.hidden;
              branch.setAttribute("aria-expanded", String(!children.hidden));
            });
            li.appendChild(children);
          }
          ul.appendChild(li);
        }
        return ul;
      };
      this.list.replaceChildren(render(items, 0));
      // Bound metadata requests; never block opening a long book on all destinations.
      let next = 0;
      await Promise.all(Array.from({ length: Math.min(4, pending.length) }, async () => {
        while (next < pending.length && generation === this.generation) await pending[next++]();
      }));
      if (generation === this.generation) this.setCurrentPage(this.currentPage);
    } catch {
      if (generation !== this.generation) return;
      this.loaded = false;
      this.status.hidden = false;
      this.status.textContent = "Das Inhaltsverzeichnis konnte nicht geladen werden. Schließe und öffne es erneut, um es noch einmal zu versuchen.";
    }
  }
}
