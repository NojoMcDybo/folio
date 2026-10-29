/**
 * Seiten bearbeiten: loeschen, umsortieren, einfuegen, drehen, zuschneiden, herausloesen.
 *
 * Jede Aenderung baut das PDF neu auf und laedt es in den Reader zurueck. Rueckgaengig haelt
 * dafuer Momentaufnahmen der Bytes (mit Speichergrenze, siehe `trimStack`). Auf der Platte
 * aendert sich nichts, solange der Benutzer nicht sichert - das Original ist die letzte Rettung.
 */

import type { PDFDocumentProxy } from "pdfjs-dist";
import * as ops from "./page-ops";

export type BookmarkChange = { map: ops.PageMap } | { set: number[] };

export type EditorHost = {
  doc(): PDFDocumentProxy | null;
  currentPage(): number;
  bookmarks(): number[];
  /** Ersetzt das offene Dokument; zeigt `page`, uebertraegt Lesezeichen. */
  replace(bytes: Uint8Array, page: number, bookmarks: BookmarkChange): Promise<void>;
  /** Drehen/Zuschneiden im nativen Teil (pdfops). */
  edit(bytes: Uint8Array, edits: unknown[]): Promise<Uint8Array>;
  busy(on: boolean): void;
  say(message: string): void;
  /** Gibt es ungesicherte Aenderungen? Und: setzen (nach einer Seitenoperation oder Rueckgaengig). */
  isDirty(): boolean;
  setDirty(dirty: boolean): void;
  /** Wird nach jeder Aenderung des Standes aufgerufen (Rueckgaengig moeglich ...). */
  changed(): void;
};

type Snapshot = { bytes: Uint8Array; page: number; dirty: boolean; label: string; bookmarks: number[] };

/** Die Bytes des Dokuments samt noch nicht gesicherter Markierungen. Ohne solche Aenderungen
 *  verlangt PDF.js `getData` (saveDocument warnt sonst bei jedem Aufruf). */
export async function documentBytes(doc: PDFDocumentProxy): Promise<Uint8Array> {
  return doc.annotationStorage.size ? doc.saveDocument() : doc.getData();
}

const UNDO_BUDGET = 256 * 1024 * 1024;
const UNDO_STEPS = 40;

export class PageEditor {
  private undoStack: Snapshot[] = [];
  private redoStack: Snapshot[] = [];
  private working = false;

  constructor(private host: EditorHost) {}

  get busy() { return this.working; }
  get canUndo() { return this.undoStack.length > 0; }
  get canRedo() { return this.redoStack.length > 0; }
  get undoLabel() { return this.undoStack[this.undoStack.length - 1]?.label ?? ""; }
  get redoLabel() { return this.redoStack[this.redoStack.length - 1]?.label ?? ""; }

  /** Beim Oeffnen eines anderen Dokuments: Verlauf verwerfen. */
  reset() {
    this.undoStack = []; this.redoStack = [];
    this.host.changed();
  }

  /** Nach dem Sichern unterscheidet sich jeder aeltere Stand von der Datei auf der Platte. */
  markSaved() {
    for (const s of this.undoStack) s.dirty = true;
    for (const s of this.redoStack) s.dirty = true;
  }

  async rotate(pages: number[], degrees: number) {
    const sel = this.selection(pages);
    if (!sel.length) return false;
    const label = degrees > 0 ? "Nach rechts drehen" : "Nach links drehen";
    return this.commit(label, this.host.currentPage(), ops.identityMap, async (_doc, before) =>
      this.host.edit(before, [{ op: "rotate", pages: sel.map((p) => p - 1), degrees }]));
  }

  /** `edits`: fertige Zuschnitte (pro Seite ein Rechteck in PDF-Koordinaten). */
  async crop(edits: Array<{ pages: number[]; rect: [number, number, number, number] }>) {
    if (!edits.length) return false;
    return this.commit("Zuschneiden", this.host.currentPage(), ops.identityMap, async (_doc, before) =>
      this.host.edit(before, edits.map((e) => ({ op: "crop", pages: e.pages.map((p) => p - 1), rect: e.rect }))));
  }

  async deletePages(pages: number[]) {
    const doc = this.host.doc();
    if (!doc) return false;
    const sel = this.selection(pages);
    if (!sel.length) return false;
    if (sel.length >= doc.numPages) { this.host.say("Mindestens eine Seite muss bleiben."); return false; }
    const label = sel.length === 1 ? `Seite ${sel[0]} löschen` : `${sel.length} Seiten löschen`;
    return this.commit(label, ops.pageAfterDelete(sel, doc.numPages - sel.length), ops.mapAfterDelete(sel),
      (d) => d.extractPages(ops.deleteInfos(sel)));
  }

