/**
 * Verkleinern, Schwarzweiss und Einbrennen: Dialog und Hilfen. Die Arbeit macht der native Teil
 * (`pdf_optimize`, folio-pdfops); hier werden Auswahl und Ergebnis aufbereitet.
 */

export type Choice = {
  /** Zielaufloesung der Bilder; null = Bilder nicht anfassen. */
  dpi: number | null;
  quality: number;
  gray: boolean;
  flatten: boolean;
  target: "copy" | "here";
};

export type Report = {
  before: number;
  after: number;
  images: number;
  recompressed: number;
  flattened: number;
  warnings: string[];
};

const PRESETS: Record<string, { dpi: number; quality: number }> = {
  screen: { dpi: 100, quality: 55 },
  mail: { dpi: 150, quality: 70 },
  print: { dpi: 220, quality: 82 },
};

const nf = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 1 });

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${nf.format(bytes / 1024)} KB`;
  return `${nf.format(bytes / 1024 / 1024)} MB`;
}

/** Antwort von `pdf_optimize`: 4 Byte Laenge (little endian), Bericht (JSON), PDF. */
export function splitReport(buffer: ArrayBuffer): { report: Report; pdf: Uint8Array } {
  const bytes = new Uint8Array(buffer);
  const length = new DataView(buffer).getUint32(0, true);
  const report = JSON.parse(new TextDecoder().decode(bytes.subarray(4, 4 + length))) as Report;
  return { report, pdf: bytes.subarray(4 + length) };
}

export function summary(r: Report): string {
  const parts: string[] = [];
  if (r.after < r.before) parts.push(`${formatSize(r.before)} → ${formatSize(r.after)} (−${Math.round((1 - r.after / r.before) * 100)} %)`);
  else parts.push(`${formatSize(r.after)}`);
  if (r.recompressed) parts.push(`${r.recompressed} von ${r.images} Bildern neu berechnet`);
  if (r.flattened) parts.push(`${r.flattened} Anmerkung${r.flattened === 1 ? "" : "en"} eingebrannt`);
  return parts.join(" · ");
}

export class OptimizeDialog {
  private finish: ((c: Choice | null) => void) | null = null;

  constructor(private dlg: HTMLDialogElement) {
    dlg.innerHTML = `
      <form method="dialog" class="opt-box">
        <h2>Verkleinern und umwandeln</h2>
        <fieldset class="opt-group">
          <legend>Bilder</legend>
          <label><input type="radio" name="opt-dpi" value="none"> Nicht verändern</label>
          <label><input type="radio" name="opt-dpi" value="screen"> Bildschirm <span>100 dpi · kleinste Datei</span></label>
          <label><input type="radio" name="opt-dpi" value="mail" checked> E-Mail <span>150 dpi · empfohlen</span></label>
          <label><input type="radio" name="opt-dpi" value="print"> Druck <span>220 dpi · größer, schärfer</span></label>
        </fieldset>
        <label class="opt-check"><input type="checkbox" name="opt-gray"> In Schwarzweiß umwandeln <span>Bilder und Farben werden grau</span></label>
        <label class="opt-check"><input type="checkbox" name="opt-flatten"> Anmerkungen und Formularfelder einbrennen <span>Unterschriften und Textfelder lassen sich danach nicht mehr verschieben</span></label>
        <p class="opt-note">Die Originaldatei bleibt unverändert, solange du nicht sicherst.</p>
        <div class="askrow">
          <button type="button" class="opt-cancel">Abbrechen</button>
          <button type="button" class="opt-here">Auf dieses Dokument anwenden</button>
          <button type="button" class="opt-copy primary">Als Kopie sichern …</button>
        </div>
      </form>`;
    dlg.querySelector(".opt-cancel")!.addEventListener("click", () => this.close(null));
    dlg.querySelector(".opt-here")!.addEventListener("click", () => this.close("here"));
    dlg.querySelector(".opt-copy")!.addEventListener("click", () => this.close("copy"));
    dlg.addEventListener("cancel", (e) => { e.preventDefault(); this.close(null); });
  }

  open(): Promise<Choice | null> {
    this.dlg.showModal();
    this.dlg.querySelector<HTMLButtonElement>(".opt-copy")!.focus();
    return new Promise((resolve) => { this.finish = resolve; });
  }

  private close(target: "copy" | "here" | null) {
    let choice: Choice | null = null;
    if (target) {
      const picked = this.dlg.querySelector<HTMLInputElement>('input[name="opt-dpi"]:checked')?.value ?? "none";
      const preset = PRESETS[picked];
      choice = {
        dpi: preset?.dpi ?? null,
        quality: preset?.quality ?? 75,
        gray: this.dlg.querySelector<HTMLInputElement>('input[name="opt-gray"]')!.checked,
        flatten: this.dlg.querySelector<HTMLInputElement>('input[name="opt-flatten"]')!.checked,
        target,
      };
      if (choice.dpi === null && !choice.gray && !choice.flatten) choice = null; // nichts gewaehlt
    }
    this.dlg.close();
    const done = this.finish;
    this.finish = null;
    done?.(choice);
  }
}
