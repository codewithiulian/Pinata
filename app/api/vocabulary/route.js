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

  const { searchParams } = new URL(req.url);
  const search = searchParams.get("search");

  let query = supabase
    .from("vocabulary")
    .select("*")
    .order("created_at", { ascending: false });

  if (search) {
    query = query.ilike("word", `%${search}%`);
  }

  const { data, error } = await query;
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json(data);
}

export async function POST(req) {
  const supabase = getSupabase(req);
  if (!supabase) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const { words } = body;

  if (!words || !Array.isArray(words) || words.length === 0) {
    return Response.json({ error: "words array is required" }, { status: 400 });
  }

  const rows = words.map((w) => ({
    user_id: user.id,
    word: w.word,
    explanation_es: w.explanation_es || null,
    explanation_en: w.explanation_en || null,
    ai_generated: w.ai_generated || false,
    original_input: w.original_input || null,
  }));

  const { data, error } = await supabase
    .from("vocabulary")
    .insert(rows)
    .select();

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json(data, { status: 201 });
}

export async function PATCH(req) {
  const supabase = getSupabase(req);
  if (!supabase) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const { id, word, explanation_es, explanation_en } = body;

  if (!id) return Response.json({ error: "id is required" }, { status: 400 });

  const updates = { updated_at: new Date().toISOString() };
  if (word !== undefined) updates.word = word;
  if (explanation_es !== undefined) updates.explanation_es = explanation_es;
  if (explanation_en !== undefined) updates.explanation_en = explanation_en;

  const { data, error } = await supabase
    .from("vocabulary")
    .update(updates)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    if (error.code === "PGRST116") return Response.json({ error: "Not found" }, { status: 404 });
    return Response.json({ error: error.message }, { status: 500 });
  }
  return Response.json(data);
}

export async function DELETE(req) {
  const supabase = getSupabase(req);
  if (!supabase) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");

  if (!id) return Response.json({ error: "id is required" }, { status: 400 });

  const { error } = await supabase
    .from("vocabulary")
    .delete()
    .eq("id", id);

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ success: true });
}
