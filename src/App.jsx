import { useState, useEffect } from "react";
import { Routes, Route, useNavigate, Navigate } from "react-router-dom";
import { useQuizHistory } from "./useQuizHistory.js";
import { supabase } from "./lib/supabase.js";
import { flush, usePendingCount } from "./lib/syncQueue.js";
import { prefetchAll } from "./lib/offline-cache.js";
import { fetchWeeks, fetchLessons, fetchQuizzes } from "./lib/api.js";
import { injectStyles, C } from "./styles/theme";
import LoginScreen from "./screens/LoginScreen";
import QuizzesScreen from "./screens/QuizzesScreen";
import HistoryScreen from "./screens/HistoryScreen";
import QuizRoute from "./screens/QuizRoute";
import ResultsRoute from "./screens/ResultsRoute";
import DialogScreen from "./screens/DialogScreen";
import LessonsScreen from "./screens/LessonsScreen";
import LessonRoute from "./screens/LessonRoute";
import CarolinaScreen from "./screens/CarolinaScreen";
import DesktopSidebar from "./components/DesktopSidebar";

export default function App() {
  const [session, setSession] = useState(undefined);
  const history = useQuizHistory(session);
  const pendingCount = usePendingCount();

  useEffect(() => { injectStyles(); }, []);

  useEffect(() => {
    supabase.auth.getSession()
      .then(({ data: { session: s } }) => setSession(s))
      .catch(() => setSession(null));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => subscription.unsubscribe();
  }, []);

  // Sync queue + deferred offline prefetch
  useEffect(() => {
    flush();
    const deferPrefetch = () => setTimeout(() => prefetchAll(fetchWeeks, fetchLessons, fetchQuizzes), 5000);
    if (navigator.onLine) deferPrefetch();
    const handleOnline = () => { flush(); deferPrefetch(); };
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

  return (
    <>
      {pendingCount > 0 && (
        <div className="safe-top-fixed" style={{
          position: "fixed", top: 6, left: "50%", transform: "translateX(-50%)", zIndex: 9999,
          display: "flex", alignItems: "center", gap: 4,
          background: "#FFFBEB", border: "1px solid #F59E0B",
          borderRadius: 6, padding: "2px 8px", fontSize: 10,
          fontWeight: 700, color: "#92400E", fontFamily: "'Nunito', sans-serif",
          boxShadow: "0 1px 4px rgba(0,0,0,0.08)",
        }}>
          <span style={{ width: 5, height: 5, borderRadius: "50%", background: "#F59E0B", display: "inline-block" }} />
          Unsynced ({pendingCount})
        </div>
      )}
      {session && <DesktopSidebar session={session} />}
      <Routes>
        <Route path="/login" element={session ? <Navigate to="/" replace /> : <LoginScreen />} />
        <Route path="/" element={session ? <QuizzesScreen session={session} /> : <Navigate to="/login" replace />} />
        <Route path="/history" element={session ? <HistoryScreen session={session} /> : <Navigate to="/login" replace />} />
        <Route path="/quiz/:quizId" element={session ? <QuizRoute saveAttempt={history.saveAttempt} session={session} /> : <Navigate to="/login" replace />} />
        <Route path="/quiz/:quizId/results" element={session ? <ResultsRoute session={session} /> : <Navigate to="/login" replace />} />
        <Route path="/history/view" element={session ? <ResultsRoute session={session} /> : <Navigate to="/login" replace />} />
        <Route path="/lessons" element={session ? <LessonsScreen session={session} /> : <Navigate to="/login" replace />} />
        <Route path="/lesson/:lessonId" element={session ? <LessonRoute /> : <Navigate to="/login" replace />} />
        <Route path="/dialog" element={session ? <DialogScreen session={session} /> : <Navigate to="/login" replace />} />
        <Route path="/carolina" element={session ? <CarolinaScreen session={session} /> : <Navigate to="/login" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  );
}
