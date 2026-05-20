// Mirror of Piñata's lib/ai/carolina-voice-config.js — kept in sync by hand.
// Sidecar re-validates every value it reads from user_carolina_voice so a
// compromised DB row can't make us bill into a wrong model or runaway speed.

export const CAROLINA_BRAIN_MODELS = [
  "claude-opus-4-7",
  "claude-sonnet-4-6",
  "claude-haiku-4-5-20251001",
];

export const CAROLINA_REFLEX_MODELS = [
  "claude-haiku-4-5-20251001",
  "claude-sonnet-4-6",
];

export const CAROLINA_TTS_MODELS = [
  "eleven_flash_v2_5",
  "eleven_turbo_v2_5",
];

export type CarolinaVoiceConfig = {
  voice_id: string;
  brain_model: string;
  reflex_model: string;
  tts_model: string;
  speed: number;
  disable_reflex: boolean;
};

export const CAROLINA_VOICE_DEFAULTS: CarolinaVoiceConfig = {
  voice_id: "kcQkGnn0HAT2JRDQ4Ljp",
  brain_model: "claude-opus-4-7",
  reflex_model: "claude-haiku-4-5-20251001",
  tts_model: "eleven_flash_v2_5",
  speed: 0.85,
  disable_reflex: true,
};

const SPEED_MIN = 0.7;
const SPEED_MAX = 1.2;
const VOICE_ID_RE = /^[A-Za-z0-9]{1,32}$/;

// Returns a fully-populated config: any field that fails validation falls
// back to the default. Use on EVERY read of user_carolina_voice.
export function sanitiseCarolinaVoiceConfig(
  input: Partial<CarolinaVoiceConfig> | null | undefined,
): CarolinaVoiceConfig {
  const out: CarolinaVoiceConfig = { ...CAROLINA_VOICE_DEFAULTS };
  if (
    typeof input?.voice_id === "string" &&
    VOICE_ID_RE.test(input.voice_id)
  ) {
    out.voice_id = input.voice_id;
  }
  if (CAROLINA_BRAIN_MODELS.includes(input?.brain_model || "")) {
    out.brain_model = input!.brain_model!;
  }
  if (CAROLINA_REFLEX_MODELS.includes(input?.reflex_model || "")) {
    out.reflex_model = input!.reflex_model!;
  }
  if (CAROLINA_TTS_MODELS.includes(input?.tts_model || "")) {
    out.tts_model = input!.tts_model!;
  }
  const n = Number(input?.speed);
  if (Number.isFinite(n)) {
    out.speed = Math.min(SPEED_MAX, Math.max(SPEED_MIN, n));
  }
  if (typeof input?.disable_reflex === "boolean") {
    out.disable_reflex = input.disable_reflex;
  }
  return out;
}
