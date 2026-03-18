import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { Routes, Route, useNavigate, useParams, useSearchParams, useLocation, Navigate } from "react-router-dom";
import { useQuizHistory } from "./useQuizHistory.js";
import { getQuizById } from "./db.js";

// ═══════════════════════════════════════════════════════════════
// STYLES
// ═══════════════════════════════════════════════════════════════
const injectStyles = () => {
  if (document.getElementById("sq-styles")) return;
  const s = document.createElement("style");
  s.id = "sq-styles";
  s.textContent = `
    @import url('https://fonts.googleapis.com/css2?family=DM+Serif+Display:ital@0;1&family=Figtree:ital,wght@0,400;0,500;0,600;0,700;1,400&display=swap');
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { background: #FAF7F2; font-family: 'Figtree', system-ui, sans-serif; color: #2C2420; -webkit-font-smoothing: antialiased; }
    h1, h2, h3, h4 { font-family: 'DM Serif Display', Georgia, serif; font-weight: 400; }
    .fade-in { animation: fadeIn 0.4s ease-out both; }
    @keyframes fadeIn { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: translateY(0); } }
    @keyframes scoreReveal { from { stroke-dashoffset: 339.292; } }
    @keyframes countUp { from { opacity: 0; transform: scale(0.8); } to { opacity: 1; transform: scale(1); } }
    .score-anim { animation: countUp 0.6s 0.5s ease-out both; }
    input[type="text"], textarea { font-family: 'Figtree', system-ui, sans-serif; }
    ::placeholder { color: #B5ADA6; }
  `;
  document.head.appendChild(s);
};

const C = {
  bg: "#FAF7F2", card: "#FFFFFF", accent: "#B8622D", accentLight: "#F5EDE6",
  accentHover: "#9E5324", text: "#2C2420", muted: "#8C7E76", success: "#2A7D5F",
  successLight: "#EBF5EE", error: "#B84040", errorLight: "#FDEDEE",
  border: "#E8E2DC", inputBg: "#FDFCFA",
};

// ═══════════════════════════════════════════════════════════════
// UTILITIES
// ═══════════════════════════════════════════════════════════════
const norm = (s) =>
  (s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[¿¡.,!?;:'"]/g, "").replace(/\s+/g, " ").trim();

const levenshtein = (a, b) => {
  const m = a.length, n = b.length;
  const d = Array.from({ length: m + 1 }, (_, i) => [i]);
  for (let j = 1; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] !== b[j - 1] ? 1 : 0));
  return d[m][n];
};

const fuzzyMatch = (input, target, threshold) => {
  const a = norm(input), b = norm(target);
  if (a === b) return true;
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return true;
  const dist = levenshtein(a, b);
  return dist <= (threshold !== undefined ? threshold : Math.max(2, Math.floor(maxLen * 0.12)));
};

const grade = (q, a) => {
  if (!a || a.skipped) return { correct: false };
  switch (q.type) {
    case "fill_blank": {
      const res = (q.accept || []).map((acc, i) =>
        (acc || []).some((x) => fuzzyMatch(a.blanks?.[i] || "", x, Math.max(1, Math.floor(norm(x).length * 0.15))))
      );
      return { correct: res.every(Boolean), blanksCorrect: res };
    }
    case "multiple_choice":
      return { correct: a.selected === q.answer };
    case "translate":
      return { correct: (q.accept || []).some((x) => fuzzyMatch(a.text || "", x)) };
    case "classify": {
      const map = {};
      Object.entries(q.categories).forEach(([cat, items]) => items.forEach((item) => (map[norm(item)] = cat)));
      const total = Object.values(q.categories).flat().length;
      const placed = Object.entries(a.placements || {}).flatMap(([cat, items]) => items.map((it) => ({ it, cat })));
      return { correct: placed.length === total && placed.every(({ it, cat }) => map[norm(it)] === cat) };
    }
    default:
      return { correct: false };
  }
};

const shuffle = (arr) => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
};

const typeLabels = { fill_blank: "Fill in the Blanks", multiple_choice: "Multiple Choice", translate: "Translate", classify: "Classify" };
const typeShortLabels = { fill_blank: "Fill", multiple_choice: "MC", translate: "Trans", classify: "Classify" };

const formatDate = (ts) => {
  const d = new Date(ts);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const day = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diff = today - day;
  if (diff === 0) return "Today";
  if (diff === 86400000) return "Yesterday";
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric" }).format(d);
};

// ═══════════════════════════════════════════════════════════════
// HISTORY SECTION
// ═══════════════════════════════════════════════════════════════
function MiniScoreCircle({ pct, size = 40 }) {
  const r = (size - 6) / 2;
  const circ = 2 * Math.PI * r;
  const color = pct >= 70 ? C.success : pct >= 50 ? C.accent : C.error;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={C.border} strokeWidth="3" />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth="3"
        strokeLinecap="round" strokeDasharray={circ} strokeDashoffset={circ - (pct / 100) * circ}
        transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      <text x={size / 2} y={size / 2} textAnchor="middle" dominantBaseline="central"
        fill={color} fontSize="10" fontWeight="700" fontFamily="'Figtree', sans-serif">
        {pct}%
      </text>
    </svg>
  );
}

