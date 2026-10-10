/**
 * pdf.js, loaded only on the pages that need it (the Newsroom upload and the
 * reader). The legacy build runs on older Android WebViews too, which is where
 * most readers open editions.
 */

import workerUrl from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";

type PdfJs = typeof import("pdfjs-dist");
let lib: Promise<PdfJs> | null = null;

export function pdfjs(): Promise<PdfJs> {
  if (!lib) {
    lib = import("pdfjs-dist/legacy/build/pdf.mjs").then((m: any) => {
      m.GlobalWorkerOptions.workerSrc = workerUrl;
      return m as PdfJs;
    });
  }
  return lib;
}

/** Fonts and character maps the server serves from the package, for papers that do not embed every font. */
export const PDF_OPTIONS = { cMapUrl: "/pdfjs/cmaps/", cMapPacked: true, standardFontDataUrl: "/pdfjs/standard_fonts/", isEvalSupported: false } as const;

export async function openPdf(src: ArrayBuffer | string) {
  const p = await pdfjs();
  return p.getDocument(typeof src === "string" ? { url: src, ...PDF_OPTIONS } : { data: new Uint8Array(src), ...PDF_OPTIONS }).promise;
}

/**
 * What a shared link shows: the top half of page 1, as a JPEG about 1200px
 * wide. Made in the partner's browser at upload, so the server never has to
 * render a PDF.
 */
export async function previewOf(file: File): Promise<{ preview: Blob; pages: number }> {
  const doc = await openPdf(await file.arrayBuffer());
  try {
    const page = await doc.getPage(1);
    const base = page.getViewport({ scale: 1 });
    const scale = Math.min(3, 1200 / base.width);
    const vp = page.getViewport({ scale });
    const full = document.createElement("canvas");
    full.width = Math.round(vp.width); full.height = Math.round(vp.height);
    const ctx = full.getContext("2d")!;
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, full.width, full.height);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    const half = document.createElement("canvas");
    half.width = full.width; half.height = Math.round(full.height / 2);
    half.getContext("2d")!.drawImage(full, 0, 0);
    const preview = await new Promise<Blob>((res, rej) => half.toBlob(b => (b ? res(b) : rej(new Error("Could not make the preview"))), "image/jpeg", 0.82));
    return { preview, pages: doc.numPages };
  } finally {
    void doc.destroy();
  }
}
