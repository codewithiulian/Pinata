import { useState, useEffect, useRef, useCallback } from "react";
import { C } from "../../styles/theme";

function formatSize(bytes) {
  if (!bytes) return "";
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const ZOOM_STEPS = [0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3];
const MIN_ZOOM = ZOOM_STEPS[0];
const MAX_ZOOM = ZOOM_STEPS[ZOOM_STEPS.length - 1];

function ZoomBtn({ onClick, disabled, children }) {
  return (
    <button onClick={onClick} disabled={disabled} style={{
      width: 32, height: 28, display: "flex", alignItems: "center", justifyContent: "center",
      background: disabled ? C.bg : C.card, border: `1px solid ${C.border}`,
      borderRadius: 6, cursor: disabled ? "default" : "pointer",
      color: disabled ? C.border : C.text, fontSize: 16, fontWeight: 700,
      fontFamily: "'Nunito', sans-serif", opacity: disabled ? 0.5 : 1,
      WebkitTapHighlightColor: "transparent",
    }}>
      {children}
    </button>
  );
}

export default function MobilePdfViewer({ blob, fileName, fileSize, isCached, onClose }) {
  const scrollRef = useRef(null);
  const contentRef = useRef(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [rendered, setRendered] = useState(0);
  const [total, setTotal] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [scale, setScale] = useState(1);
  const [contentH, setContentH] = useState(0);
  const pdfDocRef = useRef(null);
  const pageOffsetsRef = useRef([]);

  // --- Zoom helpers ---
  const applyZoom = useCallback((newScale) => {
    const content = contentRef.current;
    const scroll = scrollRef.current;
    if (!content || !scroll) return;

    const containerW = scroll.clientWidth || window.innerWidth;
    content.style.transform = `scale(${newScale})`;
    content.parentElement.style.height = `${contentH * newScale}px`;
    content.parentElement.style.width = `${containerW * newScale}px`;
  }, [contentH]);

  const zoomTo = useCallback((newScale) => {
    const scroll = scrollRef.current;
    if (!scroll) return;

    const oldScale = scale;
    const viewportW = scroll.clientWidth;
    const viewportH = scroll.clientHeight;

    // Zoom centered on the current viewport center
    const centerX = (scroll.scrollLeft + viewportW / 2) / oldScale;
    const centerY = (scroll.scrollTop + viewportH / 2) / oldScale;

    applyZoom(newScale);
    setScale(newScale);

    scroll.scrollLeft = centerX * newScale - viewportW / 2;
    scroll.scrollTop = centerY * newScale - viewportH / 2;
  }, [scale, applyZoom]);

  const zoomIn = useCallback(() => {
    const next = ZOOM_STEPS.find(s => s > scale + 0.01);
    if (next) zoomTo(next);
  }, [scale, zoomTo]);

  const zoomOut = useCallback(() => {
    const prev = [...ZOOM_STEPS].reverse().find(s => s < scale - 0.01);
    if (prev) zoomTo(prev);
  }, [scale, zoomTo]);

  const zoomReset = useCallback(() => {
    applyZoom(1);
    setScale(1);
    if (scrollRef.current) scrollRef.current.scrollLeft = 0;
  }, [applyZoom]);

  // --- Render PDF pages ---
  useEffect(() => {
    if (!blob) return;
    let cancelled = false;

    async function renderPdf() {
      try {
        const pdfjsLib = await import("pdfjs-dist");
        pdfjsLib.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

        const arrayBuffer = await blob.arrayBuffer();
        const pdfDoc = await pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) }).promise;
        if (cancelled) { pdfDoc.destroy(); return; }

        pdfDocRef.current = pdfDoc;
        setTotal(pdfDoc.numPages);

        const content = contentRef.current;
        const scroll = scrollRef.current;
        if (!content || !scroll) return;
        content.innerHTML = "";

        const containerWidth = scroll.clientWidth || window.innerWidth;
        const dpr = window.devicePixelRatio || 1;
        const offsets = [];

        for (let i = 1; i <= pdfDoc.numPages; i++) {
          if (cancelled) break;
          const page = await pdfDoc.getPage(i);
          const vp = page.getViewport({ scale: 1 });
          const s = containerWidth / vp.width;
          const svp = page.getViewport({ scale: s });

          const canvas = document.createElement("canvas");
          canvas.width = Math.floor(svp.width * dpr);
          canvas.height = Math.floor(svp.height * dpr);
          canvas.style.width = `${Math.floor(svp.width)}px`;
          canvas.style.height = `${Math.floor(svp.height)}px`;
          canvas.style.display = "block";

          const ctx = canvas.getContext("2d");
          ctx.scale(dpr, dpr);
          await page.render({ canvasContext: ctx, viewport: svp }).promise;

          offsets.push(content.scrollHeight);
          content.appendChild(canvas);
          setRendered(i);
          if (i === 1) setLoading(false);
        }

        pageOffsetsRef.current = offsets;
        setContentH(content.scrollHeight);
      } catch (err) {
        if (!cancelled) {
          console.error("PDF render error:", err);
          setError(err.message || "Failed to render PDF");
          setLoading(false);
        }
      }
    }

    renderPdf();
    return () => {
      cancelled = true;
      if (pdfDocRef.current) { pdfDocRef.current.destroy(); pdfDocRef.current = null; }
    };
  }, [blob]);

  // --- Track current page on scroll ---
  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el || !pageOffsetsRef.current.length) return;
    const scrollTop = el.scrollTop;
    let page = 1;
    for (let i = 0; i < pageOffsetsRef.current.length; i++) {
      if (scrollTop >= pageOffsetsRef.current[i] * scale - 80) page = i + 1;
    }
    setCurrentPage(page);
  }, [scale]);

  return (
    <div style={{
      position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
      background: C.card, zIndex: 9999,
      display: "flex", flexDirection: "column", overflow: "hidden",
    }}>
      {/* Top bar */}
      <div style={{
        display: "flex", alignItems: "center", gap: 8,
        padding: "12px 16px",
        paddingTop: "max(12px, env(safe-area-inset-top, 12px))",
        borderBottom: `1px solid ${C.border}`,
        flexShrink: 0, background: C.card, zIndex: 2,
      }}>
        <button onClick={onClose} style={{
          background: "none", border: "none", color: C.accent,
          fontWeight: 700, fontSize: 14, cursor: "pointer",
          display: "flex", alignItems: "center", gap: 4,
          fontFamily: "'Nunito', sans-serif", padding: 0, flexShrink: 0,
        }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          Lesson
        </button>

        <div style={{ flex: 1, textAlign: "center", overflow: "hidden", minWidth: 0 }}>
          <div style={{
            fontSize: 14, fontWeight: 700, color: C.text,
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>
            {fileName}
          </div>
          <div style={{
            fontSize: 11, fontWeight: 600, color: C.muted,
            display: "flex", alignItems: "center", justifyContent: "center", gap: 4, marginTop: 1,
          }}>
            {isCached && (
              <>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={C.success} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                  <polyline points="22 4 12 14.01 9 11.01" />
                </svg>
                <span>Available offline</span>
              </>
            )}
            {fileSize ? <span>{isCached ? " \u00B7 " : ""}{formatSize(fileSize)}</span> : null}
          </div>
        </div>

        <div style={{ width: 50, flexShrink: 0 }} />
      </div>

      {/* Toolbar: page indicator + zoom controls */}
      {!loading && total > 0 && (
        <div style={{
          padding: "6px 12px", background: C.bg, flexShrink: 0,
          display: "flex", justifyContent: "space-between", alignItems: "center",
          borderBottom: `1px solid ${C.border}`,
        }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: C.muted }}>
            {rendered < total ? `Rendering... ${rendered}/${total}` : `Page ${currentPage} of ${total}`}
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            {scale !== 1 && (
              <button onClick={zoomReset} style={{
                fontSize: 11, fontWeight: 700, color: C.accent, background: C.accentLight,
                border: "none", borderRadius: 6, padding: "4px 8px", cursor: "pointer",
                fontFamily: "'Nunito', sans-serif", marginRight: 4,
                WebkitTapHighlightColor: "transparent",
              }}>
                Reset
              </button>
            )}
            <ZoomBtn onClick={zoomOut} disabled={scale <= MIN_ZOOM}>−</ZoomBtn>
            <span style={{
              fontSize: 12, fontWeight: 700, color: C.text,
              minWidth: 40, textAlign: "center", userSelect: "none",
            }}>
              {Math.round(scale * 100)}%
            </span>
            <ZoomBtn onClick={zoomIn} disabled={scale >= MAX_ZOOM}>+</ZoomBtn>
          </div>
        </div>
      )}

      {/* Loading */}
      {loading && !error && (
        <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%, -50%)", zIndex: 3 }}>
          <div className="skeleton" style={{ width: 200, height: 280, borderRadius: 8 }} />
        </div>
      )}

      {/* Error */}
      {error && (
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: 32, textAlign: "center" }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: C.error, marginBottom: 8 }}>Failed to load PDF</div>
            <div style={{ fontSize: 12, color: C.muted }}>{error}</div>
          </div>
        </div>
      )}

      {/* Scrollable PDF — pinch zoom disabled, use toolbar controls */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        style={{
          flex: 1, overflow: "auto", WebkitOverflowScrolling: "touch",
          background: "#e8e8e8",
          opacity: loading ? 0 : 1, transition: "opacity 0.2s",
          touchAction: "pan-x pan-y",
        }}
      >
        {/* Size wrapper — grows with scale so scrolling works */}
        <div style={{ width: "100%", height: contentH || "auto", overflow: "hidden" }}>
          <div
            ref={contentRef}
            style={{ transformOrigin: "0 0", transform: `scale(${scale})` }}
          />
        </div>
      </div>
    </div>
  );
}
