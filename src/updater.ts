/**
 * Selbst-Update ueber GitHub Releases (nur im Bibliotheksfenster).
 * Prueft 15 s nach dem Start und dann alle 6 h. Installiert wird nur auf Klick, nur wenn kein
 * Dokumentfenster mehr offen ist (sonst gingen ungesicherte Markierungen verloren) und nur,
 * wenn das Update mit dem Schluessel aus tauri.conf.json (plugins.updater.pubkey) signiert ist.
 */
import { check, type Update } from "@tauri-apps/plugin-updater";
import { getAllWebviewWindows } from "@tauri-apps/api/webviewWindow";

const FIRST_CHECK_MS = 15_000;
const INTERVAL_MS = 6 * 3600_000;

export function initUpdater(banner: HTMLElement): void {
  const text = banner.querySelector<HTMLElement>(".update-text")!;
  const button = banner.querySelector<HTMLButtonElement>(".update-install")!;
  let pending: Update | null = null;
  let busy = false;

  async function lookup(): Promise<void> {
    if (busy) return;
    try {
      pending = await check();
    } catch (error) {
      console.warn("Update-Pruefung fehlgeschlagen", error); // offline o. Ae.: still bleiben
      return;
    }
    banner.hidden = !pending;
    if (pending) {
      text.textContent = `Folio ${pending.version} ist verfügbar (installiert: ${pending.currentVersion}).`;
      button.disabled = false;
    }
  }

  button.addEventListener("click", async () => {
    if (!pending || busy) return;
    const docs = (await getAllWebviewWindows()).filter((w) => w.label.startsWith("doc-")).length;
    if (docs) {
      text.textContent = `Bitte zuerst ${docs === 1 ? "das geöffnete Dokument" : `alle ${docs} geöffneten Dokumente`} schließen – dann „Installieren“.`;
      return;
    }
    busy = true;
    button.disabled = true;
    text.textContent = `Folio ${pending.version} wird geladen …`;
    try {
      // Windows: der Installer beendet Folio selbst und startet es danach neu
      await pending.downloadAndInstall();
    } catch (error) {
      busy = false;
      button.disabled = false;
      text.textContent = "Update fehlgeschlagen: " + String(error);
    }
  });

  window.setTimeout(() => void lookup(), FIRST_CHECK_MS);
  window.setInterval(() => void lookup(), INTERVAL_MS);
}
