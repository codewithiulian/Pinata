import { createClient } from "@supabase/supabase-js";
import {
  CAROLINA_VOICE_DEFAULTS,
  sanitiseCarolinaVoiceConfig,
  withCarolinaVoiceDefaults,
} from "../../../../lib/ai/carolina-voice-config.js";

function getSupabase(req) {
  const token = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!token) return null;
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    { global: { headers: { Authorization: `Bearer ${token}` } } },
  );
}

export async function GET(req) {
  const supabase = getSupabase(req);
  if (!supabase) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { data: row } = await supabase
    .from("user_carolina_voice")
    .select("voice_id, brain_model, reflex_model, tts_model, speed, disable_reflex")
    .eq("user_id", user.id)
    .maybeSingle();

  return Response.json(withCarolinaVoiceDefaults(row));
}

export async function PUT(req) {
  const supabase = getSupabase(req);
  if (!supabase) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const clean = sanitiseCarolinaVoiceConfig(body);
  if (Object.keys(clean).length === 0) {
    return Response.json({ error: "No valid fields supplied" }, { status: 400 });
  }

  // Seed any missing column with the default; otherwise INSERT on a fresh row
  // would fail NOT NULL. UPDATE-only would skip first-time savers.
  const payload = {
    user_id: user.id,
    ...CAROLINA_VOICE_DEFAULTS,
    ...clean,
    updated_at: new Date().toISOString(),
  };

  const { error } = await supabase
    .from("user_carolina_voice")
    .upsert(payload, { onConflict: "user_id" });

  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json(withCarolinaVoiceDefaults(payload));
}
