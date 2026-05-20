// Allowlists + defaults shared by:
//   - /api/settings/carolina-voice (PUT validation)
//   - SettingsScreen (dropdown options)
//   - carolina2-voice sidecar (re-validates DB values on read)
//
// Keep brain / reflex / tts model lists in lockstep with what Anthropic + ElevenLabs
// actually expose. Voice IDs are user-typed (any ElevenLabs voice the account owns).

export const CAROLINA_BRAIN_MODELS = [
  { id: "claude-opus-4-7", displayName: "Claude Opus 4.7", tier: "Flagship" },
  { id: "claude-sonnet-4-6", displayName: "Claude Sonnet 4.6", tier: "Mid-tier" },
  { id: "claude-haiku-4-5-20251001", displayName: "Claude Haiku 4.5", tier: "Fast" },
];

export const CAROLINA_REFLEX_MODELS = [
  { id: "claude-haiku-4-5-20251001", displayName: "Claude Haiku 4.5" },
  { id: "claude-sonnet-4-6", displayName: "Claude Sonnet 4.6" },
];

export const CAROLINA_TTS_MODELS = [
  { id: "eleven_flash_v2_5", displayName: "Flash v2.5 (low latency)" },
  { id: "eleven_turbo_v2_5", displayName: "Turbo v2.5 (balanced)" },
];

export const CAROLINA_VOICE_DEFAULTS = Object.freeze({
  voice_id: "kcQkGnn0HAT2JRDQ4Ljp",
  brain_model: "claude-opus-4-7",
  reflex_model: "claude-haiku-4-5-20251001",
  tts_model: "eleven_flash_v2_5",
  speed: 0.85,
  disable_reflex: true,
});

export const CAROLINA_SPEED_MIN = 0.7;
export const CAROLINA_SPEED_MAX = 1.2;

const VOICE_ID_RE = /^[A-Za-z0-9]{1,32}$/;

// Returns a sanitised config, dropping any keys whose values fail validation.
// Use on the API PUT path AND on the sidecar's read path — never trust DB blindly.
export function sanitiseCarolinaVoiceConfig(input) {
  const out = {};
  if (typeof input?.voice_id === "string" && VOICE_ID_RE.test(input.voice_id)) {
    out.voice_id = input.voice_id;
  }
  if (CAROLINA_BRAIN_MODELS.some((m) => m.id === input?.brain_model)) {
    out.brain_model = input.brain_model;
  }
  if (CAROLINA_REFLEX_MODELS.some((m) => m.id === input?.reflex_model)) {
    out.reflex_model = input.reflex_model;
  }
  if (CAROLINA_TTS_MODELS.some((m) => m.id === input?.tts_model)) {
    out.tts_model = input.tts_model;
  }
  const n = Number(input?.speed);
  if (Number.isFinite(n)) {
    out.speed = Math.min(CAROLINA_SPEED_MAX, Math.max(CAROLINA_SPEED_MIN, n));
  }
  if (typeof input?.disable_reflex === "boolean") {
    out.disable_reflex = input.disable_reflex;
  }
  return out;
}

// Fills any missing keys from defaults. Use for the sidecar / settings GET.
export function withCarolinaVoiceDefaults(partial) {
  return { ...CAROLINA_VOICE_DEFAULTS, ...sanitiseCarolinaVoiceConfig(partial || {}) };
}
