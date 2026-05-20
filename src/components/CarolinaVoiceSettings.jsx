import { useState, useEffect } from "react";
import { getCachedSession } from "../lib/supabase.js";
import { C } from "../styles/theme";
import {
  CAROLINA_BRAIN_MODELS,
  CAROLINA_REFLEX_MODELS,
  CAROLINA_TTS_MODELS,
  CAROLINA_VOICE_DEFAULTS,
  CAROLINA_SPEED_MIN,
  CAROLINA_SPEED_MAX,
} from "../../lib/ai/carolina-voice-config.js";

function authHeaders() {
  const session = getCachedSession();
  return {
    Authorization: `Bearer ${session?.access_token || ""}`,
    "Content-Type": "application/json",
  };
}

// Inputs are debounced through a "Save" button so the user types the voice ID
// without firing PUTs on every keystroke. Models / toggle / slider save
// immediately for that "settings just work" feel.
export default function CarolinaVoiceSettings() {
  const [cfg, setCfg] = useState(null);
  const [saving, setSaving] = useState(false);
  const [voiceDraft, setVoiceDraft] = useState("");
  const [savedNote, setSavedNote] = useState(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const res = await fetch("/api/settings/carolina-voice", { headers: authHeaders() });
      if (!alive || !res.ok) return;
      const data = await res.json();
      setCfg(data);
      setVoiceDraft(data.voice_id || "");
    })();
    return () => {
      alive = false;
    };
  }, []);

  const flashSaved = (label) => {
    setSavedNote(label);
    setTimeout(() => setSavedNote((curr) => (curr === label ? null : curr)), 1800);
  };

  const persist = async (patch, label) => {
    if (!cfg) return;
    setCfg((prev) => ({ ...prev, ...patch }));
    setSaving(true);
    const res = await fetch("/api/settings/carolina-voice", {
      method: "PUT",
      headers: authHeaders(),
      body: JSON.stringify(patch),
    });
    setSaving(false);
    if (res.ok) {
      const data = await res.json();
      setCfg(data);
      flashSaved(label);
    }
  };

  const saveVoice = () => {
    const next = voiceDraft.trim();
    if (!next || next === cfg?.voice_id) return;
    persist({ voice_id: next }, "voice_id");
  };

  if (!cfg) return null;

  return (
    <div style={{ marginTop: 36 }}>
      <div style={{ marginBottom: 20 }}>
        <h2 style={{
          fontSize: 14, fontWeight: 800, color: C.muted,
          textTransform: "uppercase", letterSpacing: "0.06em",
          fontFamily: "'Nunito', sans-serif", margin: "0 0 4px",
        }}>Carolina Voice</h2>
        <p style={{
          fontSize: 13, color: C.muted, fontFamily: "'Nunito', sans-serif",
          fontWeight: 600, margin: 0,
        }}>Voice, brain model, and TTS behaviour for the Carolina2 conversation tab</p>
      </div>

      <div style={{
        background: C.card, border: `1px solid ${C.border}`,
        borderRadius: 12, padding: "18px 20px",
        display: "flex", flexDirection: "column", gap: 18,
      }}>
        {/* Voice ID */}
        <Field
          label="ElevenLabs Voice ID"
          hint="Find IDs in ElevenLabs → Voices → click voice → copy ID"
          right={savedNote === "voice_id" && <SavedPill />}
        >
          <div style={{ display: "flex", gap: 8 }}>
            <input
              type="text"
              value={voiceDraft}
              onChange={(e) => setVoiceDraft(e.target.value)}
              onBlur={saveVoice}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  saveVoice();
                }
              }}
              placeholder={CAROLINA_VOICE_DEFAULTS.voice_id}
              style={inputStyle}
              spellCheck={false}
            />
            <button
              type="button"
              onClick={saveVoice}
              disabled={saving || voiceDraft.trim() === cfg.voice_id}
              style={btnStyle(saving || voiceDraft.trim() === cfg.voice_id)}
            >
              Save
            </button>
          </div>
        </Field>

        <Select
          label="Brain model"
          hint="Drives the substantive replies (Opus = best, Haiku = fastest/cheapest)"
          value={cfg.brain_model}
          options={CAROLINA_BRAIN_MODELS}
          saved={savedNote === "brain_model"}
          onChange={(v) => persist({ brain_model: v }, "brain_model")}
        />

        <Select
          label="Reflex model"
          hint="Generates the short filler ('mmm, a ver…') while Opus is thinking"
          value={cfg.reflex_model}
          options={CAROLINA_REFLEX_MODELS}
          saved={savedNote === "reflex_model"}
          onChange={(v) => persist({ reflex_model: v }, "reflex_model")}
        />

        <Select
          label="ElevenLabs TTS model"
          hint="Flash = lowest latency, Turbo = slightly higher quality"
          value={cfg.tts_model}
          options={CAROLINA_TTS_MODELS}
          saved={savedNote === "tts_model"}
          onChange={(v) => persist({ tts_model: v }, "tts_model")}
        />

        {/* Speed slider */}
        <Field
          label={`Speech speed · ${Number(cfg.speed).toFixed(2)}×`}
          hint={`Range ${CAROLINA_SPEED_MIN}–${CAROLINA_SPEED_MAX}. 0.85 ≈ relaxed, 1.0 = native, 1.2 = brisk.`}
          right={savedNote === "speed" && <SavedPill />}
        >
          <input
            type="range"
            min={CAROLINA_SPEED_MIN}
            max={CAROLINA_SPEED_MAX}
            step={0.05}
            value={cfg.speed}
            onChange={(e) => setCfg((p) => ({ ...p, speed: Number(e.target.value) }))}
            onMouseUp={(e) => persist({ speed: Number(e.target.value) }, "speed")}
            onTouchEnd={(e) =>
              persist({ speed: Number(e.target.value) }, "speed")
            }
            style={{ width: "100%", accentColor: C.accent }}
          />
        </Field>

        {/* Reflex toggle */}
        <Field
          label="Reflex filler"
          hint="When on, Carolina says a brief filler while the brain is generating. Off = no filler."
          right={savedNote === "disable_reflex" && <SavedPill />}
        >
          <label style={{ display: "inline-flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={!cfg.disable_reflex}
              onChange={(e) =>
                persist({ disable_reflex: !e.target.checked }, "disable_reflex")
              }
              style={{ width: 18, height: 18, accentColor: C.accent }}
            />
            <span style={{
              fontSize: 14, fontWeight: 700, color: C.text,
              fontFamily: "'Nunito', sans-serif",
            }}>
              {cfg.disable_reflex ? "Disabled" : "Enabled"}
            </span>
          </label>
        </Field>
      </div>
    </div>
  );
}

