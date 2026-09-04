/// <reference types="vite/client" />

// pdfjs-dist liefert zwar Typen unter types/web/, verweist in der
// package.json aber nur auf types/src/pdf.d.ts. Der Viewer-Einstieg ist
// dadurch fuer TypeScript nicht aufloesbar. Die Bibliothek typisiert ihre
// Viewer-Optionen ohnehin als `any`, deshalb hier bewusst locker.
declare module "pdfjs-dist/web/pdf_viewer.mjs" {
  export const EventBus: any;
  export const PDFViewer: any;
  export const PDFLinkService: any;
  export const PDFFindController: any;
  export const PDFPageView: any;
  export const RenderingStates: any;
  export const ScrollMode: any;
  export const SpreadMode: any;
}
