import { useState, useEffect, useRef, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { C } from "../styles/theme";
import {
  fetchWeeks, createWeek, deleteWeek as apiDeleteWeek,
  createLesson, deleteLesson as apiDeleteLesson,
  fetchQuizzes, uploadLessonPdf,
} from "../lib/api";
import WeekCard from "../components/lessons/WeekCard";
import AddWeekModal from "../components/lessons/AddWeekModal";
import AddLessonModal from "../components/lessons/AddLessonModal";
import AddQuizModal from "../components/quizzes/AddQuizModal";
import ConfirmModal from "../components/ConfirmModal";
import MobileNavBar from "../components/MobileNavBar";

export default function LessonsScreen({ session }) {
  const navigate = useNavigate();
  const [weeks, setWeeks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expandedWeeks, setExpandedWeeks] = useState(new Set());
  const [refreshKeys, setRefreshKeys] = useState({});
  const [showAddWeek, setShowAddWeek] = useState(false);
  const [addLessonWeek, setAddLessonWeek] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [quizCounts, setQuizCounts] = useState({ perLesson: {}, weekTotal: {} });
  const [addQuizWeek, setAddQuizWeek] = useState(null);
  const [addQuizLesson, setAddQuizLesson] = useState(null);
  const [activeUnit, setActiveUnit] = useState(0);
  const [fabMenuOpen, setFabMenuOpen] = useState(false);

  const unitRefs = useRef({});
  const uploadRef = useRef(null);
  const uploadTargetRef = useRef(null);
  const preSearchRef = useRef(null);

  useEffect(() => { loadWeeks(); loadQuizCounts(); }, []);

  // Default: expand first unit once weeks load
  useEffect(() => {
    if (weeks.length > 0 && expandedWeeks.size === 0 && !loading) {
      setExpandedWeeks(new Set([weeks[0].id]));
    }
  }, [weeks, loading]);

  // Search: expand all units, restore on clear
  useEffect(() => {
    if (searchQuery.trim()) {
      if (!preSearchRef.current) preSearchRef.current = new Set(expandedWeeks);
      setExpandedWeeks(new Set(weeks.map(w => w.id)));
    } else if (preSearchRef.current) {
      setExpandedWeeks(preSearchRef.current);
      preSearchRef.current = null;
    }
  }, [searchQuery]);

  // Intersection observer: track which unit is in view for pill nav
  useEffect(() => {
    if (!weeks.length) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const idx = weeks.findIndex(w => w.id === entry.target.dataset.weekId);
            if (idx >= 0) setActiveUnit(idx);
          }
        }
      },
      { rootMargin: "-80px 0px -60% 0px" }
    );
    weeks.forEach(w => {
      const el = unitRefs.current[w.id];
      if (el) observer.observe(el);
    });
    return () => observer.disconnect();
  }, [weeks]);

  /* ── data fetching (unchanged) ── */

  const loadWeeks = async () => {
    try { setWeeks(await fetchWeeks()); }
    catch (e) { console.error("Failed to load weeks:", e); }
    finally { setLoading(false); }
  };

  const loadQuizCounts = async () => {
    try {
      const quizzes = await fetchQuizzes();
      const perLesson = {}, weekTotal = {};
      quizzes.forEach(q => {
        if (q.lesson_id) {
          perLesson[q.lesson_id] = (perLesson[q.lesson_id] || 0) + 1;
          const weekId = q.lesson?.week_id;
          if (weekId) weekTotal[weekId] = (weekTotal[weekId] || 0) + 1;
        }
        if (q.week_id) weekTotal[q.week_id] = (weekTotal[q.week_id] || 0) + 1;
      });
      setQuizCounts({ perLesson, weekTotal });
    } catch (e) { console.error("Failed to load quiz counts:", e); }
  };

  const bumpRefreshKey = (weekId) =>
    setRefreshKeys(prev => ({ ...prev, [weekId]: (prev[weekId] || 0) + 1 }));

  const nextWeekNumber = useMemo(() => {
    if (!weeks.length) return 1;
    return Math.max(...weeks.map(w => w.week_number)) + 1;
  }, [weeks]);

  /* ── handlers (unchanged) ── */

  const toggleWeek = (weekId) =>
    setExpandedWeeks(prev => {
      const next = new Set(prev);
      next.has(weekId) ? next.delete(weekId) : next.add(weekId);
      return next;
    });

  const handleCreateWeek = async (weekNumber, title) => {
    await createWeek(weekNumber, title);
    await loadWeeks();
  };

  const handleDeleteWeek = (week) =>
    setDeleteConfirm({
      type: "week", item: week,
      title: "Delete unit?",
      message: `Delete Unit ${week.week_number} and all its lessons? This cannot be undone.`,
    });

  const confirmDelete = async () => {
    if (!deleteConfirm) return;
    try {
      if (deleteConfirm.type === "week") {
        await apiDeleteWeek(deleteConfirm.item.id);
        setExpandedWeeks(prev => { const n = new Set(prev); n.delete(deleteConfirm.item.id); return n; });
        await loadWeeks(); loadQuizCounts();
      } else {
        await apiDeleteLesson(deleteConfirm.item.id);
        if (deleteConfirm.item._weekId) bumpRefreshKey(deleteConfirm.item._weekId);
        await loadWeeks(); loadQuizCounts();
      }
    } catch (e) { console.error("Delete failed:", e); }
    setDeleteConfirm(null);
  };

  const handleDeleteLesson = (lesson, weekId) =>
    setDeleteConfirm({
      type: "lesson",
      item: { ...lesson, _weekId: weekId },
      title: "Delete lesson?",
      message: `Delete "${lesson.title}"? This cannot be undone.`,
    });

  const handleSelectLesson = (lesson) => navigate(`/lesson/${lesson.id}`);

  const handleAddLesson = async (title, markdownContent) => {
    if (!addLessonWeek) return;
    await createLesson(addLessonWeek.id, title, markdownContent);
    bumpRefreshKey(addLessonWeek.id);
    await loadWeeks();
  };

  const handleUploadPdf = (lesson, weekId) => {
    uploadTargetRef.current = { lessonId: lesson.id, weekId };
    uploadRef.current?.click();
  };

  const handleFileSelected = async (e) => {
    const file = e.target.files?.[0];
    const target = uploadTargetRef.current;
    if (!file || !target) return;
    try {
      await uploadLessonPdf(target.lessonId, file, () => {}, () => {});
      bumpRefreshKey(target.weekId);
    } catch (err) { console.error("Upload failed:", err); }
    uploadTargetRef.current = null;
    e.target.value = "";
  };

  const handleQuizAdded = () => loadQuizCounts();

  const scrollToUnit = (index) => {
    setActiveUnit(index);
    const el = unitRefs.current[weeks[index]?.id];
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  /* ── computed ── */

  const totalLessons = weeks.reduce((s, w) => s + (w.lesson_count || 0), 0);
  const totalQuizzes = Object.values(quizCounts.weekTotal).reduce((s, v) => s + v, 0);

  /* ── render ── */

  return (
    <div className="fade-in" style={{ minHeight: "100vh", background: C.bg }}>
      <div className="safe-top desktop-main lessons-page">

        {/* ─── Title ─── */}
        <div style={{ paddingTop: 16, marginBottom: 16 }}>
          <h1 style={{ fontSize: 28, fontWeight: 900, color: C.text, lineHeight: 1.2, fontFamily: "'Nunito', sans-serif" }}>
            Lessons
          </h1>
          <p style={{ color: C.muted, fontSize: 14, fontWeight: 600, marginTop: 4 }}>
            {weeks.length} unit{weeks.length !== 1 ? "s" : ""} · {totalLessons} lesson{totalLessons !== 1 ? "s" : ""}
            {totalQuizzes > 0 && <> · {totalQuizzes} quiz{totalQuizzes !== 1 ? "zes" : ""}</>}
          </p>
        </div>

        {/* ─── Toolbar ─── */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
          {/* Search input */}
          <div style={{
            flex: 1, display: "flex", alignItems: "center", gap: 8,
            background: C.card, border: `1.5px solid ${C.border}`,
            borderRadius: 12, padding: "10px 14px",
          }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={C.muted} strokeWidth="2" strokeLinecap="round">
              <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              type="text" value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search lessons..."
              style={{
                flex: 1, border: "none", outline: "none", background: "transparent",
                fontSize: 14, fontWeight: 600, color: C.text, fontFamily: "'Nunito', sans-serif",
              }}
            />
            {searchQuery && (
              <button onClick={() => setSearchQuery("")} style={{
                background: "none", border: "none", color: C.muted,
                cursor: "pointer", padding: 0, fontSize: 18, lineHeight: 1,
              }}>×</button>
            )}
          </div>

          {/* Batch upload — desktop only, placeholder */}
          <button className="batch-upload-v2" disabled style={{
            display: "none", alignItems: "center", gap: 6,
            padding: "10px 16px", borderRadius: 12,
            border: `1.5px solid ${C.border}`, background: C.card,
            color: C.text, fontWeight: 700, fontSize: 14,
            cursor: "not-allowed", fontFamily: "'Nunito', sans-serif",
            opacity: 0.6, whiteSpace: "nowrap", flexShrink: 0,
          }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            Batch upload
          </button>

          {/* + New unit — desktop only */}
          <button className="toolbar-newunit-v2" onClick={() => setShowAddWeek(true)} style={{
            display: "none", alignItems: "center", gap: 6,
            padding: "10px 18px", borderRadius: 12, border: "none",
            background: C.accent, color: "#fff", fontWeight: 800, fontSize: 14,
            cursor: "pointer", fontFamily: "'Nunito', sans-serif",
            whiteSpace: "nowrap", flexShrink: 0, transition: "filter 0.15s",
          }}
          onMouseEnter={e => (e.currentTarget.style.filter = "brightness(1.08)")}
          onMouseLeave={e => (e.currentTarget.style.filter = "none")}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
              <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            New unit
          </button>
        </div>

        {/* ─── Sticky pill nav ─── */}
        {weeks.length > 0 && (
          <div style={{ position: "sticky", top: 0, zIndex: 10, background: C.bg, padding: "6px 0 10px" }}>
            <div className="unit-pill-nav">
              {weeks.map((w, i) => (
                <button key={w.id} onClick={() => scrollToUnit(i)} style={{
                  padding: "6px 14px", borderRadius: 20,
                  border: `1.5px solid ${activeUnit === i ? C.accent : C.border}`,
                  background: activeUnit === i ? C.accentLight : C.card,
                  color: activeUnit === i ? C.accent : C.muted,
                  fontWeight: activeUnit === i ? 800 : 700,
                  fontSize: 13, cursor: "pointer", fontFamily: "'Nunito', sans-serif",
                  whiteSpace: "nowrap", flexShrink: 0, transition: "all 0.15s",
                }}>
                  Unit {w.week_number}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ─── Unit sections ─── */}
        {loading ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 8 }}>
            {[1, 2, 3].map(i => (
              <div key={i} className="skeleton skeleton-glow" style={{ height: 72, borderRadius: 14 }} />
            ))}
          </div>
        ) : weeks.length === 0 ? (
          <div style={{ textAlign: "center", padding: "48px 20px" }}>
            <p style={{ color: C.text, fontSize: 18, fontWeight: 800, marginBottom: 4 }}>No units yet</p>
            <p style={{ color: C.muted, fontSize: 14, fontWeight: 600, lineHeight: 1.6 }}>
              Create your first unit to start adding lessons!
            </p>
          </div>
        ) : (
          <div style={{ marginTop: 4 }}>
            {weeks.map((week, i) => (
              <div key={week.id}>
                {i > 0 && !searchQuery.trim() && <div className="unit-divider-band" />}
                <div
                  ref={el => { unitRefs.current[week.id] = el; }}
                  data-week-id={week.id}
                  style={{ scrollMarginTop: 48 }}
                >
                  <WeekCard
                    week={week}
                    expanded={expandedWeeks.has(week.id)}
                    refreshKey={refreshKeys[week.id] || 0}
                    searchQuery={searchQuery}
                    onToggle={() => toggleWeek(week.id)}
                    onSelectLesson={handleSelectLesson}
                    onAddLesson={() => {
                      setAddLessonWeek(week);
                      setExpandedWeeks(prev => new Set([...prev, week.id]));
                    }}
                    onDeleteLesson={l => handleDeleteLesson(l, week.id)}
                    onDeleteWeek={handleDeleteWeek}
                    onUploadPdf={l => handleUploadPdf(l, week.id)}
                    onAddQuizLesson={l => setAddQuizLesson(l)}
                    quizCounts={quizCounts}
                    onAddUnitQuiz={() => setAddQuizWeek(week)}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Hidden PDF upload input */}
      <input ref={uploadRef} type="file" accept=".pdf" style={{ display: "none" }} onChange={handleFileSelected} />

      {/* ─── Mobile FAB ─── */}
      <div className="fab-new-week" style={{ position: "fixed", bottom: 80, right: 24, zIndex: 15 }}>
        {fabMenuOpen && (
          <>
            <div style={{ position: "fixed", inset: 0, zIndex: -1 }} onClick={() => setFabMenuOpen(false)} />
            <div style={{
              position: "absolute", bottom: 64, right: 0,
              background: C.card, borderRadius: 14, padding: 6,
              boxShadow: "0 4px 20px rgba(0,60,50,0.15)",
              border: `1px solid ${C.border}`, minWidth: 160,
              animation: "slideUp 0.15s ease-out",
            }}>
              <button onClick={() => { setFabMenuOpen(false); setShowAddWeek(true); }} style={{
                display: "flex", alignItems: "center", gap: 10, width: "100%",
                padding: "10px 14px", border: "none", background: "transparent",
                color: C.text, fontWeight: 700, fontSize: 14, cursor: "pointer",
                fontFamily: "'Nunito', sans-serif", borderRadius: 10, textAlign: "left",
              }}
              onMouseEnter={e => (e.currentTarget.style.background = C.accentLight)}
              onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
                New unit
              </button>
              <button onClick={() => {
                setFabMenuOpen(false);
                if (weeks.length) {
                  const expandedId = [...expandedWeeks][0] || weeks[0].id;
                  setAddLessonWeek(weeks.find(w => w.id === expandedId) || weeks[0]);
                }
              }} style={{
                display: "flex", alignItems: "center", gap: 10, width: "100%",
                padding: "10px 14px", border: "none", background: "transparent",
                color: C.text, fontWeight: 700, fontSize: 14, cursor: "pointer",
                fontFamily: "'Nunito', sans-serif", borderRadius: 10, textAlign: "left",
              }}
              onMouseEnter={e => (e.currentTarget.style.background = C.accentLight)}
              onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
                New lesson
              </button>
            </div>
          </>
        )}
        <button onClick={() => setFabMenuOpen(f => !f)} style={{
          width: 56, height: 56, borderRadius: "50%", border: "none",
          background: C.accent, color: "#fff", fontSize: 28, fontWeight: 300,
          cursor: "pointer", boxShadow: "0 4px 16px rgba(0,180,160,0.3)",
          display: "flex", alignItems: "center", justifyContent: "center",
          transition: "transform 0.2s", transform: fabMenuOpen ? "rotate(45deg)" : "none",
        }}>+</button>
      </div>

      <MobileNavBar active="lessons" />

      {/* ─── Modals ─── */}
      <AddWeekModal
        open={showAddWeek}
        onClose={() => setShowAddWeek(false)}
        onCreate={handleCreateWeek}
        nextWeekNumber={nextWeekNumber}
      />

      <AddLessonModal
        open={addLessonWeek !== null}
        onClose={() => setAddLessonWeek(null)}
        onCreate={handleAddLesson}
        weekLabel={addLessonWeek ? `Unit ${addLessonWeek.week_number} · ${addLessonWeek.title || `Unit ${addLessonWeek.week_number}`}` : ""}
      />

      {addQuizWeek && (
        <AddQuizModal
          open onClose={() => setAddQuizWeek(null)} onSuccess={handleQuizAdded}
          context={{ type: "week", weekId: addQuizWeek.id, weekTitle: `Unit ${addQuizWeek.week_number}: ${addQuizWeek.title || `Unit ${addQuizWeek.week_number}`}` }}
        />
      )}

      {addQuizLesson && (
        <AddQuizModal
          open onClose={() => setAddQuizLesson(null)} onSuccess={handleQuizAdded}
          context={{ type: "lesson", lessonId: addQuizLesson.id, lessonTitle: addQuizLesson.title }}
        />
      )}

      <ConfirmModal
        open={deleteConfirm !== null}
        title={deleteConfirm?.title || ""} message={deleteConfirm?.message || ""}
        confirmLabel="Delete" cancelLabel="Cancel" destructive
        onConfirm={confirmDelete} onCancel={() => setDeleteConfirm(null)}
      />
    </div>
  );
}
