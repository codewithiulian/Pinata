import { useState, useEffect, useCallback } from "react";
import { saveAttempt as dbSave, getAttempts, deleteAttempt as dbDelete } from "./db.js";
import { supabase } from "./lib/supabase.js";
import { enqueue } from "./lib/syncQueue.js";

const OFFLINE_QUIZZES_KEY = "offline_quizzes";
const CACHED_QUIZZES_KEY = "cached_quizzes";

export function useQuizHistory(session) {
  const [attempts, setAttempts] = useState([]);
  const [quizzes, setQuizzes] = useState([]);
  const [loading, setLoading] = useState(true);

  const userId = session?.user?.id;

  const refresh = useCallback(() => {
    setLoading(true);

    const attemptsP = getAttempts(50);

    const offlineQuizzes = () => {
      try {
        return JSON.parse(localStorage.getItem(OFFLINE_QUIZZES_KEY) || "[]")
          .map((row) => ({ id: row.id, data: row.quiz_data, savedAt: new Date(row.created_at).getTime() }));
      } catch { return []; }
    };

    const quizzesP = userId
      ? supabase
          .from("quizzes")
          .select("*")
          .eq("user_id", userId)
          .order("created_at", { ascending: false })
          .then(({ data, error }) => {
            if (error) {
              console.warn("Failed to fetch quizzes:", error);
              // Offline fallback: return cached cloud quizzes
              try {
                const cached = JSON.parse(localStorage.getItem(CACHED_QUIZZES_KEY) || "[]");
                return [...cached, ...offlineQuizzes()];
              } catch { return offlineQuizzes(); }
            }
            const cloud = (data || []).map((row) => ({
              id: row.id,
              data: row.quiz_data,
              savedAt: new Date(row.created_at).getTime(),
            }));
            // Cache for offline use
            try { localStorage.setItem(CACHED_QUIZZES_KEY, JSON.stringify(cloud)); } catch {}
            return [...cloud, ...offlineQuizzes()];
          })
      : Promise.resolve(offlineQuizzes());

    Promise.all([attemptsP, quizzesP]).then(([a, q]) => {
      setAttempts(a);
      setQuizzes(q);
      setLoading(false);
    });
  }, [userId]);

  useEffect(() => { refresh(); }, [refresh]);

  const saveAttempt = useCallback(async (record) => {
    const id = await dbSave(record);
    if (id != null) {
      setAttempts((prev) => [{ ...record, id }, ...prev]);
    }
  }, []);

  const deleteAttempt = useCallback(async (id) => {
    await dbDelete(id);
    setAttempts((prev) => prev.filter((a) => a.id !== id));
  }, []);

  const saveQuiz = useCallback(async (data) => {
    const title = data.meta?.title || "Untitled Quiz";
    const unit = data.meta?.unit ?? null;
    const lesson = data.meta?.lesson ?? null;
    const questionCount = data.questions?.length ?? 0;

    if (!userId) {
      // Offline: store in localStorage
      const offline = JSON.parse(localStorage.getItem(OFFLINE_QUIZZES_KEY) || "[]");
      const tempId = `offline-${Date.now()}`;
      offline.push({ id: tempId, quiz_data: data, title, unit_number: unit, lesson_number: lesson, question_count: questionCount, created_at: new Date().toISOString() });
      localStorage.setItem(OFFLINE_QUIZZES_KEY, JSON.stringify(offline));
      setQuizzes((prev) => [{ id: tempId, data, savedAt: Date.now() }, ...prev]);
      return tempId;
    }

    // For the new quizzes table, we need a week_id or lesson_id.
    // Try to resolve week_id from unit_number if provided.
    let weekId = null;
    if (unit != null) {
      const { data: weekData } = await supabase
        .from("weeks")
        .select("id")
        .eq("user_id", userId)
        .eq("week_number", unit)
        .single();
      if (weekData) weekId = weekData.id;
    }

    // If we couldn't resolve a week_id, use the first week as fallback
    if (!weekId) {
      const { data: firstWeek } = await supabase
        .from("weeks")
        .select("id")
        .eq("user_id", userId)
        .order("week_number", { ascending: true })
        .limit(1)
        .single();
      if (firstWeek) weekId = firstWeek.id;
    }

    if (!weekId) {
      // No weeks exist — fall back to offline storage
      console.warn("No weeks found for user, storing quiz offline");
      const offline = JSON.parse(localStorage.getItem(OFFLINE_QUIZZES_KEY) || "[]");
      const tempId = `offline-${Date.now()}`;
      offline.push({ id: tempId, quiz_data: data, title, unit_number: unit, lesson_number: lesson, question_count: questionCount, created_at: new Date().toISOString() });
      localStorage.setItem(OFFLINE_QUIZZES_KEY, JSON.stringify(offline));
      setQuizzes((prev) => [{ id: tempId, data, savedAt: Date.now() }, ...prev]);
      return tempId;
    }

    const row = {
      user_id: userId,
      title,
      week_id: weekId,
      question_count: questionCount,
      quiz_data: data,
      source: "upload",
    };

    const { data: inserted, error } = await supabase
      .from("quizzes")
      .insert(row)
      .select("id")
      .single();

    if (error) {
      console.warn("Failed to save quiz to Supabase:", error);
      // Also try saving to saved_quizzes for backward compat
      const legacyRow = {
        user_id: userId, title, unit_number: unit,
        lesson_number: lesson, question_count: questionCount, quiz_data: data,
      };
      enqueue({ table: "saved_quizzes", method: "upsert", payload: legacyRow, matchColumns: ["user_id", "title"] });
      // Fallback: offline storage
      const offline = JSON.parse(localStorage.getItem(OFFLINE_QUIZZES_KEY) || "[]");
      const tempId = `offline-${Date.now()}`;
      offline.push({ id: tempId, quiz_data: data, title, created_at: new Date().toISOString() });
      localStorage.setItem(OFFLINE_QUIZZES_KEY, JSON.stringify(offline));
      setQuizzes((prev) => [{ id: tempId, data, savedAt: Date.now() }, ...prev]);
      return tempId;
    }

    // Also write to saved_quizzes for backward compat during transition
    await supabase
      .from("saved_quizzes")
      .upsert({
        user_id: userId, title, unit_number: unit,
        lesson_number: lesson, question_count: questionCount, quiz_data: data,
      }, { onConflict: "user_id,title" })
      .then(({ error: legacyErr }) => {
        if (legacyErr) console.warn("Legacy saved_quizzes write failed (non-critical):", legacyErr);
      });

    const id = inserted.id;
    setQuizzes((prev) => {
      const filtered = prev.filter((q) => q.id !== id);
      return [{ id, data, savedAt: Date.now() }, ...filtered];
    });
    return id;
  }, [userId]);

  const deleteQuiz = useCallback(async (id) => {
    // Handle offline quizzes
    if (typeof id === "string" && id.startsWith("offline-")) {
      const offline = JSON.parse(localStorage.getItem(OFFLINE_QUIZZES_KEY) || "[]");
      localStorage.setItem(OFFLINE_QUIZZES_KEY, JSON.stringify(offline.filter((q) => q.id !== id)));
    } else {
      // Delete from new quizzes table (CASCADE handles progress/results)
      const { error } = await supabase.from("quizzes").delete().eq("id", id);
      if (error) console.warn("Failed to delete quiz:", error);
      // Also try to clean up from saved_quizzes
      await supabase.from("saved_quizzes").delete().eq("id", id)
        .then(({ error: legacyErr }) => {
          if (legacyErr) console.warn("Legacy saved_quizzes delete failed (non-critical):", legacyErr);
        });
    }
    setQuizzes((prev) => prev.filter((q) => q.id !== id));
  }, []);

  return { attempts, quizzes, loading, saveAttempt, deleteAttempt, saveQuiz, deleteQuiz, refresh };
}

