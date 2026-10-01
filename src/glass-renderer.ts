import { GlassLayer, type Painter } from "./glass";
import { SoftwareGlassLayer } from "./software-glass";

/** Keep the PDF painter connected when graphics are unavailable or fail later. */
export function createGlassRenderer(canvas: HTMLCanvasElement, painter: Painter) {
  let renderer: GlassLayer | SoftwareGlassLayer | null = null;
  let software = false;
  const useSoftware = (reason: unknown) => {
    if (software) return;
    software = true;
    renderer?.dispose();
    renderer = null;
    // A canvas that acquired WebGL cannot subsequently acquire a 2D context.
    const replacement = canvas.cloneNode(false) as HTMLCanvasElement;
    canvas.replaceWith(replacement);
    canvas = replacement;
    console.warn("Folio: Software-Glas aktiviert", reason);
    document.body.classList.remove("no-gl");
    document.body.dataset.glassRenderer = "software";
    try {
      renderer = new SoftwareGlassLayer(canvas);
      renderer.setPainter(painter);
    } catch (error) {
      console.warn("Folio: Einfacher Glas-Ersatz aktiviert", error);
      document.body.dataset.glassRenderer = "css";
      document.body.classList.add("no-gl");
    }
  };
  try {
    renderer = new GlassLayer(canvas, useSoftware);
    renderer.setPainter(painter);
  } catch (error) { useSoftware(error); }
  return {
    invalidate: () => renderer?.invalidate(),
    dispose: () => renderer?.dispose(),
  };
}
