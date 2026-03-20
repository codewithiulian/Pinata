import { useState, useRef, useCallback } from "react";
import { C } from "../../styles/theme";

function formatSize(bytes) {
  if (!bytes) return "";
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function PdfSection({ pdfInfo, isLoading, uploadProgress, onUpload, onView, onDelete }) {
  const fileRef = useRef(null);
  const [dragging, setDragging] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [viewing, setViewing] = useState(false);
  const [showViewer, setShowViewer] = useState(false);
  const [pdfBlobUrl, setPdfBlobUrl] = useState(null);

  const handleFile = useCallback((file) => {
    if (!file) return;
    if (file.type !== "application/pdf") { alert("Only PDF files are allowed."); return; }
    if (file.size > 10 * 1024 * 1024) { alert("File too large (max 10 MB)."); return; }
    onUpload(file);
  }, [onUpload]);

  const handleDrop = useCallback((e) => {
    e.preventDefault(); setDragging(false);
    const file = e.dataTransfer?.files?.[0];
    handleFile(file);
  }, [handleFile]);

  const handleView = async () => {
    setViewing(true);
    try {
      const blob = await onView();
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      setPdfBlobUrl(url);
      setShowViewer(true);
    } finally {
      setViewing(false);
    }
  };

  const handleCloseViewer = () => {
    setShowViewer(false);
    if (pdfBlobUrl) {
      URL.revokeObjectURL(pdfBlobUrl);
      setPdfBlobUrl(null);
    }
  };

  const handleDelete = async () => {
    if (!confirm("Remove PDF from this lesson?")) return;
    setDeleting(true);
    try { await onDelete(); } finally { setDeleting(false); }
  };

  if (isLoading) {
    return (
      <div style={{ background: C.card, borderRadius: 16, padding: 20, border: `1px solid ${C.border}` }}>
        <div style={{ fontSize: 15, fontWeight: 800, color: C.text, marginBottom: 12 }}>Course PDF</div>
        <div className="skeleton" style={{ height: 60, borderRadius: 12 }} />
      </div>
    );
  }

  // Uploading state
  if (uploadProgress !== null) {
    return (
      <div style={{ background: C.card, borderRadius: 16, padding: 20, border: `1px solid ${C.border}` }}>
        <div style={{ fontSize: 15, fontWeight: 800, color: C.text, marginBottom: 12 }}>Course PDF</div>
        <div style={{ background: C.accentLight, borderRadius: 12, padding: 16, textAlign: "center" }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 8 }}>
            Uploading... {uploadProgress}%
          </div>
          <div style={{ background: C.border, borderRadius: 4, height: 6, overflow: "hidden" }}>
            <div style={{ background: C.accent, height: "100%", width: `${uploadProgress}%`, borderRadius: 4, transition: "width 0.2s" }} />
          </div>
        </div>
      </div>
    );
  }

  // PDF attached
  if (pdfInfo) {
    return (
      <>
        <div style={{ background: C.card, borderRadius: 16, padding: 20, border: `1px solid ${C.border}` }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: C.text, marginBottom: 12 }}>Course PDF</div>

          {/* File info card */}
          <div style={{
            display: "flex", alignItems: "center", gap: 12, padding: 12,
            background: C.errorLight, borderRadius: 12, marginBottom: 12,
          }}>
            {/* PDF icon */}
            <div style={{
              width: 40, height: 40, borderRadius: 10, display: "flex",
              alignItems: "center", justifyContent: "center",
              background: "#FFD4DC",
            }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={C.error} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
              </svg>
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 800, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {pdfInfo.name}
              </div>
              <div style={{ fontSize: 12, fontWeight: 600, color: C.muted, display: "flex", alignItems: "center", gap: 6, marginTop: 2 }}>
                {formatSize(pdfInfo.size)}
                <span style={{ color: pdfInfo.isCached ? C.success : C.muted, fontWeight: 700 }}>
                  {pdfInfo.isCached ? "Available offline" : "Cloud only"}
                </span>
              </div>
            </div>
          </div>

          {/* Actions */}
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={handleView} disabled={viewing} style={{
              flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
              padding: "12px 16px", borderRadius: 12, border: "none",
              background: C.accent, color: "#fff", fontSize: 14, fontWeight: 800,
              cursor: "pointer", fontFamily: "'Nunito', sans-serif",
              opacity: viewing ? 0.7 : 1, transition: "filter 0.15s",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.filter = "brightness(1.08)")}
            onMouseLeave={(e) => (e.currentTarget.style.filter = "none")}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3" /><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
              </svg>
              {viewing ? "Opening..." : "View PDF"}
            </button>
            <button onClick={handleDelete} disabled={deleting} style={{
              padding: "12px 14px", borderRadius: 12, border: `1.5px solid ${C.border}`,
              background: C.card, color: C.muted, cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center",
              transition: "all 0.15s",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.borderColor = C.error; e.currentTarget.style.color = C.error; }}
            onMouseLeave={(e) => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.color = C.muted; }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
              </svg>
            </button>
          </div>
        </div>

        {/* Full-screen mobile PDF viewer overlay */}
        {showViewer && pdfBlobUrl && (
          <div style={{
            position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
            background: C.card, zIndex: 9999,
            display: "flex", flexDirection: "column",
            overflow: "hidden",
          }}>
            {/* Header */}
            <div style={{
              display: "flex", alignItems: "center", gap: 8,
              padding: "12px 16px",
              paddingTop: "max(12px, env(safe-area-inset-top, 12px))",
              borderBottom: `1px solid ${C.border}`,
              flexShrink: 0,
            }}>
              <button onClick={handleCloseViewer} style={{
                background: "none", border: "none", color: C.accent,
                fontWeight: 700, fontSize: 14, cursor: "pointer",
                display: "flex", alignItems: "center", gap: 4,
                fontFamily: "'Nunito', sans-serif", padding: 0,
                flexShrink: 0,
              }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="15 18 9 12 15 6" />
                </svg>
                Back
              </button>
              <span style={{
                fontSize: 14, fontWeight: 700, color: C.text,
                flex: 1, textAlign: "center",
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              }}>
                {pdfInfo.name}
              </span>
              {/* Spacer to balance the Back button */}
              <div style={{ width: 50, flexShrink: 0 }} />
            </div>

            {/* PDF iframe */}
            <iframe
              src={pdfBlobUrl + "#navpanes=0"}
              title="Course PDF"
              style={{ flex: 1, width: "100%", border: "none" }}
            />
          </div>
        )}
      </>
    );
  }

  // No PDF — upload zone
  return (
    <div style={{ background: C.card, borderRadius: 16, padding: 20, border: `1px solid ${C.border}` }}>
      <div style={{ fontSize: 15, fontWeight: 800, color: C.text, marginBottom: 12 }}>Course PDF</div>
      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        onClick={() => fileRef.current?.click()}
        style={{
          border: `2px dashed ${dragging ? C.accent : C.border}`,
          borderRadius: 12, padding: "28px 16px", textAlign: "center",
          cursor: "pointer", transition: "all 0.2s",
          background: dragging ? C.accentLight : "transparent",
        }}
      >
        <input ref={fileRef} type="file" accept="application/pdf" style={{ display: "none" }}
          onChange={(e) => handleFile(e.target.files?.[0])} />
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke={dragging ? C.accent : C.muted} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginBottom: 8 }}>
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" />
        </svg>
        <div style={{ fontSize: 14, fontWeight: 700, color: dragging ? C.accent : C.text }}>
          Drop your PDF here
        </div>
        <div style={{ fontSize: 12, fontWeight: 600, color: C.muted, marginTop: 4 }}>
          or click to browse · max 10MB
        </div>
      </div>
    </div>
  );
}