/** Fetch a single quiz by UUID. Falls back to localStorage for offline quizzes. */
export async function getQuizBySupabaseId(id) {
  // Check offline storage first for offline- prefixed IDs
  if (typeof id === "string" && id.startsWith("offline-")) {
    const offline = JSON.parse(localStorage.getItem(OFFLINE_QUIZZES_KEY) || "[]");
    const found = offline.find((q) => q.id === id);
    return found ? { id: found.id, data: found.quiz_data } : null;
  }

  // Fetch from new quizzes table
  const { data, error } = await supabase
    .from("quizzes")
    .select("*")
    .eq("id", id)
    .single();

  if (error || !data) {
    // Fallback: try saved_quizzes (transition period)
    const { data: legacyData, error: legacyErr } = await supabase
      .from("saved_quizzes")
      .select("*")
      .eq("id", id)
      .single();

    if (!legacyErr && legacyData) {
      return { id: legacyData.id, data: legacyData.quiz_data };
    }

    // Fallback: check offline storage and cached cloud quizzes
    const offline = JSON.parse(localStorage.getItem(OFFLINE_QUIZZES_KEY) || "[]");
    const found = offline.find((q) => q.id === id);
    if (found) return { id: found.id, data: found.quiz_data };
    const cached = JSON.parse(localStorage.getItem(CACHED_QUIZZES_KEY) || "[]");
    const cachedFound = cached.find((q) => q.id === id);
    return cachedFound || null;
  }

  return { id: data.id, data: data.quiz_data };
}