  /** Verschiebt die Seiten als Block vor die Stelle `to` (0..Seitenzahl, Index der alten Liste). */
  async movePages(pages: number[], to: number) {
    const doc = this.host.doc();
    if (!doc) return false;
    const sel = this.selection(pages);
    const order = ops.moveOrder(doc.numPages, sel, to);
    if (!sel.length || ops.isIdentity(order)) return false;
    const map = ops.mapAfterMove(order);
    const label = sel.length === 1 ? `Seite ${sel[0]} verschieben` : `${sel.length} Seiten verschieben`;
    return this.commit(label, map(sel[0]) ?? 1, map, (d) => d.extractPages(ops.reorderInfos(order)));
  }

  /** Fuegt alle Seiten der Dokumente hinter Seite `after` ein (0 = vorne). */
  async insert(others: Uint8Array[], after: number, insertedCount: number) {
    const doc = this.host.doc();
    if (!doc || !others.length) return false;
    const label = insertedCount === 1 ? "Seite einfügen" : `${insertedCount} Seiten einfügen`;
    return this.commit(label, Math.min(Math.max(0, after), doc.numPages) + 1, ops.mapAfterInsert(after, insertedCount),
      (d) => d.extractPages(ops.insertInfos(others, after, d.numPages)));
  }

  /** Die gewaehlten Seiten als eigenstaendiges PDF; das offene Dokument bleibt unberuehrt. */
  async extract(pages: number[]): Promise<Uint8Array | null> {
    const doc = this.host.doc();
    if (!doc) return null;
    const sel = this.selection(pages);
    if (!sel.length) return null;
    try {
      return (await doc.extractPages(ops.extractInfos(sel))) ?? null;
    } catch (error) {
      this.host.say("Seiten konnten nicht herausgelöst werden: " + String(error));
      return null;
    }
  }

  async undo(): Promise<boolean> {
    return this.step(this.undoStack, this.redoStack, "Rückgängig");
  }

  async redo(): Promise<boolean> {
    return this.step(this.redoStack, this.undoStack, "Wiederholt");
  }

  private async step(from: Snapshot[], to: Snapshot[], verb: string) {
    const doc = this.host.doc();
    const entry = from[from.length - 1];
    if (!doc || !entry || this.working) return false;
    this.working = true;
    this.host.busy(true);
    try {
      const now = await documentBytes(doc);
      from.pop();
      to.push({ bytes: now, page: this.host.currentPage(), dirty: this.host.isDirty(), label: entry.label, bookmarks: this.host.bookmarks() });
      const trimmed = ops.trimStack(to, UNDO_BUDGET, UNDO_STEPS);
      to.splice(0, to.length, ...trimmed);
      await this.host.replace(entry.bytes, entry.page, { set: entry.bookmarks });
      this.host.setDirty(entry.dirty);
      this.host.say(`${verb}: ${entry.label}`);
      return true;
    } catch (error) {
      this.host.say(`${verb} fehlgeschlagen: ${String(error)}`);
      return false;
    } finally {
      this.working = false;
      this.host.busy(false);
      this.host.changed();
    }
  }

  private selection(pages: number[]) {
    const doc = this.host.doc();
    return doc ? ops.normalize(pages, doc.numPages) : [];
  }

  private async commit(
    label: string,
    showPage: number,
    map: ops.PageMap,
    produce: (doc: PDFDocumentProxy, before: Uint8Array) => Promise<Uint8Array | null | undefined>,
  ): Promise<boolean> {
    const doc = this.host.doc();
    if (!doc || this.working) return false;
    this.working = true;
    this.host.busy(true);
    try {
      // Mit eingebacken: noch nicht gesicherte Markierungen und Textfelder gehen nicht verloren.
      const before = await documentBytes(doc);
      const after = await produce(doc, before);
      if (!after?.byteLength) {
        this.host.say(`${label}: PDF.js konnte das Dokument nicht neu aufbauen.`);
        return false;
      }
      const snapshot: Snapshot = { bytes: before, page: this.host.currentPage(), dirty: this.host.isDirty(), label, bookmarks: this.host.bookmarks() };
      this.undoStack = ops.trimStack([...this.undoStack, snapshot], UNDO_BUDGET, UNDO_STEPS);
      this.redoStack = [];
      await this.host.replace(after, showPage, { map });
      this.host.setDirty(true);
      return true;
    } catch (error) {
      this.host.say(`${label} fehlgeschlagen: ${String(error)}`);
      return false;
    } finally {
      this.working = false;
      this.host.busy(false);
      this.host.changed();
    }
  }
}