function Field({ label, hint, right, children }) {
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
        <span style={{
          fontSize: 14, fontWeight: 800, color: C.text,
          fontFamily: "'Nunito', sans-serif",
        }}>{label}</span>
        <div style={{ flex: 1 }} />
        {right}
      </div>
      {hint && (
        <p style={{
          fontSize: 12, color: C.muted, fontFamily: "'Nunito', sans-serif",
          fontWeight: 600, margin: "0 0 8px",
        }}>{hint}</p>
      )}
      {children}
    </div>
  );
}

function Select({ label, hint, value, options, saved, onChange }) {
  return (
    <Field label={label} hint={hint} right={saved && <SavedPill />}>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          ...inputStyle,
          appearance: "none",
          WebkitAppearance: "none",
          backgroundImage: `url("data:image/svg+xml,%3Csvg width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%235E8078' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round' xmlns='http://www.w3.org/2000/svg'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E")`,
          backgroundRepeat: "no-repeat",
          backgroundPosition: "right 12px center",
          paddingRight: 36,
          cursor: "pointer",
        }}
      >
        {options.map((o) => (
          <option key={o.id} value={o.id}>{o.displayName}</option>
        ))}
      </select>
    </Field>
  );
}

function SavedPill() {
  return (
    <span style={{
      fontSize: 11, fontWeight: 800, color: "#059669",
      fontFamily: "'Nunito', sans-serif",
      textTransform: "uppercase", letterSpacing: "0.05em",
      background: "#D1FAE5", padding: "3px 8px", borderRadius: 999,
    }}>
      ✓ Guardado
    </span>
  );
}

const inputStyle = {
  width: "100%", padding: "10px 14px",
  fontSize: 14, fontWeight: 700,
  fontFamily: "'Nunito', sans-serif",
  color: C.text, background: C.inputBg,
  border: `1.5px solid ${C.border}`,
  borderRadius: 8, outline: "none",
};

const btnStyle = (disabled) => ({
  padding: "10px 16px",
  fontSize: 14, fontWeight: 800,
  fontFamily: "'Nunito', sans-serif",
  color: disabled ? C.muted : "#fff",
  background: disabled ? C.border : C.accent,
  border: "none",
  borderRadius: 8,
  cursor: disabled ? "not-allowed" : "pointer",
  whiteSpace: "nowrap",
});
