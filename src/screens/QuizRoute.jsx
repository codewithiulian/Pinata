import { useState, useRef, useEffect } from "react";
import { useParams, useSearchParams, useNavigate, Navigate } from "react-router-dom";
import { C } from "../styles/theme";
import { supabase } from "../lib/supabase.js";
import { enqueue } from "../lib/syncQueue.js";
import { getQuizBySupabaseId } from "../useQuizHistory.js";
import { grade } from "../utils/grading";
import { typeLabels, typeColors } from "../utils/helpers";
import ConfirmModal from "../components/ConfirmModal";
import FillBlank from "../components/questions/FillBlank";
import MultiChoice from "../components/questions/MultiChoice";
import Translate from "../components/questions/Translate";
import Classify from "../components/questions/Classify";

export default function QuizRoute({ saveAttempt, session }) {
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
    <div className="desktop-main" style={{ minHeight: "100dvh", display: "flex", alignItems: "center", justifyContent: "center" }}>
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
    <div className="desktop-main" style={{ minHeight: "100dvh", display: "flex", flexDirection: "column", background: C.bg }}>
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
        {/* Mobile: hamburger + Home */}
        <div className="quiz-home-btn" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
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

        {/* Desktop: back arrow + quiz title + type badge */}
        <div className="quiz-desktop-header" style={{ display: "none", alignItems: "center", gap: 12, marginBottom: 12 }}>
          <button onClick={handleHomeClick} style={{
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
          <span style={{ fontSize: 15, fontWeight: 800, color: C.text, flex: 1 }}>
            {data.meta?.title || "Quiz"}
          </span>
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
