import { useState, useRef, useEffect, useMemo } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { C } from "../styles/theme";
import { supabase } from "../lib/supabase.js";
import { relativeTime, computeStreak } from "../utils/helpers";
import SkeletonCard from "../components/SkeletonCard";
import MiniScoreCircle from "../components/MiniScoreCircle";
import AddQuizSheet from "../components/AddQuizSheet";
import ConfirmModal from "../components/ConfirmModal";

export default function HomeScreen({ onLoad, quizzes, loading, onDeleteQuiz, onSelectQuiz, session }) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState(searchParams.get("tab") === "history" ? "history" : "quizzes");
  const [showAddQuiz, setShowAddQuiz] = useState(false);
  const [stats, setStats] = useState(null);
  const [cloudHistory, setCloudHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [quizProgress, setQuizProgress] = useState({});
  const [lastScores, setLastScores] = useState({});
  const [pullDistance, setPullDistance] = useState(0);
  const [deleteConfirmId, setDeleteConfirmId] = useState(null);
  const [headerH, setHeaderH] = useState(0);
  // Sync activeTab from URL search params (desktop sidebar navigation)
  useEffect(() => {
    const tab = searchParams.get("tab");
    setActiveTab(tab === "history" ? "history" : "quizzes");
  }, [searchParams]);

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
          // Build last-score map keyed by quiz_id, with lesson_title fallback
          const scoreMap = {};
          data.forEach((r) => {
            if (r.quiz_id && !scoreMap[r.quiz_id]) scoreMap[r.quiz_id] = r.percentage;
            if (r.lesson_title && !scoreMap[`title:${r.lesson_title}`]) scoreMap[`title:${r.lesson_title}`] = r.percentage;
          });
          setLastScores(scoreMap);
        }
        setHistoryLoading(false);
      });
    // Fetch in-progress quizzes — use quiz_id where available
    supabase.from("quiz_progress").select("quiz_id,quiz_title,current_index,answers")
      .eq("user_id", session.user.id).eq("status", "in_progress")
      .then(({ data }) => {
        if (data) {
          const map = {};
          data.forEach((p) => {
            // Key by quiz_id if available, also by quiz_title for backward compat
            if (p.quiz_id) map[p.quiz_id] = { current: (p.current_index ?? 0) + 1, answers: p.answers || {} };
            if (p.quiz_title) map[`title:${p.quiz_title}`] = { current: (p.current_index ?? 0) + 1, answers: p.answers || {} };
          });
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

  // Count in-progress (deduplicate: only count unique quiz_id entries, not title duplicates)
  const inProgressCount = Object.keys(quizProgress).filter((k) => !k.startsWith("title:")).length
    || Object.keys(quizProgress).filter((k) => k.startsWith("title:")).length;

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
      <div ref={headerRef} className="safe-top desktop-main desktop-header-fixed" style={{ position: "fixed", top: 0, left: 0, right: 0, zIndex: 20, background: C.bg, padding: "16px 20px 0" }}>
       <div className="app-header-inner">
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
              {/* Stat pill: in progress (desktop only, shown inline with other pills) */}
              {inProgressCount > 0 && (
                <span className="desktop-in-progress-pill" style={{
                  padding: "5px 12px", borderRadius: 20, fontSize: 11, fontWeight: 800,
                  background: "#fff", color: C.text, border: `1px solid ${C.border}`,
                  display: "none",
                }}>{inProgressCount} in progress</span>
              )}
            </>
          )}
        </div>

        {/* Tab bar — pill style */}
        <div className="mobile-tab-bar" style={{ display: "flex", borderRadius: 12, background: C.accentLight, padding: 4, marginBottom: 16 }}>
          {[
            { label: "Quizzes", id: "quizzes", local: true },
            { label: "Lessons", id: "lessons", to: "/lessons" },
            { label: "History", id: "history", local: true },
            { label: "Hablar", id: "hablar", to: "/dialog" },
          ].map((tab) => (
            <button key={tab.id} onClick={() => {
              if (tab.to) navigate(tab.to);
              else setActiveTab(tab.id);
            }} style={{
              flex: 1, padding: "8px 0",
              background: !tab.to && activeTab === tab.id ? C.card : "transparent",
              border: "none", borderRadius: 10,
              color: !tab.to && activeTab === tab.id ? C.accentHover : C.muted,
              fontWeight: 700, fontSize: 13, cursor: "pointer",
              fontFamily: "'Nunito', sans-serif", transition: "all 0.15s",
              boxShadow: !tab.to && activeTab === tab.id ? "0 1px 3px rgba(0,60,50,0.08)" : "none",
            }}>{tab.label}</button>
          ))}
        </div>
       </div>
      </div>

      {/* Spacer for fixed header */}
      <div style={{ height: headerH }} />

      {/* Tab content */}
      <div className="app-container desktop-main" style={{ padding: "0 16px 32px" }}>
        {activeTab === "quizzes" ? (
          <div key="quizzes" className="fade-in">
            {loading ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <SkeletonCard variant="progress" />
                <SkeletonCard variant="progress" />
                <SkeletonCard />
              </div>
            ) : quizzes.length === 0 ? (
              <div style={{ textAlign: "center", padding: "48px 20px" }}>
                <div style={{ fontSize: 48, marginBottom: 12, opacity: 0.8 }}>📚</div>
                <p style={{ color: C.text, fontSize: 18, fontWeight: 800, marginBottom: 4 }}>No quizzes yet</p>
                <p style={{ color: C.muted, fontSize: 14, fontWeight: 600, lineHeight: 1.6 }}>Upload your first quiz to get started!</p>
              </div>
            ) : (
              <div className="quiz-grid">
                {quizzes.map((q) => {
                  const title = q.data.meta?.title || "Quiz";
                  const unit = q.data.meta?.unit;
                  const lesson = q.data.meta?.lesson;
                  const qCount = q.data.questions?.length || 0;
                  // Look up last score by quiz_id first, then by title
                  const lastScore = lastScores[q.id] ?? lastScores[`title:${title}`];
                  // Look up progress by quiz_id first, then by title
                  const progress = quizProgress[q.id] || quizProgress[`title:${title}`];

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
                {/* Add quiz card — desktop (inside grid) */}
                <button className="add-quiz-btn-desktop" onClick={() => setShowAddQuiz(true)} style={{
                  borderRadius: 16, border: `2px dashed ${C.border}`, background: "transparent",
                  color: C.muted, fontWeight: 700, fontSize: 14, cursor: "pointer",
                  fontFamily: "'Nunito', sans-serif", transition: "all 0.2s",
                  alignItems: "center", justifyContent: "center", minHeight: 180,
                }}
                onMouseEnter={(e) => { e.currentTarget.style.borderColor = C.accent; e.currentTarget.style.color = C.accent; }}
                onMouseLeave={(e) => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.color = C.muted; }}>
                  + Add quiz
                </button>
              </div>
            )}
            {/* Add quiz button — mobile (below grid) */}
            <button className="add-quiz-btn-mobile" onClick={() => setShowAddQuiz(true)} style={{
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
              <div className="history-list">
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
