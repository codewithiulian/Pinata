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
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { background: #F0FAF8; font-family: 'Nunito', -apple-system, BlinkMacSystemFont, sans-serif; color: #1A2F2B; -webkit-font-smoothing: antialiased; padding-bottom: env(safe-area-inset-bottom, 0); overflow-x: hidden; }
    h1, h2, h3, h4 { font-family: 'Nunito', sans-serif; font-weight: 800; }
    input[type="text"], textarea { font-family: 'Nunito', sans-serif; }
    ::placeholder { color: #B0E0D8; }
    .fade-in { animation: fadeIn 0.4s ease-out both; }
    .slide-in-right { animation: slideInRight 0.3s ease-out both; }
    .slide-in-left { animation: slideInLeft 0.3s ease-out both; }
    .slide-up { animation: slideUp 0.3s ease-out both; }
    .score-anim { animation: countUp 0.6s 0.5s ease-out both; }
    .skeleton { background: linear-gradient(90deg, #D4F0EB 25%, #E8F7F4 50%, #D4F0EB 75%); background-size: 600px 100%; animation: shimmer 1.8s infinite ease-in-out; border-radius: 8px; }
    @keyframes fadeIn { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: translateY(0); } }
    @keyframes slideInRight { from { opacity: 0; transform: translateX(40px); } to { opacity: 1; transform: translateX(0); } }
    @keyframes slideInLeft { from { opacity: 0; transform: translateX(-40px); } to { opacity: 1; transform: translateX(0); } }
    @keyframes slideUp { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
    @keyframes scoreReveal { from { stroke-dashoffset: 339.292; } }
    @keyframes countUp { from { opacity: 0; transform: scale(0.8); } to { opacity: 1; transform: scale(1); } }
    @keyframes shimmer { from { background-position: -600px 0; } to { background-position: 600px 0; } }
    @keyframes confettiDrop { 0% { transform: translateY(-10vh) rotate(0deg); opacity: 1; } 80% { opacity: 1; } 100% { transform: translateY(105vh) rotate(720deg); opacity: 0; } }
    @keyframes sheetUp { from { transform: translateY(100%); } to { transform: translateY(0); } }
    @keyframes overlayFade { from { opacity: 0; } to { opacity: 1; } }
    @keyframes progressGrow { from { width: 0%; } }
    .safe-top { padding-top: max(16px, env(safe-area-inset-top, 16px)) !important; }
    .safe-top-fixed { top: env(safe-area-inset-top, 12px) !important; }
  `;
  document.head.appendChild(s);
};

const C = {
  bg: "#F0FAF8", card: "#FFFFFF", accent: "#00B4A0", accentLight: "#E0F5F1",
  accentHover: "#008F7E", text: "#1A2F2B", muted: "#5E8078", success: "#00C48C",
  successLight: "#E0F8F0", error: "#FF6584", errorLight: "#FFF0F3",
  border: "#D4F0EB", inputBg: "#F0FAF8", overlay: "rgba(26, 47, 43, 0.45)",
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

const typeLabels = { fill_blank: "Fill in the Blanks", multiple_choice: "Single Choice", translate: "Translate", classify: "Classify" };
const typeShortLabels = { fill_blank: "Fill", multiple_choice: "SC", translate: "Trans", classify: "Classify" };

const typeColors = {
  fill_blank: { bg: "#E0F5F1", text: "#008F7E" },
  multiple_choice: { bg: "#FBEAF0", text: "#993556" },
  translate: { bg: "#E6F1FB", text: "#0C447C" },
  classify: { bg: "#FAEEDA", text: "#854F0B" },
};

const getResultMsg = (pct) => {
  if (pct === 100) return { msg: "\u00a1Perfecto! \ud83c\udf89", sub: "Flawless victory" };
  if (pct >= 91) return { msg: "\u00a1Casi perfecto!", sub: "So close to perfection" };
  if (pct >= 76) return { msg: "\u00a1Excelente!", sub: "You're really getting this" };
  if (pct >= 51) return { msg: "\u00a1Muy bien!", sub: "Great work, keep it up" };
  if (pct >= 26) return { msg: "\u00a1Vas por buen camino!", sub: "You're on the right track" };
  if (pct >= 1) return { msg: "\u00a1Sigue intentando!", sub: "You're building the foundation" };
  return { msg: "\u00a1No te rindas!", sub: "Keep practicing, you'll get there" };
};

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
function ConfirmModal({ open, title, message, confirmLabel, cancelLabel, onConfirm, onCancel, destructive }) {
  if (!open) return null;
  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center",
      background: C.overlay, animation: "overlayFade 0.2s ease-out",
    }} onClick={onCancel}>
      <div className="slide-up" style={{
        background: C.card, borderRadius: 16, padding: 32, maxWidth: 340, width: "calc(100% - 48px)",
        boxShadow: "0 8px 32px rgba(0,60,50,0.15)", textAlign: "center",
      }} onClick={(e) => e.stopPropagation()}>
        <h3 style={{ fontSize: 18, fontWeight: 800, color: C.text, marginBottom: 8, lineHeight: 1.3 }}>{title}</h3>
        <p style={{ color: C.muted, fontSize: 15, fontWeight: 600, lineHeight: 1.6, marginBottom: 24 }}>{message}</p>
        <div style={{ display: "flex", gap: 12 }}>
          <button onClick={onCancel} style={{
            flex: 1, padding: "14px 16px", borderRadius: 14, border: `2px solid ${C.border}`,
            background: "transparent", color: C.text, fontWeight: 700, fontSize: 15,
            cursor: "pointer", fontFamily: "'Nunito', sans-serif", minHeight: 48,
          }}>{cancelLabel || "Cancel"}</button>
          <button onClick={onConfirm} style={{
            flex: 1, padding: "14px 16px", borderRadius: 14, border: "none",
            background: destructive ? C.error : C.accent, color: "white", fontWeight: 800, fontSize: 15,
            cursor: "pointer", fontFamily: "'Nunito', sans-serif", minHeight: 48,
          }}>{confirmLabel || "Leave"}</button>
        </div>
      </div>
    </div>
  );
}

function SkeletonCard({ variant = "default" }) {
  return (
    <div style={{
      background: C.card, borderRadius: 16, padding: 16,
      boxShadow: "0 1px 4px rgba(0,60,50,0.06)",
      border: variant === "progress" ? `2.5px solid ${C.accentLight}` : "1px solid transparent",
    }}>
      {variant === "progress" && (
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
          <div className="skeleton" style={{ width: 80, height: 22, borderRadius: 20 }} />
        </div>
      )}
      <div className="skeleton" style={{ width: "70%", height: 18, marginBottom: 8 }} />
      <div className="skeleton" style={{ width: "45%", height: 13, marginBottom: variant === "progress" ? 14 : 4 }} />
      {variant === "progress" && (
        <>
          <div style={{ display: "flex", gap: 3, marginBottom: 14 }}>
            {Array.from({ length: 8 }, (_, i) => (
              <div key={i} className="skeleton" style={{ flex: 1, height: 14, borderRadius: 7 }} />
            ))}
          </div>
          <div className="skeleton" style={{ width: "100%", height: 44, borderRadius: 14 }} />
        </>
      )}
    </div>
  );
}

function Confetti() {
  const pieces = useMemo(() =>
    Array.from({ length: 40 }, (_, i) => ({
      left: Math.random() * 100,
      delay: Math.random() * 2,
      dur: 2 + Math.random() * 2,
      color: ["#00B4A0", "#00C48C", "#FF6584", "#7ED8C9", "#4A90D9", "#F5A623"][i % 6],
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

function MiniScoreCircle({ pct, size = 44 }) {
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
        fill={color} fontSize="11" fontWeight="700" fontFamily="'Nunito', sans-serif">
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
        <h3 style={{ fontSize: 18, fontWeight: 800, color: C.text, marginBottom: 16, textAlign: "center" }}>Add Quiz</h3>
        <button onClick={() => ref.current?.click()} style={{
          width: "100%", padding: "14px 24px", borderRadius: 14, border: "none",
          background: C.accent, color: "white", fontWeight: 800, fontSize: 15,
          cursor: "pointer", fontFamily: "'Nunito', sans-serif", marginBottom: 16, minHeight: 52,
          transition: "filter 0.1s, transform 0.1s",
        }}
        onMouseEnter={(e) => (e.target.style.filter = "brightness(1.05)")}
        onMouseLeave={(e) => (e.target.style.filter = "none")}
        >Choose Quiz File</button>
        <input ref={ref} type="file" accept=".json" style={{ display: "none" }}
          onChange={(e) => { if (e.target.files[0]) handle(e.target.files[0]); }} />
        <div style={{
          border: `2px dashed ${dragging ? C.accent : C.border}`, borderRadius: 12,
          padding: "24px 16px", textAlign: "center",
          background: dragging ? C.accentLight : "transparent", transition: "all 0.2s",
        }}>
          <p style={{ color: C.muted, fontSize: 14, fontWeight: 600 }}>or drag & drop a JSON file here</p>
        </div>
        {err && <p style={{ color: C.error, fontSize: 13, fontWeight: 600, marginTop: 12, textAlign: "center" }}>{err}</p>}
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
    width: "100%", padding: "14px 18px", borderRadius: 14,
    border: `2.5px solid ${C.border}`, background: C.inputBg,
    fontSize: 15, fontWeight: 600, color: C.text, outline: "none", marginBottom: 14,
    fontFamily: "'Nunito', sans-serif", transition: "border-color 0.2s",
    boxSizing: "border-box", minHeight: 48,
  };

  const btnStyle = (enabled) => ({
    width: "100%", padding: "14px 24px", borderRadius: 14, border: "none",
    background: enabled ? C.accent : C.border,
    color: "white", fontWeight: 800, fontSize: 15,
    cursor: enabled ? "pointer" : "not-allowed",
    fontFamily: "'Nunito', sans-serif", transition: "filter 0.1s, transform 0.1s", minHeight: 52,
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
        <h1 style={{ fontSize: 22, fontWeight: 900, color: C.text, marginBottom: 8 }}>Piñata</h1>
        <p style={{ color: C.muted, fontSize: 15, fontWeight: 600, marginBottom: 36, lineHeight: 1.6 }}>
          Sign in to track your Spanish quiz scores
        </p>
        {sent ? (
          <div style={{
            background: C.successLight, border: `1px solid ${C.success}`, borderRadius: 14,
            padding: "24px 20px", textAlign: "center",
          }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>✉️</div>
            <p style={{ fontWeight: 700, color: C.success, marginBottom: 4 }}>Check your email!</p>
            <p style={{ color: C.muted, fontSize: 14, fontWeight: 600 }}>
              We sent a magic link to <strong style={{ color: C.text }}>{email}</strong>
            </p>
            <button onClick={() => setSent(false)} style={{
              marginTop: 16, background: "none", border: "none", color: C.accent,
              fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: "'Nunito', sans-serif",
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
            <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "18px 0", color: C.muted, fontSize: 13, fontWeight: 600 }}>
              <div style={{ flex: 1, height: 1, background: C.border }} />
              <span>or</span>
              <div style={{ flex: 1, height: 1, background: C.border }} />
            </div>
            <button type="button" onClick={handleMagicLink} disabled={loading || !email.trim()} style={{
              ...btnStyle(!loading && email.trim()), background: "none",
              border: `2.5px solid ${(!loading && email.trim()) ? C.accent : C.border}`,
              color: (!loading && email.trim()) ? C.accent : C.muted,
            }}>
              {loading ? "Sending..." : "Send Magic Link"}
            </button>
            {error && <p style={{ color: C.error, fontSize: 13, fontWeight: 600, marginTop: 12 }}>{error}</p>}
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
  const [deleteConfirmId, setDeleteConfirmId] = useState(null);
  const [headerH, setHeaderH] = useState(0);
  const headerRef = useRef(null);
  useEffect(() => {
    if (!headerRef.current) return;
    const ro = new ResizeObserver(([e]) => setHeaderH(e.contentRect.height + parseFloat(getComputedStyle(e.target).paddingTop) + parseFloat(getComputedStyle(e.target).paddingBottom)));
    ro.observe(headerRef.current);
    return () => ro.disconnect();
  }, []);
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
          data.forEach((p) => { map[p.quiz_title] = { current: (p.current_index ?? 0) + 1, answers: p.answers || {} }; });
          setQuizProgress(map);
        }
      });
  }, [session]);

  const displayName = session?.user?.user_metadata?.display_name
    || session?.user?.user_metadata?.full_name
    || session?.user?.email?.split("@")[0] || "there";

  const streak = useMemo(() => computeStreak(cloudHistory), [cloudHistory]);

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
        <div style={{ textAlign: "center", padding: `${pullDistance * 0.3}px 0`, color: C.muted, fontSize: 13, fontWeight: 600, transition: "padding 0.1s" }}>
          <span style={{ display: "inline-block", transform: `rotate(${pullDistance > 50 ? 180 : 0}deg)`, transition: "transform 0.2s" }}>↓</span>
          {pullDistance > 50 ? " Release to refresh" : " Pull to refresh"}
        </div>
      )}

      {/* Fixed header */}
      <div ref={headerRef} className="safe-top" style={{ position: "fixed", top: 0, left: 0, right: 0, zIndex: 20, background: C.bg, padding: "16px 20px 0" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 4 }}>
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 900, color: C.text, lineHeight: 1.3 }}>Hola, {displayName}</h1>
            <p style={{ color: C.muted, fontSize: 14, fontWeight: 600, marginTop: 2 }}>Ready to practice?</p>
          </div>
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

        {/* Stats badges with streak */}
        <div style={{ display: "flex", gap: 8, marginBottom: 12, marginTop: 8, flexWrap: "wrap" }}>
          {historyLoading ? (
            <>
              <div className="skeleton" style={{ width: 90, height: 26, borderRadius: 20 }} />
              <div className="skeleton" style={{ width: 70, height: 26, borderRadius: 20 }} />
              <div className="skeleton" style={{ width: 70, height: 26, borderRadius: 20 }} />
            </>
          ) : (
            <>
              {streak > 0 && (
                <span style={{
                  padding: "5px 12px", borderRadius: 20, fontSize: 11, fontWeight: 800,
                  background: C.accent, color: "#fff",
                }}>{"\ud83d\udd25"} {streak} day streak</span>
              )}
              {stats ? (
                <>
                  <span style={{
                    padding: "5px 12px", borderRadius: 20, fontSize: 11, fontWeight: 800,
                    background: C.accentLight, color: C.accentHover,
                  }}>Avg: {stats.avg}%</span>
                  <span style={{
                    padding: "5px 12px", borderRadius: 20, fontSize: 11, fontWeight: 800,
                    background: C.accentLight, color: C.accentHover,
                  }}>Best: {stats.best}%</span>
                </>
              ) : cloudHistory.length === 0 && streak === 0 ? (
                <p style={{ color: C.muted, fontSize: 13, fontWeight: 600 }}>Complete your first quiz!</p>
              ) : null}
            </>
          )}
        </div>

        {/* Tab bar — pill style */}
        <div style={{ display: "flex", borderRadius: 12, background: C.accentLight, padding: 4, marginBottom: 16 }}>
          {["Quizzes", "History"].map((tab) => (
            <button key={tab} onClick={() => setActiveTab(tab.toLowerCase())} style={{
              flex: 1, padding: "8px 0", background: activeTab === tab.toLowerCase() ? C.card : "transparent",
              border: "none", borderRadius: 10, color: activeTab === tab.toLowerCase() ? C.accentHover : C.muted,
              fontWeight: 700, fontSize: 13, cursor: "pointer",
              fontFamily: "'Nunito', sans-serif", transition: "all 0.15s",
              boxShadow: activeTab === tab.toLowerCase() ? "0 1px 3px rgba(0,60,50,0.08)" : "none",
            }}>{tab}</button>
          ))}
        </div>
      </div>

      {/* Spacer for fixed header */}
      <div style={{ height: headerH }} />

      {/* Tab content */}
      <div style={{ padding: "0 16px 32px", maxWidth: 520, margin: "0 auto", width: "100%" }}>
        {activeTab === "quizzes" ? (
          <div key="quizzes" className="fade-in">
            {loading ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <SkeletonCard variant="progress" />
                <SkeletonCard />
                <SkeletonCard />
              </div>
            ) : quizzes.length === 0 ? (
              <div style={{ textAlign: "center", padding: "48px 20px" }}>
                <div style={{ fontSize: 48, marginBottom: 12, opacity: 0.8 }}>📚</div>
                <p style={{ color: C.text, fontSize: 18, fontWeight: 800, marginBottom: 4 }}>No quizzes yet</p>
                <p style={{ color: C.muted, fontSize: 14, fontWeight: 600, lineHeight: 1.6 }}>Upload your first quiz to get started!</p>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {quizzes.map((q) => {
                  const title = q.data.meta?.title || "Quiz";
                  const unit = q.data.meta?.unit;
                  const lesson = q.data.meta?.lesson;
                  const qCount = q.data.questions?.length || 0;
                  const lastScore = lastScores[title];
                  const progress = quizProgress[title];

                  return (
                    <div key={q.id} className="fade-in" onClick={() => onSelectQuiz(q)}
                      style={{
                        background: C.card, borderRadius: 16, padding: 16, cursor: "pointer",
                        boxShadow: "0 1px 4px rgba(0,60,50,0.06)",
                        transition: "transform 0.15s, box-shadow 0.15s", position: "relative",
                        border: progress ? `2.5px solid ${C.accent}` : "1px solid transparent",
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.transform = "translateY(-1px)"; e.currentTarget.style.boxShadow = "0 4px 12px rgba(0,60,50,0.1)"; }}
                      onMouseLeave={(e) => { e.currentTarget.style.transform = "none"; e.currentTarget.style.boxShadow = "0 1px 4px rgba(0,60,50,0.06)"; }}>

                      {/* In progress badge */}
                      {progress && (
                        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8, paddingRight: 28 }}>
                          <span style={{
                            padding: "4px 12px", borderRadius: 20, fontSize: 11, fontWeight: 800,
                            background: C.accent, color: "#fff",
                          }}>In progress</span>
                        </div>
                      )}

                      <h3 style={{
                        fontSize: 16, fontWeight: 800, color: C.text, marginBottom: 4, lineHeight: 1.3,
                        paddingRight: !progress && lastScore !== undefined ? 50 : 0,
                      }}>{title}</h3>
                      <p style={{ fontSize: 12, color: C.muted, fontWeight: 600, lineHeight: 1.5, marginBottom: progress ? 12 : 4 }}>
                        {unit != null && lesson != null ? `Unit ${unit} \u00b7 Lesson ${lesson} \u00b7 ` : ""}{qCount} questions
                      </p>

                      {/* Segmented progress bar for in-progress quizzes */}
                      {progress && (
                        <div style={{ display: "flex", gap: 3, padding: 3, background: "#D4F0EB", borderRadius: 10, height: 14, marginBottom: 12 }}>
                          {Array.from({ length: qCount }, (_, i) => {
                            let segColor;
                            if (i < progress.current - 1) {
                              const ans = progress.answers[i];
                              segColor = ans && ans.skipped ? C.error : C.success;
                            } else if (i === progress.current - 1) {
                              segColor = "rgba(0, 180, 160, 0.4)";
                            } else {
                              segColor = "#E0F5F1";
                            }
                            return <div key={i} style={{ flex: 1, borderRadius: 7, background: segColor }} />;
                          })}
                        </div>
                      )}

                      {/* Continue button for in-progress */}
                      {progress && (
                        <button onClick={(e) => { e.stopPropagation(); onSelectQuiz(q); }} style={{
                          width: "100%", padding: "12px", borderRadius: 14, border: `2.5px solid ${C.accent}`,
                          background: "transparent", color: C.text, fontWeight: 800, fontSize: 15,
                          cursor: "pointer", fontFamily: "'Nunito', sans-serif", transition: "all 0.15s",
                        }}
                        onMouseEnter={(e) => { e.currentTarget.style.background = C.accent; e.currentTarget.style.color = "#fff"; }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = C.text; }}>
                          Continue →
                        </button>
                      )}

                      {/* Last score badge (when not in progress) */}
                      {!progress && lastScore !== undefined && (
                        <div style={{
                          position: "absolute", top: 42, right: 12,
                        }}>
                          <span style={{
                            width: 38, height: 38, borderRadius: "50%",
                            background: lastScore >= 70 ? C.success : lastScore >= 50 ? C.accent : C.error,
                            color: "white", display: "flex", alignItems: "center", justifyContent: "center",
                            fontSize: 11, fontWeight: 700,
                          }}>{lastScore}%</span>
                        </div>
                      )}

                      {/* Delete button */}
                      <button onClick={(e) => {
                          e.stopPropagation();
                          setDeleteConfirmId(q.id);
                        }}
                        style={{
                          position: "absolute", top: 8, right: 8, background: "none", border: "none",
                          color: C.muted, cursor: "pointer", fontSize: 18, padding: 4, opacity: 0.3,
                          width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center",
                          transition: "opacity 0.2s", borderRadius: "50%", zIndex: 2,
                        }}
                        onMouseEnter={(e) => { e.currentTarget.style.opacity = "1"; e.currentTarget.style.background = C.errorLight; e.currentTarget.style.color = C.error; }}
                        onMouseLeave={(e) => { e.currentTarget.style.opacity = "0.3"; e.currentTarget.style.background = "none"; e.currentTarget.style.color = C.muted; }}>×</button>
                    </div>
                  );
                })}
              </div>
            )}
            {/* Add quiz button */}
            <button onClick={() => setShowAddQuiz(true)} style={{
              width: "100%", padding: "14px", borderRadius: 14, marginTop: 16,
              border: `2px dashed ${C.border}`, background: C.accentLight,
              color: C.muted, fontWeight: 700, fontSize: 14, cursor: "pointer",
              fontFamily: "'Nunito', sans-serif", transition: "all 0.2s", minHeight: 48,
              textAlign: "center",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.borderColor = C.accent; e.currentTarget.style.color = C.accent; }}
            onMouseLeave={(e) => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.color = C.muted; }}>
              + Add quiz
            </button>
          </div>
        ) : (
          <div key="history" className="fade-in">
            {historyLoading ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {[1, 2, 3].map((i) => <SkeletonCard key={i} />)}
              </div>
            ) : cloudHistory.length === 0 ? (
              <div style={{ textAlign: "center", padding: "48px 20px" }}>
                <div style={{ fontSize: 48, marginBottom: 12, opacity: 0.8 }}>📊</div>
                <p style={{ color: C.text, fontSize: 16, fontWeight: 800 }}>No quiz results yet</p>
                <p style={{ color: C.muted, fontSize: 14, fontWeight: 600, marginTop: 4 }}>Complete a quiz to see your history!</p>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {cloudHistory.map((r) => (
                  <div key={r.id} className="fade-in" onClick={() => navigate("/history/view", { state: { cloudRecord: r } })} style={{
                    background: C.card, borderRadius: 14, padding: "14px 16px",
                    display: "flex", alignItems: "center", gap: 12,
                    boxShadow: "0 1px 4px rgba(0,60,50,0.06)",
                    cursor: "pointer", transition: "transform 0.15s, box-shadow 0.15s",
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.transform = "translateY(-1px)"; e.currentTarget.style.boxShadow = "0 4px 12px rgba(0,60,50,0.1)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.transform = "none"; e.currentTarget.style.boxShadow = "0 1px 4px rgba(0,60,50,0.06)"; }}>
                    <MiniScoreCircle pct={r.percentage} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: 15, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {r.lesson_title || "Quiz"}
                      </div>
                      <div style={{ fontSize: 12, color: C.muted, fontWeight: 600 }}>
                        {r.score}/{r.total} correct
                        {r.overrides > 0 ? ` (+${r.overrides} override${r.overrides !== 1 ? "s" : ""})` : ""}
                      </div>
                    </div>
                    <div style={{ fontSize: 11, color: C.accent, fontWeight: 700, whiteSpace: "nowrap" }}>
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
      <ConfirmModal open={deleteConfirmId !== null}
        title="Delete quiz?"
        message="You'll lose all progress and saved data for this quiz."
        confirmLabel="Delete" cancelLabel="Cancel" destructive
        onConfirm={() => { onDeleteQuiz(deleteConfirmId); setDeleteConfirmId(null); }}
        onCancel={() => setDeleteConfirmId(null)} />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// QUESTION COMPONENTS
// ═══════════════════════════════════════════════════════════════
function FillBlank({ q, value, onChange, onSubmit }) {
  const blanks = value?.blanks || [];
  const parts = q.prompt.split(/(___+)/);
  const inputRefs = useRef([]);
  let idx = 0;

  useEffect(() => {
    if (inputRefs.current[0]) inputRefs.current[0].focus();
  }, [q]);

  const update = (i, v) => {
    const nb = [...blanks]; nb[i] = v; onChange({ blanks: nb });
  };

  const blankCount = parts.filter((p) => /^___+$/.test(p)).length;

  const handleKeyDown = (i, e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (inputRefs.current[i + 1]) inputRefs.current[i + 1].focus();
      else if (i === blankCount - 1 && onSubmit) onSubmit();
    }
  };

  return (
    <div>
      <div style={{ fontSize: 18, fontWeight: 600, lineHeight: 2.4, marginBottom: 8 }}>
        {parts.map((p, pi) => {
          if (/^___+$/.test(p)) {
            const ci = idx++;
            return (
              <input key={pi} ref={(el) => (inputRefs.current[ci] = el)}
                type="text" value={blanks[ci] || ""} onChange={(e) => update(ci, e.target.value)}
                onKeyDown={(e) => handleKeyDown(ci, e)}
                placeholder="" autoComplete="off" autoFocus={ci === 0}
                style={{
                  display: "inline-block", border: `2.5px solid ${C.border}`, borderRadius: 10,
                  background: C.inputBg, padding: "6px 12px", margin: "0 4px",
                  textAlign: "center", color: C.accent, fontWeight: 700, outline: "none",
                  minWidth: 100, minHeight: 44, fontSize: "inherit", lineHeight: "inherit",
                  fontFamily: "'Nunito', sans-serif", transition: "all 0.2s",
                }}
                onFocus={(e) => { e.target.style.borderColor = C.accent; e.target.style.boxShadow = `0 0 0 3px ${C.accent}20`; }}
                onBlur={(e) => { e.target.style.borderColor = C.border; e.target.style.boxShadow = "none"; }}
              />
            );
          }
          return <span key={pi}>{p}</span>;
        })}
      </div>
      {q.hint && <p style={{ color: C.muted, fontSize: 12, fontWeight: 600, marginTop: 12, lineHeight: 1.5 }}>💡 {q.hint}</p>}
    </div>
  );
}

function MultiChoice({ q, value, onChange }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {q.options.map((opt, i) => {
        const sel = value?.selected === i;
        return (
          <div key={i} onClick={() => onChange({ selected: i })}
            style={{
              padding: "14px 16px", borderRadius: 14, cursor: "pointer", transition: "all 0.15s",
              border: `2.5px solid ${sel ? C.accent : C.border}`,
              background: sel ? C.accentLight : C.card, color: C.text,
              fontWeight: 600, fontSize: 14, minHeight: 52,
              display: "flex", alignItems: "center", gap: 10,
            }}>
            <span style={{
              display: "inline-flex", alignItems: "center", justifyContent: "center",
              width: 22, height: 22, borderRadius: "50%", flexShrink: 0,
              transition: "all 0.15s",
              border: `2.5px solid ${sel ? C.accent : "#B0E0D8"}`,
              background: sel ? C.accent : "transparent",
              boxShadow: sel ? "inset 0 0 0 4px #fff" : "none",
            }} />
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
  useEffect(() => { if (ref.current) ref.current.focus(); }, [q]);

  return (
    <div>
      {q.direction && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16, color: C.muted, fontSize: 14, fontWeight: 700 }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={C.accent} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" />
          </svg>
          {q.direction}
        </div>
      )}
      <textarea ref={ref} value={value?.text || ""} onChange={(e) => onChange({ text: e.target.value })}
        placeholder="Type your translation here..." rows={2}
        style={{
          width: "100%", padding: 14, borderRadius: 14, border: `2.5px solid ${C.border}`,
          background: "transparent", fontSize: 15, fontWeight: 600, resize: "none", outline: "none", overflow: "hidden",
          lineHeight: 1.6, color: C.text, transition: "border-color 0.2s", minHeight: 80,
          fontFamily: "'Nunito', sans-serif",
        }}
        onFocus={(e) => (e.target.style.borderColor = C.accent)}
        onBlur={(e) => (e.target.style.borderColor = C.border)} />
      {q.hint && <p style={{ color: C.muted, fontSize: 12, fontWeight: 600, marginTop: 10, lineHeight: 1.5 }}>💡 {q.hint}</p>}
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

  const startDrag = (item, clientX, clientY, rect) => {
    dragOffset.current = { x: clientX - rect.left, y: clientY - rect.top };
    dragItemRef.current = item;
    setDragging(item);
    setDragPos({ x: clientX, y: clientY });
  };

  const handleTouchStart = (item, e) => {
    const touch = e.touches[0];
    startDrag(item, touch.clientX, touch.clientY, e.currentTarget.getBoundingClientRect());
  };

  const handleMouseDown = (item, e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    startDrag(item, e.clientX, e.clientY, e.currentTarget.getBoundingClientRect());
  };

  useEffect(() => {
    if (!dragging) return;
    const hitTest = (cx, cy) => {
      let found = null;
      for (const [cat, el] of Object.entries(catRefs.current)) {
        if (!el) continue;
        const r = el.getBoundingClientRect();
        if (cx >= r.left && cx <= r.right && cy >= r.top && cy <= r.bottom) { found = cat; break; }
      }
      hoveredCatRef.current = found;
      setHoveredCat(found);
    };
    const dropItem = () => {
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
    const onTouchMove = (e) => { e.preventDefault(); const t = e.touches[0]; setDragPos({ x: t.clientX, y: t.clientY }); hitTest(t.clientX, t.clientY); };
    const onMouseMove = (e) => { setDragPos({ x: e.clientX, y: e.clientY }); hitTest(e.clientX, e.clientY); };
    document.addEventListener("touchmove", onTouchMove, { passive: false });
    document.addEventListener("touchend", dropItem);
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", dropItem);
    return () => { document.removeEventListener("touchmove", onTouchMove); document.removeEventListener("touchend", dropItem); document.removeEventListener("mousemove", onMouseMove); document.removeEventListener("mouseup", dropItem); };
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
    borderRadius: 20, fontSize: isPlaced ? 13 : 14, fontWeight: 600, cursor: "pointer",
    transition: "all 0.2s", userSelect: "none", minHeight: 44,
    border: `2.5px solid ${isSel || isPlaced ? C.accent : C.border}`,
    background: isSel || isPlaced ? C.accentLight : C.card,
    color: isSel || isPlaced ? C.accentHover : C.text,
  });

  return (
    <div>
      {unplaced.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 20 }}>
          {unplaced.map((item) => (
            <span key={item} onClick={() => selectItem(item)} onTouchStart={(e) => handleTouchStart(item, e)}
              onMouseDown={(e) => handleMouseDown(item, e)}
              style={{ ...chip(selected === item, false), opacity: dragging === item ? 0.3 : 1, cursor: "grab" }}>
              {item}
            </span>
          ))}
        </div>
      )}
      {selected && !dragging && (
        <p style={{ color: C.accent, fontSize: 13, fontWeight: 600, marginBottom: 12 }}>
          Tap a category below to place "{selected}"
        </p>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {Object.keys(q.categories).map((cat) => (
          <div key={cat} ref={(el) => (catRefs.current[cat] = el)}>
            <div onClick={() => placeInCategory(cat)}
              style={{
                border: `2.5px ${placements[cat]?.length ? "solid" : "dashed"} ${hoveredCat === cat ? C.accent : selected ? C.accent + "88" : C.border}`,
                borderRadius: 14, padding: 14, minHeight: 56,
                cursor: selected ? "pointer" : "default", transition: "all 0.2s",
                background: hoveredCat === cat ? C.accentLight : selected ? `${C.accentLight}44` : "transparent",
                transform: hoveredCat === cat ? "scale(1.01)" : "none",
              }}>
              <p style={{
                fontSize: 11, fontWeight: 700, color: C.muted, textTransform: "uppercase",
                letterSpacing: 1, marginBottom: placements[cat]?.length ? 10 : 0,
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
          padding: "10px 18px", borderRadius: 20, fontSize: 14, fontWeight: 600,
          background: C.accentLight, border: `2.5px solid ${C.accent}`, color: C.accentHover,
          boxShadow: "0 8px 24px rgba(0,60,50,0.15)", transform: "scale(1.05)", whiteSpace: "nowrap",
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
    <div style={{ minHeight: "100dvh", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <p style={{ color: C.muted, fontSize: 16, fontWeight: 600 }}>Loading quiz...</p>
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
  const tc = typeColors[q.type] || { bg: C.accentLight, text: C.accentHover };

  return (
    <div style={{ minHeight: "100dvh", display: "flex", flexDirection: "column", background: C.bg }}>
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
      <div className="safe-top" style={{
        position: "sticky", top: 0, zIndex: 10, background: C.bg,
        padding: "16px 20px 12px",
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <button onClick={handleHomeClick} style={{
            background: "none", border: "none", color: C.muted, fontSize: 14, fontWeight: 700,
            cursor: "pointer", padding: "8px 4px", fontFamily: "'Nunito', sans-serif",
            display: "flex", alignItems: "center", gap: 6, minHeight: 44,
          }}
          onMouseEnter={(e) => (e.currentTarget.style.color = C.accent)}
          onMouseLeave={(e) => (e.currentTarget.style.color = C.muted)}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" />
            </svg>
            Home
          </button>
          <span style={{
            fontSize: 11, fontWeight: 700, padding: "4px 10px",
            borderRadius: 8, background: tc.bg, color: tc.text,
          }}>{typeLabels[q.type] || q.type}</span>
        </div>

        {/* Progress counter */}
        <div style={{ fontSize: 14, fontWeight: 700, color: C.accent, marginBottom: 8 }}>
          {idx + 1} of {total}
        </div>

        {/* Segmented progress bar */}
        <div style={{ display: "flex", gap: 3, padding: 3, background: "#D4F0EB", borderRadius: 10, height: 12 }}>
          {data.questions.map((_, i) => {
            let segColor;
            if (i < idx) {
              const a = answers[i];
              segColor = a && a.skipped ? C.error : C.success;
            } else if (i === idx) {
              segColor = "rgba(0, 180, 160, 0.4)";
            } else {
              segColor = "#E0F5F1";
            }
            return <div key={i} style={{ flex: 1, borderRadius: 6, background: segColor, transition: "background 0.3s ease-out" }} />;
          })}
        </div>
      </div>

      {/* Question area */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", padding: "0 16px" }}>
        <div style={{ maxWidth: 580, width: "100%" }}>
          <div key={key} className={slideDir === "right" ? "slide-in-right" : "slide-in-left"} style={{
            background: C.card, borderRadius: 16, padding: "24px 20px",
            boxShadow: "0 1px 4px rgba(0,60,50,0.06)",
          }}>
            <h2 style={{ fontSize: 18, fontWeight: 800, lineHeight: 1.4, marginBottom: 20, color: C.text }}>
              {q.prompt.includes("___") && q.type === "fill_blank" ? "" : q.prompt}
            </h2>
            {QComponent && <QComponent q={q} value={ans} onChange={setAnswer} onSubmit={canProceed() ? next : undefined} />}
          </div>

          {data.meta?.title && (
            <p style={{ textAlign: "center", color: C.muted, fontSize: 12, fontWeight: 600, marginTop: 20, opacity: 0.6 }}>
              {data.meta.title}
            </p>
          )}
        </div>
      </div>

      {/* Sticky footer — Back + Skip + Next */}
      <div style={{
        position: "sticky", bottom: 0, background: C.bg, padding: "12px 16px 16px",
        borderTop: `1px solid ${C.border}`,
        paddingBottom: "max(16px, env(safe-area-inset-bottom, 16px))",
      }}>
        <div style={{ maxWidth: 580, margin: "0 auto", display: "flex", alignItems: "center", gap: 10 }}>
          {/* Back */}
          <button onClick={prev} disabled={idx === 0}
            style={{
              background: "transparent", border: `2px solid ${C.border}`, borderRadius: 14,
              padding: "14px 16px", color: idx === 0 ? C.border : C.muted, fontSize: 14, fontWeight: 700,
              cursor: idx === 0 ? "not-allowed" : "pointer", fontFamily: "'Nunito', sans-serif", minHeight: 52,
              display: "flex", alignItems: "center", gap: 4, opacity: idx === 0 ? 0.5 : 1,
              transition: "all 0.15s",
            }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
            Back
          </button>

          {/* Skip */}
          <button onClick={skip}
            style={{
              background: "transparent", border: `2px solid ${C.border}`, borderRadius: 14,
              padding: "14px 16px", color: C.muted, fontSize: 14, fontWeight: 700,
              cursor: "pointer", fontFamily: "'Nunito', sans-serif", minHeight: 52,
              display: "flex", alignItems: "center", gap: 4, transition: "all 0.15s",
            }}>
            Skip
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="13 17 18 12 13 7" /><line x1="6" y1="12" x2="18" y2="12" />
            </svg>
          </button>

          {/* Next / Finish */}
          <button onClick={next} disabled={!canProceed()}
            style={{
              flex: 1, background: canProceed() ? C.accent : "transparent",
              color: canProceed() ? "white" : C.border,
              border: canProceed() ? "none" : `2px solid ${C.border}`,
              padding: "14px 24px", borderRadius: 14, fontWeight: 800,
              fontSize: 15, cursor: canProceed() ? "pointer" : "not-allowed",
              transition: "all 0.15s", fontFamily: "'Nunito', sans-serif",
              minHeight: 52,
            }}
            onMouseEnter={(e) => canProceed() && (e.target.style.filter = "brightness(1.05)")}
            onMouseLeave={(e) => canProceed() && (e.target.style.filter = "none")}>
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
  const [overallStats, setOverallStats] = useState(null);

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
  const hasOverrides = Object.keys(overrides).length > 0;
  const showConfetti = pct >= 80;

  const { msg: resultMsg, sub: resultSub } = getResultMsg(pct);
  const scoreColor = pct >= 70 ? C.success : pct >= 50 ? C.accent : C.error;

  // Fetch overall stats for progress section
  useEffect(() => {
    if (!session?.user?.id) return;
    supabase.from("quiz_results").select("percentage").eq("user_id", session.user.id)
      .then(({ data }) => {
        if (data && data.length > 0) {
          const avg = Math.round(data.reduce((s, r) => s + r.percentage, 0) / data.length);
          setOverallStats({ count: data.length, avg });
        }
      });
  }, [session?.user?.id]);

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
    if (!a || a.skipped) return <em style={{ color: C.error, fontWeight: 700 }}>Skipped</em>;
    switch (q.type) {
      case "fill_blank":
        return (a.blanks || []).map((b, i) => (
          <span key={i} style={{
            display: "inline-block", padding: "3px 10px", borderRadius: 8, marginRight: 6, marginBottom: 4, fontSize: 14,
            background: results[qIdx]?.blanksCorrect?.[i] ? C.successLight : C.errorLight,
            color: results[qIdx]?.blanksCorrect?.[i] ? C.success : C.error, fontWeight: 700,
          }}>{b || "(empty)"}</span>
        ));
      case "multiple_choice":
        return <span style={{ fontWeight: 600 }}>{q.options[a.selected] || "(none)"}</span>;
      case "translate":
        return <span style={{ fontWeight: 600 }}>{a.text || "(empty)"}</span>;
      case "classify":
        return Object.entries(a.placements || {}).map(([cat, items]) => (
          items.length > 0 && <div key={cat} style={{ marginBottom: 4 }}>
            <span style={{ fontSize: 12, color: C.muted, fontWeight: 700 }}>{cat}: </span>
            <span style={{ fontSize: 14, fontWeight: 600 }}>{items.join(", ")}</span>
          </div>
        ));
      default: return null;
    }
  };

  const renderCorrectAnswer = (q) => {
    switch (q.type) {
      case "fill_blank":
        return (q.blanks || []).map((b, i) => (
          <span key={i} style={{ display: "inline-block", padding: "3px 10px", borderRadius: 8, marginRight: 6, background: C.successLight, color: C.success, fontWeight: 700, fontSize: 14 }}>{b}</span>
        ));
      case "multiple_choice":
        return <span style={{ fontWeight: 600 }}>{q.options[q.answer]}</span>;
      case "translate":
        return <span style={{ fontWeight: 600 }}>{(q.accept || []).join(" / ")}</span>;
      case "classify":
        return Object.entries(q.categories).map(([cat, items]) => (
          <div key={cat} style={{ marginBottom: 4 }}>
            <span style={{ fontSize: 12, color: C.muted, fontWeight: 700 }}>{cat}: </span>
            <span style={{ fontSize: 14, fontWeight: 600 }}>{items.join(", ")}</span>
          </div>
        ));
      default: return null;
    }
  };

  const incorrectCount = effectiveResults.filter((r) => !r.correct).length;
  const correctCount = effectiveResults.filter((r) => r.correct).length;

  return (
    <>
      {/* Fixed header — must be outside fade-in to avoid transform breaking position:fixed */}
      <div className="safe-top" style={{
        position: "fixed", top: 0, left: 0, right: 0, zIndex: 20, background: C.bg,
        padding: "0 20px", borderBottom: `1px solid ${C.border}`,
      }}>
        <div style={{ maxWidth: 520, margin: "0 auto" }}>
          <button onClick={() => navigate("/")} style={{
            background: "none", border: "none", color: C.muted, fontSize: 14, fontWeight: 700,
            cursor: "pointer", padding: "12px 4px", fontFamily: "'Nunito', sans-serif",
            display: "flex", alignItems: "center", gap: 4, minHeight: 44,
          }}
          onMouseEnter={(e) => (e.currentTarget.style.color = C.accent)}
          onMouseLeave={(e) => (e.currentTarget.style.color = C.muted)}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
            Home
          </button>
        </div>
      </div>

    <div className="fade-in" style={{ minHeight: "100vh", background: C.bg }}>
      {showConfetti && <Confetti />}

      <div style={{ maxWidth: 520, margin: "0 auto", padding: "0 20px 32px", paddingTop: "calc(45px + max(16px, env(safe-area-inset-top, 16px)))" }}>
        {/* Spacer handled by paddingTop above */}

        {/* Score card */}
        <div style={{
          background: C.card, borderRadius: 16, padding: "32px 24px 24px", textAlign: "center",
          boxShadow: "0 1px 4px rgba(0,60,50,0.06)",
          marginBottom: 20,
        }}>
          {/* Score ring — CSS conic gradient donut */}
          <div style={{
            width: 120, height: 120, borderRadius: "50%",
            background: `conic-gradient(${scoreColor} 0% ${pct}%, ${C.border} ${pct}% 100%)`,
            display: "flex", alignItems: "center", justifyContent: "center",
            margin: "0 auto 16px",
          }}>
            <div style={{
              width: 90, height: 90, borderRadius: "50%", background: C.card,
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <div className="score-anim" style={{ fontSize: 28, fontWeight: 900, color: scoreColor }}>
                {pct}%
              </div>
            </div>
          </div>

          {/* Message */}
          <h1 style={{ fontSize: 22, fontWeight: 900, color: C.text, lineHeight: 1.3, marginBottom: 4 }}>
            {resultMsg}
          </h1>
          <p style={{ color: C.muted, fontSize: 14, fontWeight: 600, marginBottom: 4 }}>
            {correct} of {total} correct{hasOverrides ? " (inc. overrides)" : ""}
          </p>
          <p style={{ color: C.muted, fontSize: 13, fontWeight: 600, marginBottom: 16, opacity: 0.7 }}>
            {resultSub}
          </p>

          {/* Type breakdown — with type-specific colors */}
          <div style={{ display: "flex", justifyContent: "center", gap: 8, flexWrap: "wrap", marginBottom: 20 }}>
            {Object.entries(
              questions.reduce((acc, q, i) => {
                const t = q.type;
                if (!acc[t]) acc[t] = { correct: 0, total: 0 };
                acc[t].total++;
                if (effectiveResults[i].correct) acc[t].correct++;
                return acc;
              }, {})
            ).map(([type, s]) => {
              const tc = typeColors[type] || { bg: C.accentLight, text: C.accentHover };
              return (
                <span key={type} style={{
                  padding: "4px 12px", borderRadius: 20, fontSize: 11, fontWeight: 800,
                  background: s.correct === s.total ? C.successLight : tc.bg,
                  color: s.correct === s.total ? C.success : tc.text,
                }}>{typeShortLabels[type] || type} {s.correct}/{s.total}</span>
              );
            })}
          </div>

          {/* Action Buttons */}
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {!isCloudView && (
              <button onClick={() => navigate(`/quiz/${quizId}?q=1`)} style={{
                width: "100%", background: "transparent", color: C.text,
                border: `2.5px solid ${C.accent}`, padding: "14px 16px", borderRadius: 14,
                fontWeight: 800, fontSize: 15, cursor: "pointer", fontFamily: "'Nunito', sans-serif", minHeight: 48,
                transition: "all 0.15s",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = C.accent; e.currentTarget.style.color = "#fff"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = C.text; }}>
                Try again
              </button>
            )}
            <button onClick={() => reviewRef.current?.scrollIntoView({ behavior: "smooth" })} style={{
              width: "100%", background: "transparent", color: C.text,
              border: `2.5px solid ${C.border}`, padding: "14px 16px", borderRadius: 14,
              fontWeight: 800, fontSize: 15, cursor: "pointer", fontFamily: "'Nunito', sans-serif", minHeight: 48,
            }}>
              Review answers
            </button>
          </div>
        </div>

        {/* Your Progress */}
        {overallStats && (
          <div style={{
            borderTop: `1px solid ${C.border}`, paddingTop: 20, marginBottom: 24, textAlign: "center",
          }}>
            <p style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1, color: C.muted, marginBottom: 16 }}>
              Your Progress
            </p>
            <div style={{ display: "flex", justifyContent: "center", gap: 32 }}>
              <div>
                <div style={{ fontSize: 22, fontWeight: 900, color: C.accentHover }}>{overallStats.count}</div>
                <div style={{ fontSize: 12, fontWeight: 600, color: C.muted }}>quizzes</div>
              </div>
              <div>
                <div style={{ fontSize: 22, fontWeight: 900, color: C.accentHover }}>{overallStats.avg}%</div>
                <div style={{ fontSize: 12, fontWeight: 600, color: C.muted }}>average</div>
              </div>
              <div>
                <div style={{ fontSize: 22, fontWeight: 900, color: scoreColor }}>{pct}%</div>
                <div style={{ fontSize: 12, fontWeight: 600, color: C.muted }}>this quiz</div>
              </div>
            </div>
          </div>
        )}

        {/* Review Section */}
        <div ref={reviewRef}>
          {/* Sticky review header */}
          <div style={{
            position: "sticky", top: "calc(45px + max(16px, env(safe-area-inset-top, 16px)))", zIndex: 10, background: C.bg,
            padding: "0 0 12px",
          }}>
            <div style={{ marginBottom: 12 }}>
              <h2 style={{ fontSize: 22, fontWeight: 900, color: C.text, marginBottom: 4 }}>Detailed review</h2>
              <span style={{ color: C.muted, fontSize: 14, fontWeight: 600 }}>{correct}/{total} correct</span>
            </div>
            {/* Filter */}
            <div style={{ display: "flex", gap: 8 }}>
              {[
                { key: "all", label: "All" },
                { key: "incorrect", label: `Incorrect (${incorrectCount})` },
                { key: "correct", label: `Correct (${correctCount})` },
              ].map((f) => (
                <button key={f.key} onClick={() => setReviewFilter(f.key)} style={{
                  padding: "6px 14px", borderRadius: 20, border: "none", fontSize: 12, fontWeight: 800,
                  cursor: "pointer", fontFamily: "'Nunito', sans-serif", transition: "all 0.15s",
                  background: reviewFilter === f.key ? (f.key === "incorrect" ? C.error : f.key === "correct" ? C.success : C.accent) : C.accentLight,
                  color: reviewFilter === f.key ? "white" : (f.key === "incorrect" ? C.error : f.key === "correct" ? C.success : C.accentHover),
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
                background: r.correct ? C.successLight : C.errorLight,
                borderRadius: 14, padding: "14px 16px", marginBottom: 10,
                borderLeft: `4px solid ${r.correct ? C.success : C.error}`,
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
                  <span style={{ fontSize: 14, fontWeight: 800, color: C.text }}>Q{i + 1} &middot; {typeLabels[q.type]}</span>
                  <span style={{ fontSize: 12, fontWeight: 800, color: r.correct ? C.success : C.error }}>
                    {wasOverridden ? "Overridden" : r.correct ? "Correct" : "Incorrect"}
                  </span>
                </div>
                <p style={{ fontSize: 15, fontWeight: 600, lineHeight: 1.5, marginBottom: 12, color: C.text }}>
                  {q.prompt.replace(/___+/g, "______")}
                </p>

                {/* User answer (for wrong answers) */}
                {!isCloudView && wasOriginallyWrong && (
                  <div style={{
                    marginBottom: 8, padding: "8px 12px", borderRadius: 10,
                    background: wasOverridden ? C.successLight : C.errorLight,
                    border: `1px solid ${wasOverridden ? C.success : C.error}20`,
                  }}>
                    <p style={{ fontSize: 12, fontWeight: 700, color: wasOverridden ? C.success : C.error, marginBottom: 4 }}>Your answer:</p>
                    <div style={{ color: wasOverridden ? C.success : C.error, fontWeight: 600 }}>{renderUserAnswer(q, answers[i], i)}</div>
                  </div>
                )}

                {/* Correct answer */}
                <div style={{
                  padding: "8px 12px", borderRadius: 10,
                  background: C.successLight, border: `1px solid ${C.success}20`,
                }}>
                  <p style={{ fontSize: 12, fontWeight: 700, color: C.success, marginBottom: 4 }}>Correct answer:</p>
                  <div style={{ color: C.success, fontWeight: 600 }}>{renderCorrectAnswer(q)}</div>
                </div>

                {/* Tip box */}
                {q.explanation && (
                  <div style={{
                    marginTop: 8, padding: "10px 12px", borderRadius: 10,
                    background: "#F0FAF8", fontSize: 12, fontWeight: 600,
                    color: C.muted, lineHeight: 1.5,
                  }}>
                    💡 {q.explanation}
                  </div>
                )}

                {showOverrideButtons && wasOriginallyWrong && !wasOverridden && q.type !== "multiple_choice" && (
                  <button onClick={() => handleOverride(i)} style={{
                    marginTop: 10, background: C.successLight, border: `2px solid ${C.success}`,
                    borderRadius: 10, padding: "8px 16px", fontSize: 13, fontWeight: 700,
                    color: C.success, cursor: "pointer", fontFamily: "'Nunito', sans-serif",
                    transition: "all 0.15s", minHeight: 40,
                  }}
                  onMouseEnter={(e) => { e.target.style.background = C.success; e.target.style.color = "white"; }}
                  onMouseLeave={(e) => { e.target.style.background = C.successLight; e.target.style.color = C.success; }}>
                    ✓ My answer was correct
                  </button>
                )}
                {showOverrideButtons && wasOverridden && (
                  <button onClick={() => handleOverride(i, false)} style={{
                    marginTop: 10, background: "transparent", border: `2px solid ${C.border}`,
                    borderRadius: 10, padding: "8px 16px", fontSize: 13, fontWeight: 600,
                    color: C.muted, cursor: "pointer", fontFamily: "'Nunito', sans-serif", minHeight: 40,
                  }}>Undo override</button>
                )}
              </div>
            );
          })}
          {filteredIndices.length === 0 && (
            <p style={{ textAlign: "center", color: C.muted, fontSize: 15, fontWeight: 600, padding: "32px 0" }}>
              No {reviewFilter} questions to show.
            </p>
          )}
        </div>
      </div>
    </div>
    </>
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
          <p style={{ color: C.muted, fontSize: 16, fontWeight: 600, fontFamily: "'Nunito', sans-serif" }}>Loading...</p>
        </div>
      </div>
    );
  }

  if (!session) return <LoginScreen />;

  return (
    <>
      {pendingCount > 0 && (
        <div className="safe-top-fixed" style={{
          position: "fixed", top: 12, left: 12, zIndex: 9999,
          display: "flex", alignItems: "center", gap: 6,
          background: "#FFFBEB", border: "1px solid #F59E0B",
          borderRadius: 8, padding: "5px 12px", fontSize: 12,
          fontWeight: 700, color: "#92400E", fontFamily: "'Nunito', sans-serif",
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
