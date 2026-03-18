import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { createPortal } from "react-dom";
import { Routes, Route, useNavigate, useParams, useSearchParams, useLocation, Navigate } from "react-router-dom";
import { useQuizHistory, getQuizBySupabaseId } from "./useQuizHistory.js";
import { supabase } from "./lib/supabase.js";
import { flush, usePendingCount, enqueue } from "./lib/syncQueue.js";

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
    body { background: #FAF7F2; font-family: 'Figtree', system-ui, sans-serif; color: #2C2420; -webkit-font-smoothing: antialiased; padding-bottom: env(safe-area-inset-bottom, 0); overflow-x: hidden; }
    h1, h2, h3, h4 { font-family: 'DM Serif Display', Georgia, serif; font-weight: 400; }
    input[type="text"], textarea { font-family: 'Figtree', system-ui, sans-serif; }
    ::placeholder { color: #B5ADA6; }
    .fade-in { animation: fadeIn 0.4s ease-out both; }
    .slide-in-right { animation: slideInRight 0.3s ease-out both; }
    .slide-in-left { animation: slideInLeft 0.3s ease-out both; }
    .slide-up { animation: slideUp 0.3s ease-out both; }
    .score-anim { animation: countUp 0.6s 0.5s ease-out both; }
    .skeleton { background: linear-gradient(90deg, #E8E2DC 25%, #F0EBE6 50%, #E8E2DC 75%); background-size: 400px 100%; animation: shimmer 1.5s infinite linear; border-radius: 8px; }
    @keyframes fadeIn { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: translateY(0); } }
    @keyframes slideInRight { from { opacity: 0; transform: translateX(40px); } to { opacity: 1; transform: translateX(0); } }
    @keyframes slideInLeft { from { opacity: 0; transform: translateX(-40px); } to { opacity: 1; transform: translateX(0); } }
    @keyframes slideUp { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
    @keyframes scoreReveal { from { stroke-dashoffset: 339.292; } }
    @keyframes countUp { from { opacity: 0; transform: scale(0.8); } to { opacity: 1; transform: scale(1); } }
    @keyframes shimmer { from { background-position: -400px 0; } to { background-position: 400px 0; } }
    @keyframes confettiDrop { 0% { transform: translateY(-10vh) rotate(0deg); opacity: 1; } 80% { opacity: 1; } 100% { transform: translateY(105vh) rotate(720deg); opacity: 0; } }
    @keyframes sheetUp { from { transform: translateY(100%); } to { transform: translateY(0); } }
    @keyframes overlayFade { from { opacity: 0; } to { opacity: 1; } }
    @keyframes progressGrow { from { width: 0%; } }
  `;
  document.head.appendChild(s);
};

const C = {
  bg: "#FAF7F2", card: "#FFFFFF", accent: "#B8622D", accentLight: "#F5EDE6",
  accentHover: "#9E5324", text: "#2C2420", muted: "#8C7E76", success: "#2A7D5F",
  successLight: "#EBF5EE", error: "#B84040", errorLight: "#FDEDEE",
  border: "#E8E2DC", inputBg: "#FDFCFA", overlay: "rgba(44, 36, 32, 0.45)",
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
      const pl = Object.entries(a.placements || {}).flatMap(([cat, items]) => items.map((it) => ({ it, cat })));
      return { correct: pl.length === total && pl.every(({ it, cat }) => map[norm(it)] === cat) };
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

const relativeTime = (ts) => {
  const diff = Date.now() - ts;
  if (diff < 60000) return "just now";
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(diff / 3600000);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(diff / 86400000);
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days}d ago`;
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric" }).format(new Date(ts));
};

const computeStreak = (results) => {
  if (!results.length) return 0;
  const days = [...new Set(results.map((r) => {
    const d = new Date(r.created_at);
    return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  }))].sort().reverse();
  const today = new Date();
  let expected = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  let streak = 0;
  for (const dayStr of days) {
    const [y, m, d] = dayStr.split("-").map(Number);
    const date = new Date(y, m, d);
    const diff = (expected - date) / 86400000;
    if (diff <= 1) { streak++; expected = date; } else break;
  }
  return streak;
};

// ═══════════════════════════════════════════════════════════════
// SMALL COMPONENTS
// ═══════════════════════════════════════════════════════════════
function ConfirmModal({ open, title, message, confirmLabel, cancelLabel, onConfirm, onCancel }) {
  if (!open) return null;
  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center",
      background: C.overlay, animation: "overlayFade 0.2s ease-out",
    }} onClick={onCancel}>
      <div className="slide-up" style={{
        background: C.card, borderRadius: 20, padding: 32, maxWidth: 340, width: "calc(100% - 48px)",
        boxShadow: "0 8px 32px rgba(44,36,32,0.15)", textAlign: "center",
      }} onClick={(e) => e.stopPropagation()}>
        <h3 style={{ fontSize: 20, color: C.text, marginBottom: 8, lineHeight: 1.3 }}>{title}</h3>
        <p style={{ color: C.muted, fontSize: 15, lineHeight: 1.6, marginBottom: 24 }}>{message}</p>
        <div style={{ display: "flex", gap: 12 }}>
          <button onClick={onCancel} style={{
            flex: 1, padding: "14px 16px", borderRadius: 12, border: `1.5px solid ${C.border}`,
            background: "transparent", color: C.text, fontWeight: 600, fontSize: 15,
            cursor: "pointer", fontFamily: "'Figtree', sans-serif", minHeight: 48,
          }}>{cancelLabel || "Cancel"}</button>
          <button onClick={onConfirm} style={{
            flex: 1, padding: "14px 16px", borderRadius: 12, border: "none",
            background: C.accent, color: "white", fontWeight: 600, fontSize: 15,
            cursor: "pointer", fontFamily: "'Figtree', sans-serif", minHeight: 48,
          }}>{confirmLabel || "Leave"}</button>
        </div>
      </div>
    </div>
  );
}

function SkeletonCard() {
  return (
    <div style={{
      background: C.card, borderRadius: 16, padding: 24,
      boxShadow: "0 1px 3px rgba(44,36,32,0.04), 0 4px 12px rgba(44,36,32,0.03)",
    }}>
      <div className="skeleton" style={{ width: "65%", height: 20, marginBottom: 12 }} />
      <div className="skeleton" style={{ width: "40%", height: 14 }} />
    </div>
  );
}

function Confetti() {
  const pieces = useMemo(() =>
    Array.from({ length: 40 }, (_, i) => ({
      left: Math.random() * 100,
      delay: Math.random() * 2,
      dur: 2 + Math.random() * 2,
      color: ["#B8622D", "#2A7D5F", "#F5A623", "#E8625C", "#4A90D9", "#9B59B6"][i % 6],
      size: 6 + Math.random() * 6,
      circle: Math.random() > 0.5,
    })), []);

  return (
    <div style={{ position: "fixed", inset: 0, pointerEvents: "none", zIndex: 100, overflow: "hidden" }}>
      {pieces.map((p, i) => (
        <div key={i} style={{
          position: "absolute", left: `${p.left}%`, top: -20,
          width: p.size, height: p.circle ? p.size : p.size * 1.5,
          background: p.color, borderRadius: p.circle ? "50%" : 2,
          animation: `confettiDrop ${p.dur}s ${p.delay}s ease-in forwards`, opacity: 0,
        }} />
      ))}
    </div>
  );
}

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

