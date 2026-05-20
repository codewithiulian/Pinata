-- Carolina2 voice + brain config moved out of Fly secrets into per-user settings.
-- Editable from SettingsScreen → carolina2-voice sidecar reads this row on WS auth.

CREATE TABLE user_carolina_voice (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  voice_id TEXT NOT NULL DEFAULT 'kcQkGnn0HAT2JRDQ4Ljp',
  brain_model TEXT NOT NULL DEFAULT 'claude-opus-4-7',
  reflex_model TEXT NOT NULL DEFAULT 'claude-haiku-4-5-20251001',
  tts_model TEXT NOT NULL DEFAULT 'eleven_flash_v2_5',
  speed NUMERIC(3,2) NOT NULL DEFAULT 0.85 CHECK (speed >= 0.7 AND speed <= 1.2),
  disable_reflex BOOLEAN NOT NULL DEFAULT true,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE user_carolina_voice ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users read own carolina voice config"
  ON user_carolina_voice FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "users upsert own carolina voice config"
  ON user_carolina_voice FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "users update own carolina voice config"
  ON user_carolina_voice FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
