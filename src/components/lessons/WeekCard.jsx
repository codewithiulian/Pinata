import { useState, useEffect, useRef, useMemo } from "react";
import { DndContext, closestCenter, PointerSensor, TouchSensor, useSensor, useSensors } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy, arrayMove } from "@dnd-kit/sortable";
import { C } from "../../styles/theme";
import LessonRow from "./LessonRow";
import { fetchLessons, reorderLessons } from "../../lib/api";

export default function WeekCard({
  week, expanded, refreshKey, searchQuery,
  onToggle, onSelectLesson, onAddLesson, onDeleteLesson, onDeleteWeek,
  onUploadPdf, onAddQuizLesson, quizCounts, onAddUnitQuiz,
}) {
  const [lessons, setLessons] = useState(null);
  const [loading, setLoading] = useState(false);
  const [headerHover, setHeaderHover] = useState(false);
  const lastRefreshKey = useRef(0);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } })
  );

  // Lazy-load lessons when expanded
  useEffect(() => {
    if (!expanded) return;
    if (lessons !== null && refreshKey === lastRefreshKey.current) return;
    lastRefreshKey.current = refreshKey;
    setLoading(true);
    fetchLessons(week.id)
      .then(setLessons)
      .catch(() => setLessons([]))
      .finally(() => setLoading(false));
  }, [expanded, week.id, refreshKey]);

  const handleDragEnd = async ({ active, over }) => {
    if (!over || active.id === over.id || !lessons) return;
    const oldI = lessons.findIndex(l => l.id === active.id);
    const newI = lessons.findIndex(l => l.id === over.id);
    const reordered = arrayMove(lessons, oldI, newI);
    const original = [...lessons];
    setLessons(reordered);
    try { await reorderLessons(reordered.map((l, i) => ({ id: l.id, sort_order: i }))); }
    catch { setLessons(original); }
  };

  // Right-click / long-press to delete week
  const longPressRef = useRef(null);
  const handleContextMenu = e => { e.preventDefault(); onDeleteWeek(week); };
  const handleTouchStart = () => { longPressRef.current = setTimeout(() => onDeleteWeek(week), 600); };
  const handleTouchEnd = () => { clearTimeout(longPressRef.current); longPressRef.current = null; };

  // Client-side search filter
  const filteredLessons = useMemo(() => {
    if (!lessons) return null;
    if (!searchQuery?.trim()) return lessons;
    const q = searchQuery.toLowerCase();
    return lessons.filter(l => l.title.toLowerCase().includes(q));
  }, [lessons, searchQuery]);

  // Hide unit when searching and no matches (only after lessons have loaded)
  if (searchQuery?.trim() && filteredLessons && filteredLessons.length === 0) return null;

  const quizTotal = quizCounts?.weekTotal?.[week.id] || 0;

  // TODO: Wire real completion data — a lesson is "completed" when all its quizzes have been attempted
  const completedLessons = 0;
  const progressPct = week.lesson_count > 0 ? (completedLessons / week.lesson_count) * 100 : 0;

  return (
    <div style={{ padding: "4px 0" }}>
      {/* ─── Unit header ─── */}
      <div
        onClick={onToggle}
        onContextMenu={handleContextMenu}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        onTouchMove={handleTouchEnd}
        onMouseEnter={() => setHeaderHover(true)}
        onMouseLeave={() => setHeaderHover(false)}
        style={{
          display: "flex", alignItems: "center", gap: 14, padding: "14px 8px",
          cursor: "pointer", userSelect: "none", borderRadius: 12,
          background: headerHover ? "#F5FCFB" : "transparent",
          transition: "background 0.12s",
        }}
      >
        {/* Number badge */}
        <div style={{
          width: 40, height: 40, borderRadius: 12, display: "flex",
          alignItems: "center", justifyContent: "center",
          fontSize: 16, fontWeight: 800, flexShrink: 0,
          background: C.accentLight, color: C.accent,
        }}>
          {week.week_number}
        </div>

        {/* Title + meta */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 16, fontWeight: 800, color: C.text,
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>
            {week.title || `Week ${week.week_number}`}
          </div>
          <div style={{ fontSize: 13, fontWeight: 600, color: C.muted, marginTop: 2 }}>
            {week.lesson_count} lesson{week.lesson_count !== 1 ? "s" : ""}
            {quizTotal > 0 && <> · {quizTotal} quiz{quizTotal !== 1 ? "zes" : ""}</>}
          </div>
        </div>

        {/* Progress bar + fraction */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
          <div style={{
            width: 80, height: 4, background: "#E2E8F0",
            borderRadius: 2, overflow: "hidden",
          }}>
            <div style={{
              width: `${progressPct}%`, height: "100%",
              background: C.accent, borderRadius: 2, transition: "width 0.3s",
            }} />
          </div>
          <span style={{ fontSize: 13, fontWeight: 700, color: C.muted, whiteSpace: "nowrap", minWidth: 28 }}>
            {completedLessons}/{week.lesson_count}
          </span>
        </div>

        {/* Chevron (down arrow, rotates 180° when expanded) */}
        <svg
          width="18" height="18" viewBox="0 0 24 24" fill="none"
          stroke={C.muted} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
          style={{ flexShrink: 0, transition: "transform 0.2s", transform: expanded ? "rotate(180deg)" : "none" }}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </div>

      {/* ─── Expanded content ─── */}
      {expanded && (
        <div style={{ animation: "fadeIn 0.15s ease-out" }}>
          {(loading || lessons === null) ? (
            <div style={{ padding: "16px 54px", color: C.muted, fontSize: 13, fontWeight: 600 }}>
              Loading lessons...
            </div>
          ) : filteredLessons && filteredLessons.length > 0 ? (
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext items={filteredLessons.map(l => l.id)} strategy={verticalListSortingStrategy}>
                {filteredLessons.map(lesson => (
                  <LessonRow
                    key={lesson.id}
                    lesson={lesson}
                    weekTitle={week.title || `Week ${week.week_number}`}
                    onSelect={onSelectLesson}
                    onDelete={onDeleteLesson}
                    onUpload={onUploadPdf}
                    onAddQuiz={onAddQuizLesson}
                    quizCount={quizCounts?.perLesson?.[lesson.id] || 0}
                  />
                ))}
              </SortableContext>
            </DndContext>
          ) : filteredLessons && filteredLessons.length === 0 && !searchQuery?.trim() ? (
            <div style={{ padding: "16px 54px", color: C.muted, fontSize: 13, fontWeight: 600 }}>
              No lessons yet
            </div>
          ) : null}

          {/* Ghost "Add lesson" row */}
          {!searchQuery?.trim() && (
            <div
              onClick={() => onAddLesson(week)}
              className="add-lesson-ghost"
              style={{
                display: "flex", alignItems: "center", gap: 8,
                cursor: "pointer", color: C.muted, fontSize: 14, fontWeight: 600,
                fontFamily: "'Nunito', sans-serif",
                borderTop: `1px solid ${C.border}`,
                transition: "color 0.15s",
              }}
              onMouseEnter={e => (e.currentTarget.style.color = C.accent)}
              onMouseLeave={e => (e.currentTarget.style.color = C.muted)}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              Add lesson
            </div>
          )}
        </div>
      )}
    </div>
  );
}
