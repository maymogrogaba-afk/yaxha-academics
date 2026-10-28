"use client";
// In-app PDF viewer (pdf.js): page navigation, zoom, full screen, download.
import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Download, ExternalLink, LoaderCircle, Maximize, ZoomIn, ZoomOut } from "lucide-react";
import { Button, buttonClass } from "./ui";

type PdfDoc = { numPages: number; getPage: (n: number) => Promise<PdfPage>; destroy: () => Promise<void> };
type PdfPage = {
  getViewport: (o: { scale: number }) => { width: number; height: number };
  render: (o: unknown) => { promise: Promise<void>; cancel: () => void };
};

export function PdfViewer({ url, downloadUrl, title }: { url: string; downloadUrl?: string; title: string }) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [doc, setDoc] = useState<PdfDoc | null>(null);
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [rendering, setRendering] = useState(true);
  const [pageInput, setPageInput] = useState("1");

  useEffect(() => {
    let cancelled = false;
    let loaded: PdfDoc | null = null;
    (async () => {
      try {
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
        loaded = (await pdfjs.getDocument({ url, withCredentials: true }).promise) as unknown as PdfDoc;
        if (!cancelled) setDoc(loaded);
      } catch (e) {
        if (!cancelled) setError(`This PDF could not be displayed (${(e as Error).message}). You can still download it.`);
      }
    })();
    return () => {
      cancelled = true;
      loaded?.destroy();
    };
  }, [url]);

  const render = useCallback(async () => {
    if (!doc || !canvas.current || !wrap.current) return;
    setRendering(true);
    const p = await doc.getPage(page);
    const base = p.getViewport({ scale: 1 });
    const available = Math.max(280, wrap.current.clientWidth - 2);
    const scale = (available / base.width) * zoom;
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    const vp = p.getViewport({ scale: scale * dpr });
    const c = canvas.current;
    c.width = Math.floor(vp.width);
    c.height = Math.floor(vp.height);
    c.style.width = `${Math.floor(vp.width / dpr)}px`;
    c.style.height = `${Math.floor(vp.height / dpr)}px`;
    const task = p.render({ canvasContext: c.getContext("2d"), canvas: c, viewport: vp });
    try {
      await task.promise;
    } catch {
      // A newer render replaced this one.
    }
    setRendering(false);
  }, [doc, page, zoom]);

  const [shownPage, setShownPage] = useState(page);
  if (shownPage !== page) {
    setShownPage(page);
    setPageInput(String(page));
  }

  useEffect(() => {
    render();
  }, [render]);

  useEffect(() => {
    const onResize = () => render();
    window.addEventListener("resize", onResize);
    document.addEventListener("fullscreenchange", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      document.removeEventListener("fullscreenchange", onResize);
    };
  }, [render]);

  const go = (n: number) => doc && setPage(Math.min(doc.numPages, Math.max(1, n)));

  return (
    <div
      ref={wrap}
      className="flex flex-col overflow-hidden rounded-card border border-line bg-[#0d0e11] fullscreen:rounded-none"
      onKeyDown={(e) => {
        if (e.key === "ArrowRight") go(page + 1);
        if (e.key === "ArrowLeft") go(page - 1);
      }}
      tabIndex={-1}
    >
      <div className="sticky top-0 z-10 flex flex-wrap items-center gap-1 border-b border-line bg-graphite px-2 py-1.5">
        <Button size="sm" variant="ghost" onClick={() => go(page - 1)} disabled={!doc || page <= 1} aria-label="Previous page">
          <ChevronLeft className="size-4" />
        </Button>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            go(Number(pageInput) || 1);
          }}
          className="flex items-center gap-1 text-xs text-muted"
        >
          <input
            value={pageInput}
            onChange={(e) => setPageInput(e.target.value.replace(/\D/g, ""))}
            className="h-7 w-10 rounded border border-line bg-obsidian text-center text-ivory"
            aria-label="Page number"
            inputMode="numeric"
          />
          <span>/ {doc?.numPages ?? "–"}</span>
        </form>
        <Button size="sm" variant="ghost" onClick={() => go(page + 1)} disabled={!doc || page >= (doc?.numPages ?? 1)} aria-label="Next page">
          <ChevronRight className="size-4" />
        </Button>
        <span className="mx-1 h-5 w-px bg-line" />
        <Button size="sm" variant="ghost" onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))} aria-label="Zoom out">
          <ZoomOut className="size-4" />
        </Button>
        <span className="w-10 text-center text-xs tabular-nums text-muted">{Math.round(zoom * 100)}%</span>
        <Button size="sm" variant="ghost" onClick={() => setZoom((z) => Math.min(3, z + 0.25))} aria-label="Zoom in">
          <ZoomIn className="size-4" />
        </Button>
        <div className="ml-auto flex items-center gap-1">
          <Button
            size="sm"
            variant="ghost"
            aria-label="Full screen"
            onClick={() => {
              if (document.fullscreenElement) document.exitFullscreen();
              else if (wrap.current?.requestFullscreen) wrap.current.requestFullscreen().catch(() => window.open(url, "_blank"));
              else window.open(url, "_blank");
            }}
          >
            <Maximize className="size-4" />
          </Button>
          <a href={url} target="_blank" rel="noopener" className={buttonClass("ghost", "sm")} aria-label="Open in new tab">
            <ExternalLink className="size-4" />
          </a>
          {downloadUrl && (
            <a href={downloadUrl} className={buttonClass("ghost", "sm")} aria-label="Download">
              <Download className="size-4" />
            </a>
          )}
        </div>
      </div>
      <div className="relative flex min-h-[60vh] justify-center overflow-auto p-1 fullscreen:h-full">
        {error ? (
          <p className="self-center p-6 text-center text-sm text-warn">{error}</p>
        ) : (
          <>
            {(rendering || !doc) && (
              <div className="absolute inset-0 flex items-center justify-center">
                <LoaderCircle className="size-6 animate-spin text-faint" aria-label="Loading page" />
              </div>
            )}
            <canvas ref={canvas} className="max-w-none bg-white shadow" aria-label={`${title}, page ${page}`} role="img" />
          </>
        )}
      </div>
    </div>
  );
}
