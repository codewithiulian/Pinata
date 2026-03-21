import { useState, useRef, useEffect } from "react";
import { useParams, useLocation, useNavigate, Navigate } from "react-router-dom";
import { C } from "../styles/theme";
import { supabase } from "../lib/supabase.js";
import { typeLabels, typeShortLabels, typeColors, getResultMsg } from "../utils/helpers";
import Confetti from "../components/Confetti";

export default function ResultsRoute({ session }) {
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

  // Teacher overrides — write using quiz_id (with quiz_title fallback)
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
        if (session?.user?.id) {
          // Update quiz_progress overrides — try by quiz_id first, then quiz_title
          const effectiveQuizId = quizId || attempt?.quizId;
          if (effectiveQuizId) {
            await supabase.from("quiz_progress").update({ overrides })
              .eq("user_id", session.user.id).eq("quiz_id", effectiveQuizId);
          } else if (attempt?.meta?.title) {
            await supabase.from("quiz_progress").update({ overrides })
              .eq("user_id", session.user.id).eq("quiz_title", attempt.meta.title);
          }
        }
      } catch (err) { console.warn("Supabase override update failed:", err); }
    }, 800);
    return () => clearTimeout(overrideTimerRef.current);
  }, [overrides, results, total, session?.user?.id, quizId, attempt?.quizId, attempt?.meta?.title]);

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
      <div className="safe-top desktop-header-fixed" style={{
        position: "fixed", top: 0, left: 0, right: 0, zIndex: 20, background: C.bg,
        padding: "0 20px", borderBottom: `1px solid ${C.border}`,
      }}>
        <div className="app-header-inner">
          {/* Mobile: back arrow + Home */}
          <button className="quiz-home-btn" onClick={() => navigate("/")} style={{
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

          {/* Desktop: back arrow + quiz title */}
          <div className="quiz-desktop-header" style={{ display: "none", alignItems: "center", gap: 12, padding: "8px 0" }}>
            <button onClick={() => navigate("/")} style={{
              background: "none", border: `1.5px solid ${C.border}`, borderRadius: 10,
              color: C.muted, cursor: "pointer", padding: "6px 8px",
              display: "flex", alignItems: "center", justifyContent: "center",
              transition: "all 0.15s",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.color = C.accent; e.currentTarget.style.borderColor = C.accent; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = C.muted; e.currentTarget.style.borderColor = C.border; }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </button>
            <span style={{ fontSize: 15, fontWeight: 800, color: C.text }}>
              {attempt?.meta?.title || cloudRecord?.lesson_title || "Results"}
            </span>
          </div>
        </div>
      </div>

    <div className="fade-in desktop-main" style={{ minHeight: "100vh", background: C.bg }}>
      {showConfetti && <Confetti />}

      <div className="app-container" style={{ padding: "0 20px 32px", paddingTop: "calc(45px + max(16px, env(safe-area-inset-top, 16px)))" }}>
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