function AddQuizSheet({ open, onClose, onLoad }) {
  const ref = useRef();
  const [err, setErr] = useState("");
  const [dragging, setDragging] = useState(false);
  const dragCounter = useRef(0);

  const handle = (file) => {
    setErr("");
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const d = JSON.parse(e.target.result);
        if (!d.questions?.length) throw new Error("No questions");
        onLoad(d);
        onClose();
      } catch { setErr("Invalid file. Please upload a valid quiz JSON."); }
    };
    reader.readAsText(file);
  };

  if (!open) return null;

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 9999, display: "flex", alignItems: "flex-end",
      justifyContent: "center", background: C.overlay, animation: "overlayFade 0.2s ease-out",
    }} onClick={onClose}>
      <div style={{
        background: C.card, borderRadius: "20px 20px 0 0", padding: "12px 24px 32px",
        width: "100%", maxWidth: 480, animation: "sheetUp 0.3s ease-out",
      }} onClick={(e) => e.stopPropagation()}
        onDragEnter={(e) => { e.preventDefault(); dragCounter.current++; setDragging(true); }}
        onDragOver={(e) => e.preventDefault()}
        onDragLeave={(e) => { e.preventDefault(); dragCounter.current--; if (dragCounter.current <= 0) { dragCounter.current = 0; setDragging(false); } }}
        onDrop={(e) => { e.preventDefault(); dragCounter.current = 0; setDragging(false); e.dataTransfer.files[0] && handle(e.dataTransfer.files[0]); }}
      >
        <div style={{ width: 36, height: 4, borderRadius: 2, background: C.border, margin: "0 auto 20px" }} />
        <h3 style={{ fontSize: 20, color: C.text, marginBottom: 16, textAlign: "center" }}>Add Quiz</h3>
        <button onClick={() => ref.current?.click()} style={{
          width: "100%", padding: "16px 24px", borderRadius: 12, border: "none",
          background: C.accent, color: "white", fontWeight: 600, fontSize: 16,
          cursor: "pointer", fontFamily: "'Figtree', sans-serif", marginBottom: 16, minHeight: 52,
          transition: "background 0.2s",
        }}
        onMouseEnter={(e) => (e.target.style.background = C.accentHover)}
        onMouseLeave={(e) => (e.target.style.background = C.accent)}
        >Choose Quiz File</button>
        <input ref={ref} type="file" accept=".json" style={{ display: "none" }}
          onChange={(e) => { if (e.target.files[0]) handle(e.target.files[0]); }} />
        <div style={{
          border: `2px dashed ${dragging ? C.accent : C.border}`, borderRadius: 12,
          padding: "24px 16px", textAlign: "center",
          background: dragging ? C.accentLight : "transparent", transition: "all 0.2s",
        }}>
          <p style={{ color: C.muted, fontSize: 14 }}>or drag & drop a JSON file here</p>
        </div>
        {err && <p style={{ color: C.error, fontSize: 13, marginTop: 12, textAlign: "center" }}>{err}</p>}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// LOGIN SCREEN