function HistorySection({ attempts, onDelete, onSelect }) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? attempts : attempts.slice(0, 5);

  return (
    <div style={{ marginTop: 48 }}>
      <h2 style={{ fontSize: 22, color: C.text, marginBottom: 16 }}>Previous Attempts</h2>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {visible.map((a) => {
          const pct = a.score.percentage;
          const color = pct >= 70 ? C.success : pct >= 50 ? C.accent : C.error;
          return (
            <div key={a.id} className="fade-in" style={{
              background: C.card, border: `1px solid ${C.border}`, borderRadius: 14,
              padding: "16px 20px", position: "relative",
              cursor: onSelect ? "pointer" : "default", transition: "border-color 0.2s",
            }}
            onClick={() => onSelect?.(a)}
            onMouseEnter={(e) => { if (onSelect) e.currentTarget.style.borderColor = C.accent; const b = e.currentTarget.querySelector("[data-del]"); if (b) b.style.opacity = "1"; }}
            onMouseLeave={(e) => { e.currentTarget.style.borderColor = C.border; const b = e.currentTarget.querySelector("[data-del]"); if (b) b.style.opacity = "0"; }}
            >
              {/* Top row: score circle + title + date */}
              <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 10 }}>
                <MiniScoreCircle pct={pct} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 15, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {a.meta?.title || "Quiz"}
                  </div>
                  <div style={{ fontSize: 12, color: C.muted }}>
                    {a.meta?.unit != null && a.meta?.lesson != null
                      ? `Unit ${a.meta.unit} · Lesson ${a.meta.lesson}`
                      : ""}
                  </div>
                </div>
                <div style={{ fontSize: 12, color: C.muted, whiteSpace: "nowrap" }}>{formatDate(a.timestamp)}</div>
              </div>

              {/* Progress bar */}
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                <div style={{ flex: 1, height: 6, background: C.border, borderRadius: 3, overflow: "hidden" }}>
                  <div style={{ height: "100%", background: color, borderRadius: 3, width: `${pct}%` }} />
                </div>
                <span style={{ fontSize: 12, color: C.muted, fontWeight: 600, whiteSpace: "nowrap" }}>
                  {a.score.correct}/{a.score.total} correct
                </span>
              </div>

              {/* Type breakdown pills */}
              {a.breakdown?.length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {a.breakdown.map((b) => (
                    <span key={b.type} style={{
                      display: "inline-block", padding: "3px 10px", borderRadius: 999,
                      fontSize: 11, fontWeight: 600, background: C.accentLight, color: C.accent,
                    }}>
                      {typeShortLabels[b.type] || b.label} {b.correct}/{b.total}
                    </span>
                  ))}
                </div>
              )}

              {/* Delete button */}
              <button data-del onClick={(e) => { e.stopPropagation(); onDelete(a.id); }}
                style={{
                  position: "absolute", top: 10, right: 10, background: "none", border: "none",
                  color: C.muted, cursor: "pointer", fontSize: 16, lineHeight: 1, padding: 4,
                  opacity: 0, transition: "opacity 0.2s",
                }}>
                ×
              </button>
            </div>
          );
        })}
      </div>
      {attempts.length > 5 && (
        <button onClick={() => setExpanded(!expanded)} style={{
          display: "block", margin: "16px auto 0", background: "none", border: "none",
          color: C.accent, fontSize: 13, fontWeight: 600, cursor: "pointer",
          fontFamily: "'Figtree', sans-serif",
        }}>
          {expanded ? "Show less" : `Show all ${attempts.length} attempts`}
        </button>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// UPLOAD SCREEN (Home — "/")
// ═══════════════════════════════════════════════════════════════
function UploadScreen({ onLoad, attempts, quizzes, loading, onDeleteAttempt, onDeleteQuiz, onSelectAttempt, onSelectQuiz }) {
  const [err, setErr] = useState("");
  const [dragging, setDragging] = useState(false);
  const ref = useRef();

  const handle = (file) => {
    setErr("");
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const d = JSON.parse(e.target.result);
        if (!d.questions?.length) throw new Error("No questions found");
        onLoad(d);
      } catch { setErr("Invalid file. Please upload a valid quiz JSON file."); }
    };
    reader.readAsText(file);
  };

  const hasHistory = !loading && attempts.length > 0;
  const hasQuizzes = !loading && quizzes.length > 0;
  const hasContent = hasHistory || hasQuizzes;

  const dragCounter = useRef(0);

  return (
    <div className="fade-in"
      onDragEnter={(e) => { e.preventDefault(); dragCounter.current++; setDragging(true); }}
      onDragOver={(e) => e.preventDefault()}
      onDragLeave={(e) => { e.preventDefault(); dragCounter.current--; if (dragCounter.current <= 0) { dragCounter.current = 0; setDragging(false); } }}
      onDrop={(e) => { e.preventDefault(); dragCounter.current = 0; setDragging(false); e.dataTransfer.files[0] && handle(e.dataTransfer.files[0]); }}
      style={{ minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: hasContent ? "flex-start" : "center", padding: "48px 24px", position: "relative" }}
    >
      {/* Full-page drop overlay */}
      {dragging && (
        <div style={{
          position: "fixed", inset: 0, background: `${C.accentLight}dd`, zIndex: 999,
          display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none",
        }}>
          <div style={{
            border: `3px dashed ${C.accent}`, borderRadius: 24, padding: "48px 64px",
            textAlign: "center", background: C.card, boxShadow: "0 8px 32px rgba(44,36,32,0.1)",
          }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>📄</div>
            <p style={{ fontWeight: 600, fontSize: 18, color: C.text, marginBottom: 4 }}>Drop your quiz file</p>
            <p style={{ color: C.muted, fontSize: 14 }}>JSON format</p>
          </div>
        </div>
      )}
      <div style={{ maxWidth: 440, width: "100%", textAlign: "center" }}>
        <div style={{ fontSize: 56, marginBottom: 8 }}>📖</div>
        <h1 style={{ fontSize: 36, color: C.text, marginBottom: 8, letterSpacing: "-0.5px" }}>Práctica</h1>
        <p style={{ color: C.muted, fontSize: 16, marginBottom: 36, lineHeight: 1.5 }}>
          Upload a quiz file to start your Spanish practice session
        </p>
        <div
          onClick={() => ref.current?.click()}
          style={{
            border: `2px dashed ${C.border}`,
            borderRadius: 16, padding: "48px 24px", cursor: "pointer",
            transition: "all 0.25s ease",
          }}
          onMouseEnter={(e) => { e.currentTarget.style.borderColor = C.accent; e.currentTarget.style.background = C.accentLight; }}
          onMouseLeave={(e) => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.background = "transparent"; }}
        >
          <div style={{ fontSize: 32, marginBottom: 8, opacity: 0.7 }}>📄</div>
          <p style={{ fontWeight: 600, color: C.text, marginBottom: 4 }}>Drop your quiz file here</p>
          <p style={{ color: C.muted, fontSize: 13 }}>or click to browse · JSON format</p>
          <input ref={ref} type="file" accept=".json" style={{ display: "none" }} onChange={(e) => e.target.files[0] && handle(e.target.files[0])} />
        </div>
        {err && <p style={{ color: C.error, fontSize: 13, marginTop: 16 }}>{err}</p>}
        {!hasContent && (
          <p style={{ color: C.muted, fontSize: 12, marginTop: 32, lineHeight: 1.6 }}>
            Quiz files contain questions generated from your lesson PDFs.
          </p>
        )}
      </div>
      {hasQuizzes && (
        <div style={{ maxWidth: 520, width: "100%", textAlign: "left", marginTop: 40 }}>
          <h2 style={{ fontSize: 22, color: C.text, marginBottom: 16 }}>Saved Quizzes</h2>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {quizzes.map((q) => (
              <div key={q.id} className="fade-in" style={{
                background: C.card, border: `1px solid ${C.border}`, borderRadius: 14,
                padding: "14px 20px", display: "flex", alignItems: "center", gap: 14,
                cursor: "pointer", transition: "border-color 0.2s", position: "relative",
              }}
              onClick={() => onSelectQuiz(q)}
              onMouseEnter={(e) => { e.currentTarget.style.borderColor = C.accent; const b = e.currentTarget.querySelector("[data-qdel]"); if (b) b.style.opacity = "1"; }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = C.border; const b = e.currentTarget.querySelector("[data-qdel]"); if (b) b.style.opacity = "0"; }}
              >
                <div style={{ fontSize: 24, opacity: 0.7 }}>📄</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 15, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {q.data.meta?.title || "Quiz"}
                  </div>
                  <div style={{ fontSize: 12, color: C.muted }}>
                    {q.data.meta?.unit != null && q.data.meta?.lesson != null
                      ? `Unit ${q.data.meta.unit} · Lesson ${q.data.meta.lesson} · `
                      : ""}{q.data.questions?.length || 0} questions
                  </div>
                </div>
                <div style={{ fontSize: 13, color: C.accent, fontWeight: 600, whiteSpace: "nowrap" }}>Start →</div>
                <button data-qdel onClick={(e) => { e.stopPropagation(); onDeleteQuiz(q.id); }}
                  style={{
                    position: "absolute", top: 8, right: 8, background: "none", border: "none",
                    color: C.muted, cursor: "pointer", fontSize: 16, lineHeight: 1, padding: 4,
                    opacity: 0, transition: "opacity 0.2s",
                  }}>
                  ×
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
      {hasHistory && (
        <div style={{ maxWidth: 520, width: "100%", textAlign: "left" }}>
          <HistorySection attempts={attempts} onDelete={onDeleteAttempt} onSelect={onSelectAttempt} />
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// QUESTION COMPONENTS
// ═══════════════════════════════════════════════════════════════
function FillBlank({ q, value, onChange }) {
  const blanks = value?.blanks || [];
  const parts = q.prompt.split(/(___+)/);
  let idx = 0;

  const update = (i, v) => {
    const nb = [...blanks];
    nb[i] = v;
    onChange({ blanks: nb });
  };

  return (
    <div>
      <div style={{ fontSize: 18, lineHeight: 2.2, marginBottom: 8 }}>
        {parts.map((p, pi) => {
          if (/^___+$/.test(p)) {
            const ci = idx++;
            return (
              <input
                key={pi} type="text" value={blanks[ci] || ""} onChange={(e) => update(ci, e.target.value)}
                placeholder="..." autoComplete="off"
                style={{
                  display: "inline-block", border: "none", borderBottom: `2px solid ${C.accent}`,
                  background: "transparent", padding: "2px 6px", margin: "0 3px", textAlign: "center",
                  color: C.accent, fontWeight: 600, outline: "none", minWidth: 90, fontSize: "inherit",
                  lineHeight: "inherit", fontFamily: "'Figtree', sans-serif",
                }}
                onFocus={(e) => (e.target.style.borderColor = C.accentHover)}
                onBlur={(e) => (e.target.style.borderColor = C.accent)}
              />
            );
          }
          return <span key={pi}>{p}</span>;
        })}
      </div>
      {q.hint && <p style={{ color: C.muted, fontSize: 13, fontStyle: "italic", marginTop: 12 }}>💡 {q.hint}</p>}
    </div>
  );
}

function MultiChoice({ q, value, onChange }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {q.options.map((opt, i) => (
        <div
          key={i} onClick={() => onChange({ selected: i })}
          style={{
            padding: "14px 20px", borderRadius: 12, cursor: "pointer", transition: "all 0.2s",
            border: `1.5px solid ${value?.selected === i ? C.accent : C.border}`,
            background: value?.selected === i ? C.accentLight : C.card,
            color: value?.selected === i ? C.accent : C.text,
            fontWeight: value?.selected === i ? 600 : 400, fontSize: 15,
          }}
        >
          <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 24, height: 24, borderRadius: "50%", border: `1.5px solid ${value?.selected === i ? C.accent : C.border}`, marginRight: 12, fontSize: 12, fontWeight: 700, background: value?.selected === i ? C.accent : "transparent", color: value?.selected === i ? "white" : C.muted }}>
            {String.fromCharCode(65 + i)}
          </span>
          {opt}
        </div>
      ))}
    </div>
  );
}

function Translate({ q, value, onChange }) {
  return (
    <div>
      {q.direction && <p style={{ color: C.muted, fontSize: 13, marginBottom: 12, fontWeight: 500 }}>{q.direction}</p>}
      <textarea
        value={value?.text || ""} onChange={(e) => onChange({ text: e.target.value })}
        placeholder="Type your translation here..."
        rows={3}
        style={{
          width: "100%", padding: 16, borderRadius: 12, border: `1.5px solid ${C.border}`,
          background: C.inputBg, fontSize: 16, resize: "vertical", outline: "none",
          lineHeight: 1.6, color: C.text, transition: "border-color 0.2s",
        }}
        onFocus={(e) => (e.target.style.borderColor = C.accent)}
        onBlur={(e) => (e.target.style.borderColor = C.border)}
      />
      {q.hint && <p style={{ color: C.muted, fontSize: 13, fontStyle: "italic", marginTop: 10 }}>💡 {q.hint}</p>}
    </div>
  );
}

function Classify({ q, value, onChange }) {
  const allItems = useMemo(() => shuffle(Object.values(q.categories).flat()), [q]);
  const placements = value?.placements || {};
  const selected = value?._selected || null;
  const placed = Object.values(placements).flat();
  const unplaced = allItems.filter((it) => !placed.includes(it));

  const selectItem = (item) => {
    onChange({ ...value, placements, _selected: selected === item ? null : item });
  };

  const placeInCategory = (cat) => {
    if (!selected) return;
    const np = { ...placements };
    Object.keys(np).forEach((k) => (np[k] = (np[k] || []).filter((x) => x !== selected)));
    np[cat] = [...(np[cat] || []), selected];
    onChange({ placements: np, _selected: null });
  };

  const removeFromCategory = (item, cat) => {
    const np = { ...placements };
    np[cat] = (np[cat] || []).filter((x) => x !== item);
    onChange({ ...value, placements: np, _selected: null });
  };

  const chipStyle = (isSelected) => ({
    display: "inline-flex", alignItems: "center", padding: "7px 16px", borderRadius: 999,
    fontSize: 14, fontWeight: 500, cursor: "pointer", transition: "all 0.2s", userSelect: "none",
    border: `1.5px solid ${isSelected ? C.accent : C.border}`,
    background: isSelected ? C.accentLight : C.card,
    color: isSelected ? C.accent : C.text,
  });

  return (
    <div>
      {unplaced.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 20 }}>
          {unplaced.map((item) => (
            <span key={item} onClick={() => selectItem(item)} style={chipStyle(selected === item)}>{item}</span>
          ))}
        </div>
      )}
      {selected && <p style={{ color: C.accent, fontSize: 13, marginBottom: 12, fontWeight: 500 }}>👆 Now click a category below to place "{selected}"</p>}
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {Object.keys(q.categories).map((cat) => (
          <div key={cat}>
            <div
              onClick={() => placeInCategory(cat)}
              style={{
                border: `1.5px ${(placements[cat]?.length) ? "solid" : "dashed"} ${selected ? C.accent : C.border}`,
                borderRadius: 12, padding: 14, minHeight: 56, cursor: selected ? "pointer" : "default",
                transition: "all 0.2s", background: selected ? C.accentLight + "44" : "transparent",
              }}
            >
              <p style={{ fontSize: 13, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: (placements[cat]?.length) ? 10 : 0 }}>{cat}</p>
              {(placements[cat]?.length > 0) && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {placements[cat].map((item) => (
                    <span key={item} onClick={(e) => { e.stopPropagation(); removeFromCategory(item, cat); }}
                      style={{ ...chipStyle(false), background: C.accentLight, borderColor: C.accent, color: C.accent, fontSize: 13 }}>
                      {item} ×
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// BACK BUTTON
// ═══════════════════════════════════════════════════════════════
function BackButton({ onClick, label = "Home" }) {
  return (
    <button onClick={onClick} style={{
      background: "none", border: "none", color: C.muted, fontSize: 14,
      fontWeight: 500, cursor: "pointer", padding: "4px 0", marginBottom: 20,
      fontFamily: "'Figtree', sans-serif", display: "flex", alignItems: "center", gap: 6,
    }}
    onMouseEnter={(e) => (e.currentTarget.style.color = C.accent)}
    onMouseLeave={(e) => (e.currentTarget.style.color = C.muted)}
    >
      ← {label}
    </button>
  );
}

// ═══════════════════════════════════════════════════════════════
// QUIZ SCREEN (Route: /quiz/:quizId)
// ═══════════════════════════════════════════════════════════════
function QuizRoute({ saveAttempt }) {
  const { quizId } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [answers, setAnswers] = useState({});
  const [loadError, setLoadError] = useState(false);
  const [key, setKey] = useState(0);

  const numericId = parseInt(quizId, 10);
  const qParam = parseInt(searchParams.get("q") || "1", 10);
  const idx = Math.max(0, qParam - 1);

  useEffect(() => {
    if (isNaN(numericId)) { setLoadError(true); return; }
    let cancelled = false;
    getQuizById(numericId).then((quiz) => {
      if (cancelled) return;
      if (!quiz) { setLoadError(true); return; }
      setData(quiz.data);
    });
    return () => { cancelled = true; };
  }, [numericId]);

  if (loadError) return <Navigate to="/" replace />;
  if (!data) return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <p style={{ color: C.muted, fontSize: 16 }}>Loading quiz...</p>
    </div>
  );

  const q = data.questions[idx];
  const total = data.questions.length;

  if (!q) return <Navigate to={`/quiz/${quizId}?q=1`} replace />;

  const ans = answers[idx];

  const setAnswer = (a) => setAnswers((p) => ({ ...p, [idx]: a }));

  const canProceed = () => {
    if (!ans) return false;
    switch (q.type) {
      case "fill_blank": return (ans.blanks || []).some((b) => b?.trim());
      case "multiple_choice": return ans.selected !== undefined;
      case "translate": return !!ans.text?.trim();
      case "classify": return Object.values(ans.placements || {}).flat().length > 0;
      default: return false;
    }
  };

  const goToQuestion = (n) => {
    setSearchParams({ q: String(n) }, { replace: true });
    setKey((k) => k + 1);
  };

  const handleFinish = (finalAnswers) => {
    const res = data.questions.map((qu, i) => grade(qu, finalAnswers[i]));
    const correct = res.filter((r) => r.correct).length;
    const breakdown = Object.entries(
      data.questions.reduce((acc, qu, i) => {
        if (!acc[qu.type]) acc[qu.type] = { type: qu.type, label: typeLabels[qu.type] || qu.type, correct: 0, total: 0 };
        acc[qu.type].total++;
        if (res[i].correct) acc[qu.type].correct++;
        return acc;
      }, {})
    ).map(([, v]) => v);

    const quizKey = data.meta?.unit != null && data.meta?.lesson != null
      ? `u${data.meta.unit}-l${data.meta.lesson}` : "unknown";

    const attempt = {
      timestamp: Date.now(),
      quizKey,
      quizId: numericId,
      meta: { title: data.meta?.title, description: data.meta?.description, unit: data.meta?.unit, lesson: data.meta?.lesson },
      score: { correct, total, percentage: Math.round((correct / total) * 100) },
      breakdown,
      answers: finalAnswers,
      results: res,
      questions: data.questions,
    };

    saveAttempt(attempt);
    navigate(`/quiz/${quizId}/results`, { state: { attempt } });
  };

  const next = () => {
    if (idx < total - 1) goToQuestion(idx + 2);
    else handleFinish(answers);
  };

  const skip = () => {
    const updated = { ...answers, [idx]: { skipped: true } };
    setAnswers(updated);
    if (idx < total - 1) goToQuestion(idx + 2);
    else handleFinish(updated);
  };

  const QComponent = { fill_blank: FillBlank, multiple_choice: MultiChoice, translate: Translate, classify: Classify }[q.type];

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", padding: "32px 20px" }}>
      <div style={{ maxWidth: 580, width: "100%" }}>
        <BackButton onClick={() => navigate("/")} />

        {/* Header */}
        <div style={{ marginBottom: 32 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: C.muted }}>{idx + 1} / {total}</span>
            <span style={{ fontSize: 12, color: C.accent, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5 }}>
              {typeLabels[q.type] || q.type}
            </span>
          </div>
          <div style={{ height: 4, background: C.border, borderRadius: 2, overflow: "hidden" }}>
            <div style={{ height: "100%", background: C.accent, borderRadius: 2, transition: "width 0.4s ease", width: `${((idx + 1) / total) * 100}%` }} />
          </div>
        </div>

        {/* Question Card */}
        <div key={key} className="fade-in" style={{
          background: C.card, border: `1px solid ${C.border}`, borderRadius: 20,
          padding: "36px 32px", boxShadow: "0 1px 3px rgba(44,36,32,0.04), 0 6px 16px rgba(44,36,32,0.03)",
        }}>
          <h2 style={{ fontSize: 22, lineHeight: 1.4, marginBottom: 28, color: C.text }}>{q.prompt.includes("___") && q.type === "fill_blank" ? "" : q.prompt}</h2>
          {QComponent && <QComponent q={q} value={ans} onChange={setAnswer} />}
        </div>

        {/* Navigation */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 24 }}>
          <button onClick={skip} style={{
            background: "transparent", border: "none", color: C.muted, fontSize: 14,
            fontWeight: 500, cursor: "pointer", padding: "8px 0", fontFamily: "'Figtree', sans-serif",
          }}>
            Skip →
          </button>
          <button
            onClick={next} disabled={!canProceed()}
            style={{
              background: canProceed() ? C.accent : C.border, color: "white", border: "none",
              padding: "13px 36px", borderRadius: 12, fontWeight: 600, fontSize: 15,
              cursor: canProceed() ? "pointer" : "not-allowed", transition: "all 0.2s",
              fontFamily: "'Figtree', sans-serif", opacity: canProceed() ? 1 : 0.5,
            }}
            onMouseEnter={(e) => canProceed() && (e.target.style.background = C.accentHover)}
            onMouseLeave={(e) => canProceed() && (e.target.style.background = C.accent)}
          >
            {idx === total - 1 ? "Finish" : "Next"}
          </button>
        </div>

        {/* Meta */}
        {data.meta?.title && (
          <p style={{ textAlign: "center", color: C.muted, fontSize: 12, marginTop: 32, opacity: 0.6 }}>
            {data.meta.title}
          </p>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// RESULTS PAGE (Route: /quiz/:quizId/results)
// Merges ScoreScreen + ReviewScreen into one page
// ═══════════════════════════════════════════════════════════════
function ResultsRoute() {
  const { quizId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const [overrides, setOverrides] = useState({});

  // Data comes from router state (just finished quiz or clicked history card)
  const attempt = location.state?.attempt;

  if (!attempt) return <Navigate to="/" replace />;

  const { questions, answers, results, score, breakdown } = attempt;
  const data = { questions, meta: attempt.meta };
  const isFromHistory = !location.state?.fromQuiz;

  const effectiveResults = results.map((r, i) => overrides[i] ? { correct: true } : r);
  const correct = effectiveResults.filter((r) => r.correct).length;
  const total = questions.length;
  const pct = Math.round((correct / total) * 100);
  const circ = 2 * Math.PI * 54;
  const hasOverrides = Object.keys(overrides).length > 0;

  const msg = pct >= 90 ? ["¡Excelente!", "🎉"] : pct >= 70 ? ["¡Muy bien!", "👏"] : pct >= 50 ? ["¡Buen esfuerzo!", "💪"] : ["¡Sigue practicando!", "📚"];

  const handleOverride = (idx, value = true) => {
    setOverrides((p) => {
      const n = { ...p };
      if (value) n[idx] = true; else delete n[idx];
      return n;
    });
  };

  const renderUserAnswer = (q, a, qIdx) => {
    if (!a || a.skipped) return <em style={{ color: C.muted }}>Skipped</em>;
    switch (q.type) {
      case "fill_blank":
        return (a.blanks || []).map((b, i) => (
          <span key={i} style={{
            display: "inline-block", padding: "3px 10px", borderRadius: 6, marginRight: 6, marginBottom: 4, fontSize: 14,
            background: results[qIdx]?.blanksCorrect?.[i] ? C.successLight : C.errorLight,
            color: results[qIdx]?.blanksCorrect?.[i] ? C.success : C.error,
            fontWeight: 600,
          }}>
            {b || "(empty)"}
          </span>
        ));
      case "multiple_choice":
        return <span style={{ fontWeight: 500 }}>{q.options[a.selected] || "(none)"}</span>;
      case "translate":
        return <span style={{ fontWeight: 500 }}>{a.text || "(empty)"}</span>;
      case "classify":
        return Object.entries(a.placements || {}).map(([cat, items]) => (
          items.length > 0 && <div key={cat} style={{ marginBottom: 4 }}>
            <span style={{ fontSize: 12, color: C.muted, fontWeight: 600 }}>{cat}: </span>
            <span style={{ fontSize: 14 }}>{items.join(", ")}</span>
          </div>
        ));
      default: return null;
    }
  };

  const renderCorrectAnswer = (q) => {
    switch (q.type) {
      case "fill_blank":
        return (q.blanks || []).map((b, i) => (
          <span key={i} style={{ display: "inline-block", padding: "3px 10px", borderRadius: 6, marginRight: 6, background: C.successLight, color: C.success, fontWeight: 600, fontSize: 14 }}>{b}</span>
        ));
      case "multiple_choice":
        return <span style={{ fontWeight: 500 }}>{q.options[q.answer]}</span>;
      case "translate":
        return <span style={{ fontWeight: 500 }}>{(q.accept || []).join(" / ")}</span>;
      case "classify":
        return Object.entries(q.categories).map(([cat, items]) => (
          <div key={cat} style={{ marginBottom: 4 }}>
            <span style={{ fontSize: 12, color: C.muted, fontWeight: 600 }}>{cat}: </span>
            <span style={{ fontSize: 14 }}>{items.join(", ")}</span>
          </div>
        ));
      default: return null;
    }
  };

  return (
    <div className="fade-in" style={{ minHeight: "100vh", padding: "32px 20px" }}>
      <div style={{ maxWidth: 600, margin: "0 auto" }}>
        <BackButton onClick={() => navigate("/")} />

        {/* ── Score Section ── */}
        <div style={{ textAlign: "center", marginBottom: 48 }}>
          {/* Score Circle */}
          <div style={{ position: "relative", display: "inline-block", marginBottom: 24 }}>
            <svg width="140" height="140" viewBox="0 0 120 120">
              <circle cx="60" cy="60" r="54" fill="none" stroke={C.border} strokeWidth="6" />
              <circle
                cx="60" cy="60" r="54" fill="none" stroke={pct >= 70 ? C.success : pct >= 50 ? C.accent : C.error}
                strokeWidth="6" strokeLinecap="round"
                strokeDasharray={circ} strokeDashoffset={circ - (pct / 100) * circ}
                transform="rotate(-90 60 60)"
                style={{ animation: "scoreReveal 1s ease-out forwards" }}
              />
            </svg>
            <div className="score-anim" style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%, -50%)" }}>
              <div style={{ fontSize: 36, fontWeight: 700, color: C.text, fontFamily: "'DM Serif Display', serif" }}>{pct}%</div>
            </div>
          </div>

          <div style={{ fontSize: 48, marginBottom: 8 }}>{msg[1]}</div>
          <h1 style={{ fontSize: 32, marginBottom: 8, color: C.text }}>{msg[0]}</h1>
          <p style={{ color: C.muted, fontSize: 16, marginBottom: 24 }}>
            {correct} of {total} correct{hasOverrides ? " (inc. overrides)" : ""}
          </p>

          {/* Type breakdown pills */}
          <div style={{ display: "flex", justifyContent: "center", gap: 16, marginBottom: 32, flexWrap: "wrap" }}>
            {Object.entries(
              questions.reduce((acc, q, i) => {
                const t = typeLabels[q.type] || q.type;
                if (!acc[t]) acc[t] = { correct: 0, total: 0 };
                acc[t].total++;
                if (effectiveResults[i].correct) acc[t].correct++;
                return acc;
              }, {})
            ).map(([type, stats]) => (
              <div key={type} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: "10px 16px", fontSize: 13 }}>
                <div style={{ fontWeight: 600, color: C.text }}>{stats.correct}/{stats.total}</div>
                <div style={{ color: C.muted, fontSize: 11 }}>{type}</div>
              </div>
            ))}
          </div>

          {/* Action Buttons */}
          <div style={{ display: "flex", justifyContent: "center", gap: 12, flexWrap: "wrap" }}>
            <button onClick={() => navigate(`/quiz/${quizId}?q=1`)} style={{
              background: C.accent, color: "white", border: "none", padding: "13px 28px",
              borderRadius: 12, fontWeight: 600, fontSize: 15, cursor: "pointer",
              fontFamily: "'Figtree', sans-serif", transition: "background 0.2s",
            }}
            onMouseEnter={(e) => (e.target.style.background = C.accentHover)}
            onMouseLeave={(e) => (e.target.style.background = C.accent)}
            >
              Try Again
            </button>
            <button onClick={() => navigate("/")} style={{
              background: "transparent", color: C.text, border: `1.5px solid ${C.border}`,
              padding: "13px 28px", borderRadius: 12, fontWeight: 600, fontSize: 15,
              cursor: "pointer", fontFamily: "'Figtree', sans-serif",
            }}>
              New Quiz
            </button>
          </div>
        </div>

        {/* ── Detailed Review Section ── */}
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
            <h2 style={{ fontSize: 24, color: C.text }}>Detailed Review</h2>
            <span style={{ color: C.muted, fontSize: 14 }}>{correct}/{total} correct</span>
          </div>

          {questions.map((q, i) => {
            const r = effectiveResults[i];
            const wasOverridden = overrides[i];
            const wasOriginallyWrong = !results[i].correct;
            const showOverrideButtons = !isFromHistory;
            return (
              <div key={i} style={{
                background: C.card, borderRadius: 14, padding: "22px 24px", marginBottom: 14,
                border: `1px solid ${C.border}`, borderLeft: `4px solid ${r.correct ? C.success : C.error}`,
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: C.muted }}>Q{i + 1} · {typeLabels[q.type]}</span>
                  <span style={{ fontSize: 12, fontWeight: 700, color: r.correct ? C.success : C.error }}>
                    {wasOverridden ? "✓ Overridden" : r.correct ? "✓ Correct" : "✗ Incorrect"}
                  </span>
                </div>
                <p style={{ fontSize: 16, fontWeight: 500, lineHeight: 1.5, marginBottom: 14, color: C.text }}>
                  {q.prompt.replace(/___+/g, "______")}
                </p>

                {wasOriginallyWrong && (
                  <div style={{ marginBottom: 10, padding: "10px 14px", borderRadius: 10, background: wasOverridden ? C.successLight : C.errorLight }}>
                    <p style={{ fontSize: 12, fontWeight: 600, color: wasOverridden ? C.success : C.error, marginBottom: 4 }}>Your answer:</p>
                    <div style={{ color: wasOverridden ? C.success : C.error }}>{renderUserAnswer(q, answers[i], i)}</div>
                  </div>
                )}

                <div style={{ padding: "10px 14px", borderRadius: 10, background: C.successLight }}>
                  <p style={{ fontSize: 12, fontWeight: 600, color: C.success, marginBottom: 4 }}>Correct answer:</p>
                  <div style={{ color: C.success }}>{renderCorrectAnswer(q)}</div>
                </div>

                {q.explanation && (
                  <p style={{ fontSize: 13, color: C.muted, marginTop: 10, lineHeight: 1.5, fontStyle: "italic" }}>
                    💡 {q.explanation}
                  </p>
                )}

                {/* Override button — only for just-completed quizzes, originally wrong, non-MC */}
                {showOverrideButtons && wasOriginallyWrong && !wasOverridden && q.type !== "multiple_choice" && (
                  <button onClick={() => handleOverride(i)} style={{
                    marginTop: 12, background: "transparent", border: `1.5px solid ${C.border}`,
                    borderRadius: 8, padding: "8px 16px", fontSize: 13, fontWeight: 600,
                    color: C.muted, cursor: "pointer", fontFamily: "'Figtree', sans-serif",
                    transition: "all 0.2s",
                  }}
                  onMouseEnter={(e) => { e.target.style.borderColor = C.success; e.target.style.color = C.success; }}
                  onMouseLeave={(e) => { e.target.style.borderColor = C.border; e.target.style.color = C.muted; }}
                  >
                    ✓ My answer was correct
                  </button>
                )}
                {showOverrideButtons && wasOverridden && (
                  <button onClick={() => handleOverride(i, false)} style={{
                    marginTop: 12, background: "transparent", border: `1.5px solid ${C.border}`,
                    borderRadius: 8, padding: "8px 16px", fontSize: 13, fontWeight: 500,
                    color: C.muted, cursor: "pointer", fontFamily: "'Figtree', sans-serif",
                  }}>
                    Undo override
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// HOME ROUTE WRAPPER
// ═══════════════════════════════════════════════════════════════
function HomeRoute({ history }) {
  const navigate = useNavigate();
  const { attempts, quizzes, loading, saveQuiz, deleteAttempt, deleteQuiz } = history;

  const handleLoad = async (d) => {
    const quizKey = d.meta?.unit != null && d.meta?.lesson != null
      ? `u${d.meta.unit}-l${d.meta.lesson}` : `quiz-${Date.now()}`;
    const id = await saveQuiz(quizKey, d);
    if (id != null) navigate(`/quiz/${id}?q=1`);
  };

  const handleSelectQuiz = (quiz) => {
    navigate(`/quiz/${quiz.id}?q=1`);
  };

  const handleSelectAttempt = (attempt) => {
    const quizId = attempt.quizId || attempt.id;
    navigate(`/quiz/${quizId}/results`, { state: { attempt } });
  };

  return (
    <UploadScreen
      onLoad={handleLoad}
      attempts={attempts}
      quizzes={quizzes}
      loading={loading}
      onDeleteAttempt={deleteAttempt}
      onDeleteQuiz={deleteQuiz}
      onSelectAttempt={handleSelectAttempt}
      onSelectQuiz={handleSelectQuiz}
    />
  );
}

// ═══════════════════════════════════════════════════════════════
// MAIN APP
// ═══════════════════════════════════════════════════════════════
export default function App() {
  const history = useQuizHistory();

  useEffect(() => { injectStyles(); }, []);

  return (
    <Routes>
      <Route path="/" element={<HomeRoute history={history} />} />
      <Route path="/quiz/:quizId" element={<QuizRoute saveAttempt={history.saveAttempt} />} />
      <Route path="/quiz/:quizId/results" element={<ResultsRoute />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
