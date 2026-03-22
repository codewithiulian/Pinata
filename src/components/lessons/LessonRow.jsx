import { useState, useRef, useEffect } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { C } from "../../styles/theme";
import { isCached } from "../../lib/pdf-cache";

function stripMarkdown(md) {
  return (md || "")
    .replace(/#{1,6}\s/g, "")
    .replace(/\*{1,3}(.*?)\*{1,3}/g, "$1")
    .replace(/`{1,3}[^`]*`{1,3}/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[>\-|]/g, "")
    .replace(/\n+/g, " ")
    .trim()
    .slice(0, 80);
}

export default function LessonRow({ lesson, weekTitle, onSelect, onDelete, onUpload, onAddQuiz, quizCount = 0 }) {
  const [pdfCached, setPdfCached] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    if (lesson.pdf_path) isCached(lesson.id).then(setPdfCached).catch(() => {});
  }, [lesson.id, lesson.pdf_path]);

  // Close mobile menu on outside click
  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", handler);
    document.addEventListener("touchstart", handler);
    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("touchstart", handler);
    };
  }, [menuOpen]);

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: lesson.id });

  const description = stripMarkdown(lesson.markdown_content);

  /* ── Badges ── */
  const badges = [];

  if (lesson.pdf_path) {
    badges.push(
      <span key="pdf" style={{
        display: "inline-flex", alignItems: "center", gap: 3,
        padding: "2px 8px", borderRadius: 6,
        background: C.errorLight, color: C.error,
        fontSize: 11, fontWeight: 800,
      }}>
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
        </svg>
        PDF
      </span>
    );
    if (pdfCached) {
      badges.push(
        <span key="cached" style={{
          display: "inline-flex", alignItems: "center", gap: 3,
          padding: "2px 8px", borderRadius: 6,
          background: C.successLight, color: C.success,
          fontSize: 11, fontWeight: 800,
        }}>
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
          Cached
        </span>
      );
    }
  } else {
    badges.push(
      <span key="nopdf" style={{
        display: "inline-flex", alignItems: "center", gap: 3,
        padding: "2px 8px", borderRadius: 6,
        background: "#F1F5F9", color: "#64748B",
        fontSize: 11, fontWeight: 800,
      }}>
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" />
        </svg>
        No PDF
      </span>
    );
  }

  if (quizCount > 0) {
    badges.push(
      <span key="quiz" style={{
        display: "inline-flex", alignItems: "center", gap: 3,
        padding: "2px 8px", borderRadius: 6,
        background: C.quizLight, color: C.quiz,
        fontSize: 11, fontWeight: 800,
      }}>
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
          <circle cx="12" cy="12" r="10" />
          <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
          <line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
        {quizCount} quiz{quizCount > 1 ? "zes" : ""}
      </span>
    );
  } else {
    badges.push(
      <span key="noquiz" style={{
        display: "inline-flex", alignItems: "center", gap: 3,
        padding: "2px 8px", borderRadius: 6,
        background: C.amberLight, color: C.amber,
        fontSize: 11, fontWeight: 800,
      }}>
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
        No quiz
      </span>
    );
  }

  const badgeElements = <>{badges}</>;

  /* ── Desktop action button helper ── */
  const actionBtn = (label, svgContent, onClick, hoverColor) => (
    <button
      key={label}
      onClick={e => { e.stopPropagation(); onClick(); }}
      title={label}
      style={{
        width: 28, height: 28, borderRadius: 8,
        border: "none", background: "transparent",
        color: C.muted, cursor: "pointer",
        display: "flex", alignItems: "center", justifyContent: "center",
        transition: "color 0.12s, background 0.12s",
      }}
      onMouseEnter={e => { e.currentTarget.style.color = hoverColor; e.currentTarget.style.background = hoverColor + "18"; }}
      onMouseLeave={e => { e.currentTarget.style.color = C.muted; e.currentTarget.style.background = "transparent"; }}
    >
      {svgContent}
    </button>
  );

  /* ── Mobile menu items ── */
  const mobileMenuItems = [
    {
      label: "Upload PDF",
      action: () => onUpload(lesson),
      icon: (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" />
        </svg>
      ),
    },
    {
      label: "Generate quiz",
      action: () => onAddQuiz(lesson),
      icon: (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
        </svg>
      ),
    },
    {
      label: "Delete",
      action: () => onDelete(lesson),
      destructive: true,
      icon: (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <polyline points="3 6 5 6 21 6" />
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
        </svg>
      ),
    },
  ];

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
      }}
    >
      <div className="lesson-row-v2" onClick={() => onSelect(lesson)}>
        {/* Drag handle (desktop, visible on hover) */}
        <div className="lesson-drag-v2" {...attributes} {...listeners} style={{ touchAction: "none" }}>
          <svg width="12" height="16" viewBox="0 0 12 16" fill={C.border} stroke="none">
            <circle cx="3" cy="2" r="1.5" /><circle cx="9" cy="2" r="1.5" />
            <circle cx="3" cy="8" r="1.5" /><circle cx="9" cy="8" r="1.5" />
            <circle cx="3" cy="14" r="1.5" /><circle cx="9" cy="14" r="1.5" />
          </svg>
        </div>

        {/* Content (title + description + mobile badges) */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 14, fontWeight: 700, color: C.text,
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>
            {lesson.title}
          </div>
          {description && (
            <div style={{
              fontSize: 12, fontWeight: 600, color: C.muted,
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginTop: 2,
            }}>
              {description}
            </div>
          )}
          {/* Badges — mobile position */}
          <div className="lesson-badges-m">{badgeElements}</div>
        </div>

        {/* Badges — desktop position */}
        <div className="lesson-badges-d">{badgeElements}</div>

        {/* Action buttons — desktop, visible on row hover */}
        <div className="lesson-actions-d">
          {actionBtn(
            "Upload PDF",
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" />
            </svg>,
            () => onUpload(lesson),
            C.accent
          )}
          {actionBtn(
            "Generate quiz",
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
            </svg>,
            () => onAddQuiz(lesson),
            C.quiz
          )}
          {actionBtn(
            "Delete",
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
            </svg>,
            () => onDelete(lesson),
            C.error
          )}
        </div>

        {/* Three-dot menu — mobile only */}
        <div className="lesson-dotmenu-m" ref={menuRef} style={{ position: "relative" }}>
          <button
            onClick={e => { e.stopPropagation(); setMenuOpen(!menuOpen); }}
            style={{
              background: "none", border: "none", padding: "4px 8px",
              color: C.muted, cursor: "pointer", fontSize: 20, lineHeight: 1,
              fontFamily: "serif",
            }}
          >
            &#8942;
          </button>
          {menuOpen && (
            <div style={{
              position: "absolute", right: 0, top: "100%", zIndex: 20,
              background: C.card, borderRadius: 12, padding: 4,
              boxShadow: "0 4px 16px rgba(0,60,50,0.12)",
              border: `1px solid ${C.border}`, minWidth: 170,
              animation: "fadeIn 0.1s ease-out",
            }}>
              {mobileMenuItems.map(item => (
                <button
                  key={item.label}
                  onClick={e => { e.stopPropagation(); setMenuOpen(false); item.action(); }}
                  style={{
                    display: "flex", alignItems: "center", gap: 10, width: "100%",
                    padding: "10px 12px", border: "none", background: "transparent",
                    color: item.destructive ? C.error : C.text,
                    fontWeight: 600, fontSize: 14, cursor: "pointer",
                    fontFamily: "'Nunito', sans-serif", borderRadius: 8, textAlign: "left",
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = item.destructive ? C.errorLight : C.accentLight)}
                  onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
                >
                  <span style={{ color: item.destructive ? C.error : C.muted, display: "flex" }}>{item.icon}</span>
                  {item.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