// ═══════════════════════════════════════════════════════════════
function LoginScreen() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const inputStyle = {
    width: "100%", padding: "14px 18px", borderRadius: 12,
    border: `1.5px solid ${C.border}`, background: C.inputBg,
    fontSize: 16, color: C.text, outline: "none", marginBottom: 14,
    fontFamily: "'Figtree', sans-serif", transition: "border-color 0.2s",
    boxSizing: "border-box", minHeight: 48,
  };

  const btnStyle = (enabled) => ({
    width: "100%", padding: "14px 24px", borderRadius: 12, border: "none",
    background: enabled ? C.accent : C.border,
    color: "white", fontWeight: 600, fontSize: 16,
    cursor: enabled ? "pointer" : "not-allowed",
    fontFamily: "'Figtree', sans-serif", transition: "background 0.2s", minHeight: 52,
  });

  const handleMagicLink = async (e) => {
    e.preventDefault();
    if (!email.trim()) return;
    setLoading(true); setError("");
    try {
      const { error: err } = await supabase.auth.signInWithOtp({
        email: email.trim(), options: { emailRedirectTo: window.location.origin },
      });
      if (err) throw err;
      setSent(true);
    } catch (err) { setError(err.message || "Failed to send magic link"); }
    finally { setLoading(false); }
  };

  const handlePasswordSignIn = async (e) => {
    e.preventDefault();
    if (!email.trim() || !password) return;
    setLoading(true); setError("");
    try {
      const { error: err } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (err) throw err;
    } catch (err) { setError(err.message || "Invalid email or password"); }
    finally { setLoading(false); }
  };

  return (
    <div className="fade-in" style={{
      minHeight: "100vh", display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center", padding: "48px 24px",
    }}>
      <div style={{ maxWidth: 400, width: "100%", textAlign: "center" }}>
        <img src="/icons/logo.png" alt="Piñata" style={{ width: 120, height: 120, marginBottom: 8 }} />
        <h1 style={{ fontSize: 32, color: C.text, marginBottom: 8, letterSpacing: "-0.5px" }}>Piñata</h1>
        <p style={{ color: C.muted, fontSize: 15, marginBottom: 36, lineHeight: 1.6 }}>
          Sign in to track your Spanish quiz scores
        </p>
        {sent ? (
          <div style={{
            background: C.successLight, border: `1px solid ${C.success}`, borderRadius: 14,
            padding: "24px 20px", textAlign: "center",
          }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>✉️</div>
            <p style={{ fontWeight: 600, color: C.success, marginBottom: 4 }}>Check your email!</p>
            <p style={{ color: C.muted, fontSize: 14 }}>
              We sent a magic link to <strong style={{ color: C.text }}>{email}</strong>
            </p>
            <button onClick={() => setSent(false)} style={{
              marginTop: 16, background: "none", border: "none", color: C.accent,
              fontSize: 14, fontWeight: 600, cursor: "pointer", fontFamily: "'Figtree', sans-serif",
            }}>Use a different email</button>
          </div>
        ) : (
          <form onSubmit={handlePasswordSignIn}>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
              placeholder="your@email.com" autoComplete="email" autoFocus style={inputStyle}
              onFocus={(e) => (e.target.style.borderColor = C.accent)}
              onBlur={(e) => (e.target.style.borderColor = C.border)} />
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
              placeholder="Password" autoComplete="current-password" style={inputStyle}
              onFocus={(e) => (e.target.style.borderColor = C.accent)}
              onBlur={(e) => (e.target.style.borderColor = C.border)} />
            <button type="submit" disabled={loading || !email.trim() || !password}
              style={btnStyle(!loading && email.trim() && password)}>
              {loading ? "Signing in..." : "Sign In"}
            </button>
            <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "18px 0", color: C.muted, fontSize: 13 }}>
              <div style={{ flex: 1, height: 1, background: C.border }} />
              <span>or</span>
              <div style={{ flex: 1, height: 1, background: C.border }} />
            </div>
            <button type="button" onClick={handleMagicLink} disabled={loading || !email.trim()} style={{
              ...btnStyle(!loading && email.trim()), background: "none",
              border: `1.5px solid ${(!loading && email.trim()) ? C.accent : C.border}`,
              color: (!loading && email.trim()) ? C.accent : C.muted,
            }}>
              {loading ? "Sending..." : "Send Magic Link"}
            </button>
            {error && <p style={{ color: C.error, fontSize: 13, marginTop: 12 }}>{error}</p>}
          </form>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// HOME SCREEN
// ═══════════════════════════════════════════════════════════════
function HomeScreen({ onLoad, quizzes, loading, onDeleteQuiz, onSelectQuiz, session }) {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState("quizzes");
  const [showAddQuiz, setShowAddQuiz] = useState(false);
  const [stats, setStats] = useState(null);
  const [cloudHistory, setCloudHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [quizProgress, setQuizProgress] = useState({});
  const [lastScores, setLastScores] = useState({});
  const [pullDistance, setPullDistance] = useState(0);
  const isPulling = useRef(false);
  const pullStartY = useRef(0);

  useEffect(() => {
    if (!session?.user?.id) return;
    supabase.from("quiz_results").select("*").eq("user_id", session.user.id)
      .order("created_at", { ascending: false }).limit(100)
      .then(({ data }) => {
        if (data) {
          setCloudHistory(data);
          if (data.length > 0) {
            const avg = Math.round(data.reduce((s, r) => s + r.percentage, 0) / data.length);
            const best = Math.max(...data.map((r) => r.percentage));
            setStats({ count: data.length, avg, best });
          }
          const scoreMap = {};
          data.forEach((r) => { if (r.lesson_title && !scoreMap[r.lesson_title]) scoreMap[r.lesson_title] = r.percentage; });
          setLastScores(scoreMap);
        }
        setHistoryLoading(false);
      });
    supabase.from("quiz_progress").select("quiz_title,current_index,answers")
      .eq("user_id", session.user.id).eq("status", "in_progress")
      .then(({ data }) => {
        if (data) {
          const map = {};
          data.forEach((p) => { map[p.quiz_title] = (p.current_index ?? 0) + 1; });
          setQuizProgress(map);
        }
      });
  }, [session]);

  const displayName = session?.user?.user_metadata?.display_name
    || session?.user?.user_metadata?.full_name
    || session?.user?.email?.split("@")[0] || "there";

  const handleLogout = async () => { await supabase.auth.signOut(); };

  // Pull-to-refresh
  const onPullStart = (e) => {
    if (window.scrollY === 0) { pullStartY.current = e.touches[0].clientY; isPulling.current = true; }
  };
  const onPullMove = (e) => {
    if (!isPulling.current) return;
    const diff = e.touches[0].clientY - pullStartY.current;
    if (diff > 0) setPullDistance(Math.min(diff * 0.4, 80));
    else { setPullDistance(0); isPulling.current = false; }
  };
  const onPullEnd = () => {
    if (pullDistance > 50) window.location.reload();
    setPullDistance(0); isPulling.current = false;
  };

  return (
    <div className="fade-in" onTouchStart={onPullStart} onTouchMove={onPullMove} onTouchEnd={onPullEnd}
      style={{ minHeight: "100vh", background: C.bg }}>
      {pullDistance > 0 && (
        <div style={{ textAlign: "center", padding: `${pullDistance * 0.3}px 0`, color: C.muted, fontSize: 13, transition: "padding 0.1s" }}>
          <span style={{ display: "inline-block", transform: `rotate(${pullDistance > 50 ? 180 : 0}deg)`, transition: "transform 0.2s" }}>↓</span>
          {pullDistance > 50 ? " Release to refresh" : " Pull to refresh"}
        </div>
      )}

      {/* Sticky header */}
      <div style={{ position: "sticky", top: 0, zIndex: 20, background: C.bg, padding: "16px 20px 0" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <h1 style={{ fontSize: 22, color: C.text, lineHeight: 1.3 }}>Hola, {displayName} 👋</h1>
          <button onClick={handleLogout} style={{
            background: "none", border: "none", cursor: "pointer", padding: 8,
            minWidth: 44, minHeight: 44, display: "flex", alignItems: "center", justifyContent: "center",
            borderRadius: 12, transition: "background 0.2s",
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = C.accentLight)}
          onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={C.muted} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" />
            </svg>
          </button>
        </div>
        {stats ? (
          <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
            {[`${stats.count} quizzes taken`, `Avg: ${stats.avg}%`, `Best: ${stats.best}%`].map((t) => (
              <span key={t} style={{
                padding: "5px 12px", borderRadius: 999, fontSize: 12, fontWeight: 600,
                background: C.accentLight, color: C.accent,
              }}>{t}</span>
            ))}
          </div>
        ) : !historyLoading && cloudHistory.length === 0 ? (
          <p style={{ color: C.muted, fontSize: 13, marginBottom: 12 }}>Complete your first quiz!</p>
        ) : null}
        <div style={{ display: "flex", borderBottom: `1px solid ${C.border}` }}>
          {["Quizzes", "History"].map((tab) => (
            <button key={tab} onClick={() => setActiveTab(tab.toLowerCase())} style={{
              flex: 1, padding: "12px 0", background: "none", border: "none",
              borderBottom: `2px solid ${activeTab === tab.toLowerCase() ? C.accent : "transparent"}`,
              color: activeTab === tab.toLowerCase() ? C.accent : C.muted,
              fontWeight: 600, fontSize: 15, cursor: "pointer",
              fontFamily: "'Figtree', sans-serif", transition: "all 0.2s", marginBottom: -1,
            }}>{tab}</button>
          ))}
        </div>
      </div>

      {/* Tab content */}
      <div style={{ padding: "16px 20px 32px", maxWidth: 520, margin: "0 auto", width: "100%" }}>
        {activeTab === "quizzes" ? (
          <div key="quizzes" className="fade-in">
            {loading ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                {[1, 2, 3].map((i) => <SkeletonCard key={i} />)}
              </div>
            ) : quizzes.length === 0 ? (
              <div style={{ textAlign: "center", padding: "48px 20px" }}>
                <div style={{ fontSize: 48, marginBottom: 12, opacity: 0.8 }}>📚</div>
                <p style={{ color: C.text, fontSize: 18, fontWeight: 600, marginBottom: 4, fontFamily: "'DM Serif Display', serif" }}>No quizzes yet</p>
                <p style={{ color: C.muted, fontSize: 14, lineHeight: 1.6 }}>Upload your first quiz to get started!</p>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                {quizzes.map((q) => {
                  const title = q.data.meta?.title || "Quiz";
                  const unit = q.data.meta?.unit;
                  const lesson = q.data.meta?.lesson;
                  const qCount = q.data.questions?.length || 0;
                  const lastScore = lastScores[title];
                  const progress = quizProgress[title];
                  const scoreColor = lastScore >= 70 ? C.success : lastScore >= 50 ? C.accent : C.error;

                  return (
                    <div key={q.id} className="fade-in" onClick={() => onSelectQuiz(q)}
                      style={{
                        background: C.card, borderRadius: 16, padding: 24, cursor: "pointer",
                        boxShadow: "0 1px 3px rgba(44,36,32,0.04), 0 4px 12px rgba(44,36,32,0.03)",
                        transition: "transform 0.15s, box-shadow 0.15s", position: "relative",
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.transform = "translateY(-1px)"; e.currentTarget.style.boxShadow = "0 2px 6px rgba(44,36,32,0.06), 0 8px 20px rgba(44,36,32,0.06)"; }}
                      onMouseLeave={(e) => { e.currentTarget.style.transform = "none"; e.currentTarget.style.boxShadow = "0 1px 3px rgba(44,36,32,0.04), 0 4px 12px rgba(44,36,32,0.03)"; }}>
                      <h3 style={{
                        fontSize: 18, color: C.text, marginBottom: 6, lineHeight: 1.3,
                        paddingRight: (progress || lastScore !== undefined) ? 80 : 0,
                        fontFamily: "'DM Serif Display', serif",
                      }}>{title}</h3>
                      <p style={{ fontSize: 13, color: C.muted, fontWeight: 500, lineHeight: 1.5 }}>
                        {unit != null && lesson != null ? `Unit ${unit} · Lesson ${lesson} · ` : ""}{qCount} questions
                      </p>
                      {(progress || lastScore !== undefined) && (
                        <div style={{
                          position: "absolute", top: 16, right: 20,
                          display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6,
                        }}>
                          {progress && (
                            <span style={{
                              background: C.accentLight, color: C.accent,
                              padding: "5px 12px", borderRadius: 999, fontSize: 12, fontWeight: 600,
                            }}>Resume (Q{progress}/{qCount})</span>
                          )}
                          {lastScore !== undefined && (
                            <span style={{
                              width: 38, height: 38, borderRadius: "50%", background: scoreColor, color: "white",
                              display: "flex", alignItems: "center", justifyContent: "center",
                              fontSize: 11, fontWeight: 700,
                            }}>{lastScore}%</span>
                          )}
                        </div>
                      )}
                      <button onClick={(e) => { e.stopPropagation(); onDeleteQuiz(q.id); }}
                        style={{
                          position: "absolute", bottom: 8, right: 8, background: "none", border: "none",
                          color: C.muted, cursor: "pointer", fontSize: 16, padding: 8, opacity: 0.4,
                          minWidth: 44, minHeight: 44, display: "flex", alignItems: "center", justifyContent: "center",
                          transition: "opacity 0.2s",
                        }}
                        onMouseEnter={(e) => (e.currentTarget.style.opacity = "1")}
                        onMouseLeave={(e) => (e.currentTarget.style.opacity = "0.4")}>×</button>
                    </div>
                  );
                })}
              </div>
            )}
            <button onClick={() => setShowAddQuiz(true)} style={{
              width: "100%", padding: "14px", borderRadius: 12, marginTop: 16,
              border: `1.5px dashed ${C.border}`, background: "transparent",
              color: C.muted, fontWeight: 600, fontSize: 15, cursor: "pointer",
              fontFamily: "'Figtree', sans-serif", transition: "all 0.2s", minHeight: 48,
            }}
            onMouseEnter={(e) => { e.currentTarget.style.borderColor = C.accent; e.currentTarget.style.color = C.accent; }}
            onMouseLeave={(e) => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.color = C.muted; }}>
              + Add Quiz
            </button>
          </div>
        ) : (
          <div key="history" className="fade-in">
            {historyLoading ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {[1, 2, 3].map((i) => <SkeletonCard key={i} />)}
              </div>
            ) : cloudHistory.length === 0 ? (
              <div style={{ textAlign: "center", padding: "48px 20px" }}>
                <div style={{ fontSize: 48, marginBottom: 12, opacity: 0.8 }}>📊</div>
                <p style={{ color: C.text, fontSize: 16, fontWeight: 600, fontFamily: "'DM Serif Display', serif" }}>No quiz results yet</p>
                <p style={{ color: C.muted, fontSize: 14, marginTop: 4 }}>Complete a quiz to see your history!</p>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {cloudHistory.map((r) => (
                  <div key={r.id} className="fade-in" onClick={() => navigate("/history/view", { state: { cloudRecord: r } })} style={{
                    background: C.card, borderRadius: 14, padding: "16px 20px",
                    display: "flex", alignItems: "center", gap: 14,
                    boxShadow: "0 1px 2px rgba(44,36,32,0.03)",
                    cursor: "pointer", transition: "transform 0.15s, box-shadow 0.15s",
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.transform = "translateY(-1px)"; e.currentTarget.style.boxShadow = "0 2px 6px rgba(44,36,32,0.06)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.transform = "none"; e.currentTarget.style.boxShadow = "0 1px 2px rgba(44,36,32,0.03)"; }}>
                    <MiniScoreCircle pct={r.percentage} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: 15, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {r.lesson_title || "Quiz"}
                      </div>
                      <div style={{ fontSize: 13, color: C.muted }}>
                        {r.score}/{r.total}
                        {r.overrides > 0 ? ` (+${r.overrides} override${r.overrides !== 1 ? "s" : ""})` : ""}
                      </div>
                    </div>
                    <div style={{ fontSize: 12, color: C.muted, whiteSpace: "nowrap" }}>
                      {relativeTime(new Date(r.created_at).getTime())}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <AddQuizSheet open={showAddQuiz} onClose={() => setShowAddQuiz(false)} onLoad={onLoad} />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// QUESTION COMPONENTS
// ═══════════════════════════════════════════════════════════════
function FillBlank({ q, value, onChange }) {
  const blanks = value?.blanks || [];
  const parts = q.prompt.split(/(___+)/);
  const inputRefs = useRef([]);
  let idx = 0;

  const update = (i, v) => {
    const nb = [...blanks]; nb[i] = v; onChange({ blanks: nb });
  };

  const handleKeyDown = (i, e) => {
    if (e.key === "Enter" && inputRefs.current[i + 1]) {
      e.preventDefault(); inputRefs.current[i + 1].focus();
    }
  };

  return (
    <div>
      <div style={{ fontSize: 20, lineHeight: 2.4, marginBottom: 8 }}>
        {parts.map((p, pi) => {
          if (/^___+$/.test(p)) {
            const ci = idx++;
            return (
              <input key={pi} ref={(el) => (inputRefs.current[ci] = el)}
                type="text" value={blanks[ci] || ""} onChange={(e) => update(ci, e.target.value)}
                onKeyDown={(e) => handleKeyDown(ci, e)}
                placeholder="..." autoComplete="off"
                style={{
                  display: "inline-block", border: `2px solid ${C.accent}40`, borderRadius: 8,
                  background: `${C.accent}10`, padding: "6px 12px", margin: "0 4px",
                  textAlign: "center", color: C.accent, fontWeight: 600, outline: "none",
                  minWidth: 100, minHeight: 44, fontSize: "inherit", lineHeight: "inherit",
                  fontFamily: "'Figtree', sans-serif", transition: "all 0.2s",
                }}
                onFocus={(e) => { e.target.style.borderColor = C.accent; e.target.style.boxShadow = `0 0 0 3px ${C.accent}20`; }}
                onBlur={(e) => { e.target.style.borderColor = `${C.accent}40`; e.target.style.boxShadow = "none"; }}
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
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {q.options.map((opt, i) => {
        const sel = value?.selected === i;
        return (
          <div key={i} onClick={() => onChange({ selected: i })}
            style={{
              padding: "16px 20px", borderRadius: 14, cursor: "pointer", transition: "all 0.2s",
              border: `1.5px solid ${sel ? C.accent : C.border}`,
              background: sel ? C.accentLight : C.card, color: sel ? C.accent : C.text,
              fontWeight: sel ? 600 : 400, fontSize: 15, minHeight: 52,
              display: "flex", alignItems: "center", transform: sel ? "scale(1.01)" : "none",
            }}>
            <span style={{
              display: "inline-flex", alignItems: "center", justifyContent: "center",
              width: 28, height: 28, borderRadius: "50%", marginRight: 14, flexShrink: 0,
              fontSize: 12, fontWeight: 700, transition: "all 0.2s",
              border: `1.5px solid ${sel ? C.accent : C.border}`,
              background: sel ? C.accent : "transparent", color: sel ? "white" : C.muted,
            }}>{String.fromCharCode(65 + i)}</span>
            {opt}
          </div>
        );
      })}
    </div>
  );
}

function Translate({ q, value, onChange }) {
  const ref = useRef(null);
  useEffect(() => {
    if (ref.current) { ref.current.style.height = "auto"; ref.current.style.height = ref.current.scrollHeight + "px"; }
  }, [value?.text]);

  return (
    <div>
      {q.direction && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16, color: C.text, fontSize: 15, fontWeight: 600 }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={C.accent} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" />
          </svg>
          {q.direction}
        </div>
      )}
      <textarea ref={ref} value={value?.text || ""} onChange={(e) => onChange({ text: e.target.value })}
        placeholder="Type your translation here..." rows={2}
        style={{
          width: "100%", padding: 16, borderRadius: 12, border: `1.5px solid ${C.border}`,
          background: C.inputBg, fontSize: 16, resize: "none", outline: "none", overflow: "hidden",
          lineHeight: 1.6, color: C.text, transition: "border-color 0.2s", minHeight: 56,
        }}
        onFocus={(e) => (e.target.style.borderColor = C.accent)}
        onBlur={(e) => (e.target.style.borderColor = C.border)} />
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

  const [dragging, setDragging] = useState(null);
  const [dragPos, setDragPos] = useState(null);
  const [hoveredCat, setHoveredCat] = useState(null);
  const dragOffset = useRef({ x: 0, y: 0 });
  const catRefs = useRef({});
  const hoveredCatRef = useRef(null);
  const dragItemRef = useRef(null);
  const placementsRef = useRef(placements);
  const onChangeRef = useRef(onChange);
  useEffect(() => { placementsRef.current = placements; }, [placements]);
  useEffect(() => { onChangeRef.current = onChange; }, [onChange]);

  const handleTouchStart = (item, e) => {
    const touch = e.touches[0];
    const rect = e.currentTarget.getBoundingClientRect();
    dragOffset.current = { x: touch.clientX - rect.left, y: touch.clientY - rect.top };
    dragItemRef.current = item;
    setDragging(item);
    setDragPos({ x: touch.clientX, y: touch.clientY });
  };

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e) => {
      e.preventDefault();
      const t = e.touches[0];
      setDragPos({ x: t.clientX, y: t.clientY });
      let found = null;
      for (const [cat, el] of Object.entries(catRefs.current)) {
        if (!el) continue;
        const r = el.getBoundingClientRect();
        if (t.clientX >= r.left && t.clientX <= r.right && t.clientY >= r.top && t.clientY <= r.bottom) { found = cat; break; }
      }
      hoveredCatRef.current = found;
      setHoveredCat(found);
    };
    const onEnd = () => {
      const cat = hoveredCatRef.current;
      const item = dragItemRef.current;
      if (cat && item) {
        const np = { ...placementsRef.current };
        Object.keys(np).forEach((k) => (np[k] = (np[k] || []).filter((x) => x !== item)));
        np[cat] = [...(np[cat] || []), item];
        onChangeRef.current({ placements: np, _selected: null });
      }
      setDragging(null); setDragPos(null); setHoveredCat(null);
      hoveredCatRef.current = null; dragItemRef.current = null;
    };
    document.addEventListener("touchmove", onMove, { passive: false });
    document.addEventListener("touchend", onEnd);
    return () => { document.removeEventListener("touchmove", onMove); document.removeEventListener("touchend", onEnd); };
  }, [dragging]);

  const selectItem = (item) => {
    if (dragging) return;
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

  const chip = (isSel, isPlaced) => ({
    display: "inline-flex", alignItems: "center", padding: isPlaced ? "8px 14px" : "10px 18px",
    borderRadius: 999, fontSize: isPlaced ? 13 : 14, fontWeight: 500, cursor: "pointer",
    transition: "all 0.2s", userSelect: "none", minHeight: 44,
    border: `1.5px solid ${isSel || isPlaced ? C.accent : C.border}`,
    background: isSel || isPlaced ? C.accentLight : C.card,
    color: isSel || isPlaced ? C.accent : C.text,
  });

  return (
    <div>
      {unplaced.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 20 }}>
          {unplaced.map((item) => (
            <span key={item} onClick={() => selectItem(item)} onTouchStart={(e) => handleTouchStart(item, e)}
              style={{ ...chip(selected === item, false), opacity: dragging === item ? 0.3 : 1 }}>
              {item}
            </span>
          ))}
        </div>
      )}
      {selected && !dragging && (
        <p style={{ color: C.accent, fontSize: 13, marginBottom: 12, fontWeight: 500 }}>
          Tap a category below to place "{selected}"
        </p>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {Object.keys(q.categories).map((cat) => (
          <div key={cat} ref={(el) => (catRefs.current[cat] = el)}>
            <div onClick={() => placeInCategory(cat)}
              style={{
                border: `1.5px ${placements[cat]?.length ? "solid" : "dashed"} ${hoveredCat === cat ? C.accent : selected ? C.accent + "88" : C.border}`,
                borderRadius: 12, padding: 14, minHeight: 56,
                cursor: selected ? "pointer" : "default", transition: "all 0.2s",
                background: hoveredCat === cat ? C.accentLight : selected ? `${C.accentLight}44` : "transparent",
                transform: hoveredCat === cat ? "scale(1.01)" : "none",
              }}>
              <p style={{
                fontSize: 13, fontWeight: 700, color: C.muted, textTransform: "uppercase",
                letterSpacing: 0.5, marginBottom: placements[cat]?.length ? 10 : 0,
              }}>{cat}</p>
              {placements[cat]?.length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {placements[cat].map((item) => (
                    <span key={item} onClick={(e) => { e.stopPropagation(); removeFromCategory(item, cat); }}
                      style={chip(false, true)}>{item} ×</span>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
      {dragging && dragPos && createPortal(
        <div style={{
          position: "fixed", left: dragPos.x - dragOffset.current.x, top: dragPos.y - dragOffset.current.y,
          zIndex: 9999, pointerEvents: "none", display: "inline-flex", alignItems: "center",
          padding: "10px 18px", borderRadius: 999, fontSize: 14, fontWeight: 500,
          background: C.accentLight, border: `1.5px solid ${C.accent}`, color: C.accent,
          boxShadow: "0 8px 24px rgba(44,36,32,0.15)", transform: "scale(1.05)", whiteSpace: "nowrap",
        }}>{dragging}</div>,
        document.body
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// QUIZ SCREEN
// ═══════════════════════════════════════════════════════════════
function QuizRoute({ saveAttempt, session }) {
  const { quizId } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [answers, setAnswers] = useState({});
  const [loadError, setLoadError] = useState(false);
  const [key, setKey] = useState(0);
  const [slideDir, setSlideDir] = useState("right");
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);
  const [showFinishConfirm, setShowFinishConfirm] = useState(false);
  const pendingFinishAnswers = useRef(null);

  const qParam = parseInt(searchParams.get("q") || "1", 10);
  const idx = Math.max(0, qParam - 1);

  useEffect(() => {
    if (!quizId) { setLoadError(true); return; }
    let cancelled = false;
    getQuizBySupabaseId(quizId).then((quiz) => {
      if (cancelled) return;
      if (!quiz) { setLoadError(true); return; }
      setData(quiz.data);
    });
    return () => { cancelled = true; };
  }, [quizId]);

  useEffect(() => {
    if (!data || !session?.user?.id) return;
    let cancelled = false;
    const title = data.meta?.title;
    if (!title) return;
    supabase.from("quiz_progress").select("*").eq("user_id", session.user.id)
      .eq("quiz_title", title).eq("status", "in_progress").maybeSingle()
      .then(({ data: progress }) => {
        if (cancelled || !progress) return;
        setAnswers(progress.answers || {});
        const resumeQ = (progress.current_index ?? 0) + 1;
        setSearchParams({ q: String(resumeQ) }, { replace: true });
      });
    return () => { cancelled = true; };
  }, [data, session?.user?.id]);

  const progressSaveTimer = useRef(null);
  useEffect(() => {
    if (!data || !session?.user?.id) return;
    const title = data.meta?.title;
    if (!title) return;
    clearTimeout(progressSaveTimer.current);
    progressSaveTimer.current = setTimeout(() => {
      const payload = {
        user_id: session.user.id, quiz_title: title, current_index: idx,
        answers, overrides: {}, status: "in_progress",
      };
      supabase.from("quiz_progress").upsert(payload, { onConflict: "user_id,quiz_title" })
        .then(({ error }) => {
          if (error) enqueue({ table: "quiz_progress", method: "upsert", payload, matchColumns: ["user_id", "quiz_title"] });
        });
    }, 300);
    return () => clearTimeout(progressSaveTimer.current);
  }, [answers, idx, data, session?.user?.id]);

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
  const hasAnyAnswers = Object.keys(answers).some((k) => answers[k] && !answers[k].skipped);

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

  const goToQuestion = (n, dir) => {
    setSlideDir(dir || "right");
    setSearchParams({ q: String(n) }, { replace: true });
    setKey((k) => k + 1);
  };

  const handleFinish = async (finalAnswers) => {
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
    const percentage = Math.round((correct / total) * 100);
    const attempt = {
      timestamp: Date.now(), quizKey, quizId,
      meta: { title: data.meta?.title, description: data.meta?.description, unit: data.meta?.unit, lesson: data.meta?.lesson },
      score: { correct, total, percentage }, breakdown, answers: finalAnswers, results: res, questions: data.questions,
    };

    saveAttempt(attempt);

    if (session?.user?.id && data.meta?.title) {
      supabase.from("quiz_progress").upsert({
        user_id: session.user.id, quiz_title: data.meta.title,
        current_index: total - 1, answers: finalAnswers, overrides: {}, status: "completed",
      }, { onConflict: "user_id,quiz_title" }).then(({ error }) => {
        if (error) console.warn("Failed to update progress status:", error);
      });
    }

    let supabaseRecordId = null;
    try {
      const questionBreakdown = data.questions.map((qu, i) => ({
        type: qu.type, prompt: qu.prompt, correct: res[i].correct,
        ...(qu.blanks && { blanks: qu.blanks }),
        ...(qu.options && { options: qu.options }),
        ...(qu.answer != null && { answer: qu.answer }),
        ...(qu.accept && { accept: qu.accept }),
        ...(qu.categories && { categories: qu.categories }),
        ...(qu.explanation && { explanation: qu.explanation }),
        ...(res[i].blanksCorrect && { blanksCorrect: res[i].blanksCorrect }),
      }));
      const { data: inserted, error } = await supabase.from("quiz_results").insert({
        user_id: session?.user?.id, lesson_title: data.meta?.title || null,
        lesson_number: data.meta?.lesson ?? null, unit_number: data.meta?.unit ?? null,
        score: correct, total, percentage, overrides: 0, question_breakdown: questionBreakdown,
      }).select("id").single();
      if (!error && inserted) supabaseRecordId = inserted.id;
    } catch (err) { console.warn("Supabase save failed:", err); }

    navigate(`/quiz/${quizId}/results`, { state: { attempt, supabaseRecordId } });
  };

  const countUnanswered = (finalAnswers) => {
    let count = 0;
    for (let i = 0; i < total; i++) {
      const a = finalAnswers[i];
      if (!a || a.skipped) count++;
    }
    return count;
  };

  const tryFinish = (finalAnswers) => {
    const unanswered = countUnanswered(finalAnswers);
    if (unanswered > 0) {
      pendingFinishAnswers.current = finalAnswers;
      setShowFinishConfirm(true);
    } else {
      handleFinish(finalAnswers);
    }
  };

  const next = () => {
    if (idx < total - 1) goToQuestion(idx + 2, "right");
    else tryFinish(answers);
  };
  const prev = () => {
    if (idx > 0) goToQuestion(idx, "left");
    else if (hasAnyAnswers) setShowLeaveConfirm(true);
    else navigate("/");
  };
  const skip = () => {
    const updated = { ...answers, [idx]: { skipped: true } };
    setAnswers(updated);
    if (idx < total - 1) goToQuestion(idx + 2, "right");
    else tryFinish(updated);
  };
  const handleHomeClick = () => {
    if (hasAnyAnswers) setShowLeaveConfirm(true);
    else navigate("/");
  };

  const QComponent = { fill_blank: FillBlank, multiple_choice: MultiChoice, translate: Translate, classify: Classify }[q.type];

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", background: C.bg }}>
      <ConfirmModal open={showLeaveConfirm}
        title="Leave quiz?" message="Your progress is saved. You can resume later."
        confirmLabel="Leave" cancelLabel="Stay"
        onConfirm={() => navigate("/")} onCancel={() => setShowLeaveConfirm(false)} />
      <ConfirmModal open={showFinishConfirm}
        title="Finish quiz?"
        message={`You have ${countUnanswered(pendingFinishAnswers.current || answers)} unanswered question${countUnanswered(pendingFinishAnswers.current || answers) !== 1 ? "s" : ""}. Are you sure you want to finish?`}
        confirmLabel="Finish" cancelLabel="Go back"
        onConfirm={() => { setShowFinishConfirm(false); handleFinish(pendingFinishAnswers.current || answers); }}
        onCancel={() => { setShowFinishConfirm(false); pendingFinishAnswers.current = null; }} />

      {/* Header */}
      <div style={{
        position: "sticky", top: 0, zIndex: 10, background: C.bg,
        padding: "16px 20px 12px",
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <button onClick={handleHomeClick} style={{
            background: "none", border: "none", color: C.muted, fontSize: 13, fontWeight: 500,
            cursor: "pointer", padding: "8px 4px", fontFamily: "'Figtree', sans-serif",
            display: "flex", alignItems: "center", gap: 4, minHeight: 44,
          }}
          onMouseEnter={(e) => (e.currentTarget.style.color = C.accent)}
          onMouseLeave={(e) => (e.currentTarget.style.color = C.muted)}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><polyline points="9 22 9 12 15 12 15 22" />
            </svg>
            Home
          </button>
          <span style={{
            fontSize: 12, color: C.accent, fontWeight: 600, padding: "4px 12px",
            borderRadius: 999, background: C.accentLight, letterSpacing: 0.3,
          }}>{typeLabels[q.type] || q.type}</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 4 }}>
          <span style={{ fontSize: 14, fontWeight: 600, color: C.text, whiteSpace: "nowrap" }}>
            {idx + 1} of {total}
          </span>
          <div style={{ flex: 1, height: 6, background: C.border, borderRadius: 3, overflow: "hidden" }}>
            <div style={{
              height: "100%", background: C.accent, borderRadius: 3,
              transition: "width 0.4s cubic-bezier(0.4, 0, 0.2, 1)",
              width: `${((idx + 1) / total) * 100}%`,
            }} />
          </div>
        </div>
      </div>

      {/* Question area */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", padding: "0 20px" }}>
        <div style={{ maxWidth: 580, width: "100%" }}>
          <div key={key} className={slideDir === "right" ? "slide-in-right" : "slide-in-left"} style={{
            background: C.card, border: `1px solid ${C.border}`, borderRadius: 20,
            padding: "32px 24px", boxShadow: "0 1px 3px rgba(44,36,32,0.04), 0 6px 16px rgba(44,36,32,0.03)",
          }}>
            <h2 style={{ fontSize: 20, lineHeight: 1.4, marginBottom: 24, color: C.text }}>
              {q.prompt.includes("___") && q.type === "fill_blank" ? "" : q.prompt}
            </h2>
            {QComponent && <QComponent q={q} value={ans} onChange={setAnswer} />}
          </div>

          {data.meta?.title && (
            <p style={{ textAlign: "center", color: C.muted, fontSize: 12, marginTop: 24, opacity: 0.6 }}>
              {data.meta.title}
            </p>
          )}
        </div>
      </div>

      {/* Sticky footer */}
      <div style={{
        position: "sticky", bottom: 0, background: C.bg, padding: "12px 20px 16px",
        borderTop: `1px solid ${C.border}`,
        paddingBottom: "max(16px, env(safe-area-inset-bottom, 16px))",
      }}>
        <div style={{ maxWidth: 580, margin: "0 auto", display: "flex", alignItems: "center", gap: 12 }}>
          {/* Back */}
          <button onClick={prev} style={{
            background: "none", border: `1.5px solid ${C.border}`, borderRadius: 12,
            width: 48, height: 48, cursor: "pointer", display: "flex",
            alignItems: "center", justifyContent: "center", flexShrink: 0, transition: "border-color 0.2s",
          }}
          onMouseEnter={(e) => (e.currentTarget.style.borderColor = C.accent)}
          onMouseLeave={(e) => (e.currentTarget.style.borderColor = C.border)}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={C.muted} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>

          {/* Skip */}
          <button onClick={skip} style={{
            background: "none", border: "none", color: C.muted, fontSize: 14,
            fontWeight: 500, cursor: "pointer", padding: "12px 8px",
            fontFamily: "'Figtree', sans-serif", minHeight: 48, whiteSpace: "nowrap",
          }}>Skip</button>

          {/* Next / Finish */}
          <button onClick={next} disabled={!canProceed()}
            style={{
              flex: 1, background: canProceed() ? C.accent : C.border, color: "white",
              border: "none", padding: "14px 24px", borderRadius: 12, fontWeight: 600,
              fontSize: 16, cursor: canProceed() ? "pointer" : "not-allowed",
              transition: "all 0.2s", fontFamily: "'Figtree', sans-serif",
              opacity: canProceed() ? 1 : 0.5, minHeight: 52,
            }}
            onMouseEnter={(e) => canProceed() && (e.target.style.background = C.accentHover)}
            onMouseLeave={(e) => canProceed() && (e.target.style.background = C.accent)}>
            {idx === total - 1 ? "Finish" : "Next"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// RESULTS SCREEN
// ═══════════════════════════════════════════════════════════════
function ResultsRoute({ session }) {
  const { quizId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const [overrides, setOverrides] = useState({});
  const [reviewFilter, setReviewFilter] = useState("all");
  const supabaseRecordId = useRef(location.state?.supabaseRecordId || null);
  const reviewRef = useRef(null);

  const attempt = location.state?.attempt;
  const cloudRecord = location.state?.cloudRecord;
  if (!attempt && !cloudRecord) return <Navigate to="/" replace />;

  const isCloudView = !attempt && !!cloudRecord;

  let questions, answers, results, score, breakdown;
  if (attempt) {
    ({ questions, answers, results, score, breakdown } = attempt);
  } else {
    const qb = cloudRecord.question_breakdown || [];
    questions = qb.map((q) => ({
      type: q.type, prompt: q.prompt,
      ...(q.blanks && { blanks: q.blanks }),
      ...(q.options && { options: q.options }),
      ...(q.answer != null && { answer: q.answer }),
      ...(q.accept && { accept: q.accept }),
      ...(q.categories && { categories: q.categories }),
      ...(q.explanation && { explanation: q.explanation }),
    }));
    results = qb.map((q) => ({ correct: q.correct, ...(q.blanksCorrect && { blanksCorrect: q.blanksCorrect }) }));
    answers = {};
    score = { correct: cloudRecord.score, total: cloudRecord.total, percentage: cloudRecord.percentage };
    breakdown = Object.entries(
      qb.reduce((acc, q) => {
        if (!acc[q.type]) acc[q.type] = { type: q.type, label: typeLabels[q.type] || q.type, correct: 0, total: 0 };
        acc[q.type].total++;
        if (q.correct) acc[q.type].correct++;
        return acc;
      }, {})
    ).map(([, v]) => v);
  }
  const isFromHistory = isCloudView || !location.state?.fromQuiz;

  const effectiveResults = results.map((r, i) => overrides[i] ? { correct: true } : r);
  const correct = effectiveResults.filter((r) => r.correct).length;
  const total = questions.length;
  const pct = Math.round((correct / total) * 100);
  const circ = 2 * Math.PI * 54;
  const hasOverrides = Object.keys(overrides).length > 0;
  const showConfetti = pct >= 80;

  const msg = pct >= 90 ? "¡Excelente!" : pct >= 70 ? "¡Muy bien!" : pct >= 50 ? "¡Buen esfuerzo!" : "¡Sigue practicando!";

  const overrideTimerRef = useRef(null);
  useEffect(() => {
    if (!supabaseRecordId.current || Object.keys(overrides).length === 0) return;
    clearTimeout(overrideTimerRef.current);
    overrideTimerRef.current = setTimeout(async () => {
      try {
        const overrideCount = Object.keys(overrides).length;
        const newCorrect = results.filter((r, i) => r.correct || overrides[i]).length;
        const newPct = Math.round((newCorrect / total) * 100);
        await supabase.from("quiz_results").update({ score: newCorrect, percentage: newPct, overrides: overrideCount }).eq("id", supabaseRecordId.current);
        if (session?.user?.id && attempt.meta?.title) {
          await supabase.from("quiz_progress").update({ overrides }).eq("user_id", session.user.id).eq("quiz_title", attempt.meta.title);
        }
      } catch (err) { console.warn("Supabase override update failed:", err); }
    }, 800);
    return () => clearTimeout(overrideTimerRef.current);
  }, [overrides, results, total, session?.user?.id, attempt?.meta?.title]);

  const handleOverride = (idx, value = true) => {
    setOverrides((p) => { const n = { ...p }; if (value) n[idx] = true; else delete n[idx]; return n; });
  };

  const filteredIndices = questions.map((_, i) => i).filter((i) => {
    if (reviewFilter === "incorrect") return !effectiveResults[i].correct;
    if (reviewFilter === "correct") return effectiveResults[i].correct;
    return true;
  });

  const renderUserAnswer = (q, a, qIdx) => {
    if (!a || a.skipped) return <em style={{ color: C.muted }}>Skipped</em>;
    switch (q.type) {
      case "fill_blank":
        return (a.blanks || []).map((b, i) => (
          <span key={i} style={{
            display: "inline-block", padding: "3px 10px", borderRadius: 6, marginRight: 6, marginBottom: 4, fontSize: 14,
            background: results[qIdx]?.blanksCorrect?.[i] ? C.successLight : C.errorLight,
            color: results[qIdx]?.blanksCorrect?.[i] ? C.success : C.error, fontWeight: 600,
          }}>{b || "(empty)"}</span>
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

  const scoreColor = pct >= 70 ? C.success : pct >= 50 ? C.accent : C.error;

  return (
    <div className="fade-in" style={{ minHeight: "100vh", background: C.bg }}>
      {showConfetti && <Confetti />}
      <div style={{ maxWidth: 520, margin: "0 auto", padding: "16px 20px 32px" }}>

        {/* Back link */}
        <button onClick={() => navigate("/")} style={{
          background: "none", border: "none", color: C.muted, fontSize: 13, fontWeight: 500,
          cursor: "pointer", padding: "8px 4px", fontFamily: "'Figtree', sans-serif",
          display: "flex", alignItems: "center", gap: 4, minHeight: 44, marginBottom: 8,
        }}
        onMouseEnter={(e) => (e.currentTarget.style.color = C.accent)}
        onMouseLeave={(e) => (e.currentTarget.style.color = C.muted)}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          Home
        </button>

        {/* Score card */}
        <div style={{
          background: C.card, borderRadius: 20, padding: "32px 24px 24px", textAlign: "center",
          boxShadow: "0 1px 3px rgba(44,36,32,0.04), 0 6px 16px rgba(44,36,32,0.03)",
          marginBottom: 20,
        }}>
          {/* Score circle */}
          <div style={{ position: "relative", width: 110, height: 110, margin: "0 auto 12px" }}>
            <svg width="110" height="110" viewBox="0 0 110 110" style={{ display: "block" }}>
              <circle cx="55" cy="55" r="48" fill="none" stroke={C.border} strokeWidth="5" />
              <circle cx="55" cy="55" r="48" fill="none" stroke={scoreColor}
                strokeWidth="5" strokeLinecap="round"
                strokeDasharray={2 * Math.PI * 48} strokeDashoffset={(2 * Math.PI * 48) - (pct / 100) * (2 * Math.PI * 48)}
                transform="rotate(-90 55 55)" style={{ animation: "scoreReveal 1s ease-out forwards" }} />
            </svg>
            <div className="score-anim" style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <div style={{ fontSize: 30, fontWeight: 700, color: C.text, fontFamily: "'DM Serif Display', serif" }}>{pct}%</div>
            </div>
          </div>

          {/* Message */}
          <h1 style={{ fontSize: 24, color: C.text, lineHeight: 1.3, marginBottom: 4 }}>
            {msg}
          </h1>
          <p style={{ color: C.muted, fontSize: 14, marginBottom: 16 }}>
            {correct} of {total} correct{hasOverrides ? " (inc. overrides)" : ""}
          </p>

          {/* Type breakdown — compact inline */}
          <div style={{ display: "flex", justifyContent: "center", gap: 8, flexWrap: "wrap", marginBottom: 20 }}>
            {Object.entries(
              questions.reduce((acc, q, i) => {
                const t = typeShortLabels[q.type] || q.type;
                if (!acc[t]) acc[t] = { correct: 0, total: 0 };
                acc[t].total++;
                if (effectiveResults[i].correct) acc[t].correct++;
                return acc;
              }, {})
            ).map(([type, s]) => (
              <span key={type} style={{
                padding: "4px 12px", borderRadius: 999, fontSize: 12, fontWeight: 600,
                background: C.accentLight, color: C.accent,
              }}>{type} {s.correct}/{s.total}</span>
            ))}
          </div>

          {/* Action Buttons — side by side */}
          <div style={{ display: "flex", gap: 10 }}>
            <button onClick={() => reviewRef.current?.scrollIntoView({ behavior: "smooth" })} style={{
              flex: 1, background: C.accent, color: "white", border: "none",
              padding: "13px 16px", borderRadius: 12, fontWeight: 600, fontSize: 15,
              cursor: "pointer", fontFamily: "'Figtree', sans-serif", transition: "background 0.2s", minHeight: 48,
            }}
            onMouseEnter={(e) => (e.target.style.background = C.accentHover)}
            onMouseLeave={(e) => (e.target.style.background = C.accent)}>
              Review
            </button>
            {!isCloudView && (
              <button onClick={() => navigate(`/quiz/${quizId}?q=1`)} style={{
                flex: 1, background: "transparent", color: C.text,
                border: `1.5px solid ${C.border}`, padding: "13px 16px", borderRadius: 12,
                fontWeight: 600, fontSize: 15, cursor: "pointer", fontFamily: "'Figtree', sans-serif", minHeight: 48,
              }}>Try Again</button>
            )}
          </div>
        </div>

        {/* Review Section */}
        <div ref={reviewRef}>
          {/* Sticky review header */}
          <div style={{
            position: "sticky", top: 0, zIndex: 10, background: C.bg,
            padding: "16px 0 12px", borderBottom: `1px solid ${C.border}`, marginBottom: 16,
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <h2 style={{ fontSize: 22, color: C.text }}>Detailed Review</h2>
              <span style={{ color: C.muted, fontSize: 14, fontWeight: 600 }}>{correct}/{total} correct</span>
            </div>
            {/* Filter */}
            <div style={{ display: "flex", gap: 8 }}>
              {[
                { key: "all", label: "All" },
                { key: "incorrect", label: "Incorrect" },
                { key: "correct", label: "Correct" },
              ].map((f) => (
                <button key={f.key} onClick={() => setReviewFilter(f.key)} style={{
                  padding: "6px 14px", borderRadius: 999, border: "none", fontSize: 13, fontWeight: 600,
                  cursor: "pointer", fontFamily: "'Figtree', sans-serif", transition: "all 0.2s",
                  background: reviewFilter === f.key ? C.accent : C.accentLight,
                  color: reviewFilter === f.key ? "white" : C.accent,
                }}>{f.label}</button>
              ))}
            </div>
          </div>

          {filteredIndices.map((i) => {
            const q = questions[i];
            const r = effectiveResults[i];
            const wasOverridden = overrides[i];
            const wasOriginallyWrong = !results[i].correct;
            const showOverrideButtons = !isFromHistory;
            return (
              <div key={i} className="fade-in" style={{
                background: C.card, borderRadius: 16, padding: "24px 24px", marginBottom: 16,
                border: `1px solid ${C.border}`, borderLeft: `4px solid ${r.correct ? C.success : C.error}`,
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: C.muted }}>Q{i + 1} · {typeLabels[q.type]}</span>
                  <span style={{ fontSize: 12, fontWeight: 700, color: r.correct ? C.success : C.error }}>
                    {wasOverridden ? "✓ Overridden" : r.correct ? "✓ Correct" : "✗ Incorrect"}
                  </span>
                </div>
                <p style={{ fontSize: 16, fontWeight: 500, lineHeight: 1.5, marginBottom: 16, color: C.text }}>
                  {q.prompt.replace(/___+/g, "______")}
                </p>
                {!isCloudView && wasOriginallyWrong && (
                  <div style={{ marginBottom: 12, padding: "12px 16px", borderRadius: 12, background: wasOverridden ? C.successLight : C.errorLight }}>
                    <p style={{ fontSize: 12, fontWeight: 600, color: wasOverridden ? C.success : C.error, marginBottom: 4 }}>Your answer:</p>
                    <div style={{ color: wasOverridden ? C.success : C.error }}>{renderUserAnswer(q, answers[i], i)}</div>
                  </div>
                )}
                <div style={{ padding: "12px 16px", borderRadius: 12, background: C.successLight }}>
                  <p style={{ fontSize: 12, fontWeight: 600, color: C.success, marginBottom: 4 }}>Correct answer:</p>
                  <div style={{ color: C.success }}>{renderCorrectAnswer(q)}</div>
                </div>
                {q.explanation && (
                  <p style={{ fontSize: 13, color: C.muted, marginTop: 12, lineHeight: 1.5, fontStyle: "italic" }}>
                    💡 {q.explanation}
                  </p>
                )}
                {showOverrideButtons && wasOriginallyWrong && !wasOverridden && q.type !== "multiple_choice" && (
                  <button onClick={() => handleOverride(i)} style={{
                    marginTop: 14, background: C.successLight, border: `1.5px solid ${C.success}`,
                    borderRadius: 10, padding: "10px 18px", fontSize: 14, fontWeight: 600,
                    color: C.success, cursor: "pointer", fontFamily: "'Figtree', sans-serif",
                    transition: "all 0.2s", minHeight: 44,
                  }}
                  onMouseEnter={(e) => { e.target.style.background = C.success; e.target.style.color = "white"; }}
                  onMouseLeave={(e) => { e.target.style.background = C.successLight; e.target.style.color = C.success; }}>
                    ✓ My answer was correct
                  </button>
                )}
                {showOverrideButtons && wasOverridden && (
                  <button onClick={() => handleOverride(i, false)} style={{
                    marginTop: 14, background: "transparent", border: `1.5px solid ${C.border}`,
                    borderRadius: 10, padding: "10px 18px", fontSize: 13, fontWeight: 500,
                    color: C.muted, cursor: "pointer", fontFamily: "'Figtree', sans-serif", minHeight: 44,
                  }}>Undo override</button>
                )}
              </div>
            );
          })}
          {filteredIndices.length === 0 && (
            <p style={{ textAlign: "center", color: C.muted, fontSize: 15, padding: "32px 0" }}>
              No {reviewFilter} questions to show.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// ROUTE WRAPPERS
// ═══════════════════════════════════════════════════════════════
function HomeRoute({ history, session }) {
  const navigate = useNavigate();
  const { quizzes, loading, saveQuiz, deleteQuiz } = history;

  const handleLoad = async (d) => {
    const id = await saveQuiz(d);
    if (id != null) navigate(`/quiz/${id}?q=1`);
  };
  const handleSelectQuiz = (quiz) => navigate(`/quiz/${quiz.id}?q=1`);

  return (
    <HomeScreen
      onLoad={handleLoad} quizzes={quizzes} loading={loading}
      onDeleteQuiz={deleteQuiz} onSelectQuiz={handleSelectQuiz} session={session}
    />
  );
}

// ═══════════════════════════════════════════════════════════════
// MAIN APP
// ═══════════════════════════════════════════════════════════════
export default function App() {
  const [session, setSession] = useState(undefined);
  const history = useQuizHistory(session);
  const pendingCount = usePendingCount();

  useEffect(() => { injectStyles(); }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session: s } }) => setSession(s));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    flush();
    const handleOnline = () => flush();
    window.addEventListener("online", handleOnline);
    return () => window.removeEventListener("online", handleOnline);
  }, []);

  if (session === undefined) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: C.bg }}>
        <div style={{ textAlign: "center" }}>
          <img src="/icons/logo.png" alt="Piñata" style={{ width: 100, height: 100, marginBottom: 12 }} />
          <p style={{ color: C.muted, fontSize: 16, fontFamily: "'Figtree', system-ui, sans-serif" }}>Loading...</p>
        </div>
      </div>
    );
  }

  if (!session) return <LoginScreen />;

  return (
    <>
      {pendingCount > 0 && (
        <div style={{
          position: "fixed", top: 12, left: 12, zIndex: 9999,
          display: "flex", alignItems: "center", gap: 6,
          background: "#FFFBEB", border: "1px solid #F59E0B",
          borderRadius: 8, padding: "5px 12px", fontSize: 12,
          fontWeight: 600, color: "#92400E", fontFamily: "'Figtree', sans-serif",
          boxShadow: "0 1px 4px rgba(0,0,0,0.08)",
        }}>
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#F59E0B", display: "inline-block" }} />
          Unsynced ({pendingCount})
        </div>
      )}
      <Routes>
        <Route path="/" element={<HomeRoute history={history} session={session} />} />
        <Route path="/quiz/:quizId" element={<QuizRoute saveAttempt={history.saveAttempt} session={session} />} />
        <Route path="/quiz/:quizId/results" element={<ResultsRoute session={session} />} />
        <Route path="/history/view" element={<ResultsRoute session={session} />} />
        <Route path="/history" element={<Navigate to="/" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  );
}
