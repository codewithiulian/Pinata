import { useState, useEffect, useCallback } from "react";
import {
  saveAttempt as dbSave, getAttempts, deleteAttempt as dbDelete,
  saveQuiz as dbSaveQuiz, getQuizzes, deleteQuiz as dbDeleteQuiz,
} from "./db.js";

export function useQuizHistory() {
  const [attempts, setAttempts] = useState([]);
  const [quizzes, setQuizzes] = useState([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(() => {
    setLoading(true);
    Promise.all([getAttempts(50), getQuizzes()]).then(([a, q]) => {
      setAttempts(a);
      setQuizzes(q);
      setLoading(false);
    });
  }, []);

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

  const saveQuiz = useCallback(async (quizKey, data) => {
    const id = await dbSaveQuiz(quizKey, data);
    setQuizzes((prev) => {
      const filtered = prev.filter((q) => q.quizKey !== quizKey);
      return [{ id, quizKey, data, savedAt: Date.now() }, ...filtered];
    });
    return id;
  }, []);

  const deleteQuiz = useCallback(async (id) => {
    await dbDeleteQuiz(id);
    setQuizzes((prev) => prev.filter((q) => q.id !== id));
  }, []);

  return { attempts, quizzes, loading, saveAttempt, deleteAttempt, saveQuiz, deleteQuiz, refresh };
}
