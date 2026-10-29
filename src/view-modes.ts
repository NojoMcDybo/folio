/**
 * Seitenanordnung: fortlaufend, Einzelseite, Doppelseite.
 * Die Werte von ScrollMode/SpreadMode stammen aus PDF.js (ui_utils).
 */

export type ViewMode = "continuous" | "single" | "double";

export const VIEW_MODES: Record<ViewMode, { scroll: number; spread: number; label: string }> = {
  // ScrollMode.VERTICAL = 0, ScrollMode.PAGE = 3; SpreadMode.NONE = 0, SpreadMode.ODD = 1
  continuous: { scroll: 0, spread: 0, label: "Fortlaufend" },
  single: { scroll: 3, spread: 0, label: "Einzelseite" },
  double: { scroll: 3, spread: 1, label: "Doppelseite" },
};

const KEY = "folio.view";

export function loadViewMode(): ViewMode {
  try {
    const v = localStorage.getItem(KEY);
    if (v === "single" || v === "double" || v === "continuous") return v;
  } catch { /* egal */ }
  return "continuous";
}

export function saveViewMode(mode: ViewMode) {
  try { localStorage.setItem(KEY, mode); } catch { /* egal */ }
}

/** Seitenweise Ansichten blaettern, statt zu scrollen. */
export const isPaged = (mode: ViewMode) => mode !== "continuous";
