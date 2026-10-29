/**
 * Eigene Lesezeichen pro Dokument. PDF.js kennt nur die Lesezeichen, die in der Datei stehen
 * (Inhaltsverzeichnis); diese hier gehoeren dem Leser. Schluessel ist der Fingerabdruck des
 * Dokuments und nicht der Pfad, damit sie ein Umbenennen oder Verschieben ueberstehen.
 */

const PREFIX = "folio.bookmarks.";

export class Bookmarks {
  private key: string | null = null;
  private pages = new Set<number>();

  constructor(private onChange: () => void) {}

  setDocument(fingerprint: string | null, pageCount = Infinity) {
    this.key = fingerprint ? PREFIX + fingerprint : null;
    this.pages = new Set();
    if (this.key) {
      try {
        const raw = JSON.parse(localStorage.getItem(this.key) ?? "[]");
        if (Array.isArray(raw)) {
          for (const p of raw) if (Number.isInteger(p) && p >= 1 && p <= pageCount) this.pages.add(p);
        }
      } catch { /* beschaedigter Eintrag: leer starten */ }
    }
    this.onChange();
  }

  has(page: number) { return this.pages.has(page); }

  list(): number[] { return [...this.pages].sort((a, b) => a - b); }

  toggle(page: number): boolean {
    if (!this.key) return false;
    const on = !this.pages.has(page);
    if (on) this.pages.add(page); else this.pages.delete(page);
    this.persist();
    this.onChange();
    return on;
  }

  /** Nach dem Umsortieren/Loeschen von Seiten: alte Seitenzahlen auf neue abbilden. */
  remap(map: (oldPage: number) => number | null) {
    const next = new Set<number>();
    for (const p of this.pages) {
      const to = map(p);
      if (to !== null) next.add(to);
    }
    this.pages = next;
    this.persist();
    this.onChange();
  }

  private persist() {
    if (!this.key) return;
    try {
      if (this.pages.size) localStorage.setItem(this.key, JSON.stringify(this.list()));
      else localStorage.removeItem(this.key);
    } catch { /* Speicher voll oder gesperrt: Lesezeichen bleiben nur bis zum Schliessen */ }
  }
}
