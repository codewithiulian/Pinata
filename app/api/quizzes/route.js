import { createClient } from "@supabase/supabase-js";

function getSupabase(req) {
  const token = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!token) return null;
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    { global: { headers: { Authorization: `Bearer ${token}` } } }
  );
}

export async function GET(req) {
  const supabase = getSupabase(req);
  if (!supabase) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const lessonId = url.searchParams.get("lesson_id");
  const weekId = url.searchParams.get("week_id");

  // Build query: quizzes with parent info + aggregated results + progress
  let query = supabase
    .from("quizzes")
    .select(`
      id, title, description, question_count, source, created_at, updated_at,
      lesson_id, week_id,
      lessons:lesson_id (id, title),
      weeks:week_id (id, title, week_number),
      quiz_progress (status, current_index, answers),
      quiz_results (percentage, created_at)
    `)
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  if (lessonId) query = query.eq("lesson_id", lessonId);
  if (weekId) query = query.eq("week_id", weekId);

  const { data, error } = await query;
  if (error) return Response.json({ error: error.message }, { status: 500 });

  // Transform: compute aggregated stats from quiz_results
  const quizzes = (data || []).map((q) => {
    const results = q.quiz_results || [];
    const progress = q.quiz_progress?.[0] || null;

    const attempt_count = results.length;
    const best_score = results.length > 0 ? Math.max(...results.map((r) => r.percentage)) : null;
    const avg_score = results.length > 0
      ? Math.round(results.reduce((s, r) => s + r.percentage, 0) / results.length)
      : null;
    const last_attempted_at = results.length > 0
      ? results.reduce((latest, r) => r.created_at > latest ? r.created_at : latest, results[0].created_at)
      : null;

    return {
      id: q.id,
      title: q.title,
      description: q.description,
      question_count: q.question_count,
      source: q.source,
      created_at: q.created_at,
      updated_at: q.updated_at,
      lesson_id: q.lesson_id,
      week_id: q.week_id,
      lesson: q.lessons || null,
      week: q.weeks || null,
      progress_status: progress?.status || null,
      progress: progress ? { current_index: progress.current_index, answers: progress.answers } : null,
      best_score,
      avg_score,
      attempt_count,
      last_attempted_at,
    };
  });

  return Response.json(quizzes);
}

export async function POST(req) {
  const supabase = getSupabase(req);
  if (!supabase) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const { title, description, lesson_id, week_id, quiz_data } = body;

  // Validation: title required
  if (!title || typeof title !== "string" || !title.trim()) {
    return Response.json({ error: "title is required" }, { status: 400 });
  }

  // Validation: exactly one parent
  if ((!lesson_id && !week_id) || (lesson_id && week_id)) {
    return Response.json({ error: "Exactly one of lesson_id or week_id must be provided" }, { status: 400 });
  }

  // Validation: quiz_data has questions
  if (!quiz_data || typeof quiz_data !== "object") {
    return Response.json({ error: "quiz_data is required and must be an object" }, { status: 400 });
  }
  const questions = quiz_data.questions;
  if (!Array.isArray(questions) || questions.length === 0) {
    return Response.json({ error: "quiz_data must contain a non-empty questions array" }, { status: 400 });
  }

  // Validate each question has at minimum: question or prompt, correctAnswer or answer/blanks/accept
  for (const q of questions) {
    if (!q.prompt && !q.question) {
      return Response.json({ error: "Each question must have a prompt or question field" }, { status: 400 });
    }
  }

  // Verify parent belongs to authenticated user
  if (lesson_id) {
    const { data: lesson, error } = await supabase
      .from("lessons")
      .select("id")
      .eq("id", lesson_id)
      .single();
    if (error || !lesson) {
      return Response.json({ error: "Lesson not found or access denied" }, { status: 404 });
    }
  }
  if (week_id) {
    const { data: week, error } = await supabase
      .from("weeks")
      .select("id")
      .eq("id", week_id)
      .single();
    if (error || !week) {
      return Response.json({ error: "Week not found or access denied" }, { status: 404 });
    }
  }

  const question_count = questions.length;

  const { data, error } = await supabase
    .from("quizzes")
    .insert({
      user_id: user.id,
      title: title.trim(),
      description: description || null,
      lesson_id: lesson_id || null,
      week_id: week_id || null,
      quiz_data,
      question_count,
      source: "upload",
    })
    .select()
    .single();

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json(data, { status: 201 });
}
