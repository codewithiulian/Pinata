import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { getCachedSession } from "../lib/supabase.js";
import { C } from "../styles/theme";
import CarolinaVoiceSettings from "../components/CarolinaVoiceSettings.jsx";


const MODEL_OPTIONS = [
  { id: "claude-opus-4-7", displayName: "Claude Opus 4.7", provider: "anthropic", tier: "Flagship" },
  { id: "claude-opus-4-6", displayName: "Claude Opus 4.6", provider: "anthropic", tier: "Flagship" },
  { id: "gpt-5.4", displayName: "GPT-5.4", provider: "openai", tier: "Flagship" },
  { id: "claude-sonnet-4-6", displayName: "Claude Sonnet 4.6", provider: "anthropic", tier: "Mid-tier" },
  { id: "gpt-5.4-mini", displayName: "GPT-5.4 Mini", provider: "openai", tier: "Mid-tier" },
];

const FEATURES = [
  {
    id: "carolina_chat",
    label: "Carolina Text Chat",
    description: "AI model for written conversations with Carolina",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      </svg>
    ),
  },
  {
    id: "vocabulary",
    label: "Vocabulary Explanations",
    description: "AI model for word explanations and corrections",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="m5 8 6 6" /><path d="m4 14 6-6 2-3" /><path d="M2 5h12" /><path d="M7 2h1" /><path d="m22 22-5-10-5 10" /><path d="M14 18h6" />
      </svg>
    ),
  },
  {
    id: "pdf_processing",
    label: "PDF Lesson Processing",
    description: "AI model for generating summaries and quizzes",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" />
      </svg>
    ),
  },
  {
    id: "conjugar",
    label: "Conjugar Exercises",
    description: "AI model for generating conjugation drill exercises",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 7h16" /><path d="M4 12h16" /><path d="M4 17h10" /><path d="M17 17l2 2 4-4" />
      </svg>
    ),
  },
  {
    id: "redaccion_generation",
    label: "Redacción Generation",
    description: "AI model for generating Spanish writing prompts",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
      </svg>
    ),
  },
  {
    id: "redaccion_correction",
    label: "Redacción Correction",
    description: "AI model for correcting Spanish writing attempts",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 7h10" /><path d="M4 12h7" /><path d="M4 17h6" /><path d="m15 15 2 2 4-4" />
      </svg>
    ),
  },
];

const tiers = [...new Set(MODEL_OPTIONS.map((m) => m.tier))];

const PRICING_TIERS = [
  {
    label: "FLAGSHIP",
    models: [
      {
        name: "Claude Opus 4.6",
        provider: "Anthropic",
        providerColor: "#7C3AED",
        providerBg: "#EDE9FE",
        prices: [
          { label: "Input", value: "$5.00" },
          { label: "Output", value: "$25.00" },
        ],
        extraPrices: [
          { label: "Cache write", value: "$6.25" },
          { label: "Cache hit", value: "$0.50" },
        ],
        note: "1M context · standard rate",
      },
      {
        name: "GPT-5.4",
        provider: "OpenAI",
        providerColor: "#5C6B3A",
        providerBg: "#ECEED8",
        prices: [
          { label: "Input", value: "$2.50" },
          { label: "Output", value: "$15.00" },
        ],
        extraPrices: [
          { label: "Cached input", value: "$0.25" },
          { label: ">272K input", value: "$5.00" },
        ],
        note: "1.05M context · doubles past 272K",
      },
    ],
  },
  {
    label: "MID-TIER (BALANCED)",
    models: [
      {
        name: "Claude Sonnet 4.6",
        provider: "Anthropic",
        providerColor: "#7C3AED",
        providerBg: "#EDE9FE",
        prices: [
          { label: "Input", value: "$3.00" },
          { label: "Output", value: "$15.00" },
        ],
        extraPrices: [],
        note: "1M context · standard rate",
      },
      {
        name: "GPT-5.4 Mini",
        provider: "OpenAI",
        providerColor: "#5C6B3A",
        providerBg: "#ECEED8",
        prices: [
          { label: "Input", value: "$0.75" },
          { label: "Output", value: "$4.50" },
        ],
        extraPrices: [],
        note: "Smaller model, lower capability",
      },
    ],
  },
];

function getAuthHeaders() {
  // Read from localStorage — supabase.auth.getSession() blocks up to 30s offline.
  const session = getCachedSession();
  return {
    Authorization: `Bearer ${session?.access_token || ""}`,
    "Content-Type": "application/json",
  };
}

export default function SettingsScreen() {
  const navigate = useNavigate();
  const [models, setModels] = useState(null);
  const [saving, setSaving] = useState(null);
  const [savedFeature, setSavedFeature] = useState(null);

  useEffect(() => {
    (async () => {
      const headers = await getAuthHeaders();
      const res = await fetch("/api/settings/models", { headers });
      if (res.ok) setModels(await res.json());
    })();
  }, []);

  const handleChange = async (feature, modelId) => {
    const model = MODEL_OPTIONS.find((m) => m.id === modelId);
    if (!model) return;

    // Optimistic update
    setModels((prev) => ({
      ...prev,
      [feature]: { model_id: model.id, display_name: model.displayName, provider: model.provider },
    }));
    setSaving(feature);

    const headers = await getAuthHeaders();
    const res = await fetch("/api/settings/models", {
      method: "PUT",
      headers,
      body: JSON.stringify({ feature, model_id: modelId }),
    });
    setSaving(null);
    if (res.ok) {
      setSavedFeature(feature);
      setTimeout(() => {
        setSavedFeature((curr) => (curr === feature ? null : curr));
      }, 1800);
    }
  };

  const providerColor = (provider) =>
    provider === "anthropic" ? "#D97706" : "#059669";

  return (
    <div className="app-container" style={{ minHeight: "100vh", background: C.bg }}>
      {/* Header */}
      <header style={{
        position: "sticky", top: 0, zIndex: 20, background: C.bg,
        borderBottom: `1px solid ${C.border}`, padding: "16px 20px",
        display: "flex", alignItems: "center", gap: 12,
      }}>
        <button
          className="desktop-sidebar-hide"
          onClick={() => navigate(-1)}
          style={{
            background: "none", border: "none", cursor: "pointer",
            padding: 4, display: "flex", color: C.text,
          }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <h1 style={{
          fontSize: 18, fontWeight: 800, color: C.text,
          fontFamily: "'Nunito', sans-serif", margin: 0,
        }}>Settings</h1>
      </header>

      {/* Content */}
      <div style={{ padding: "24px 20px 120px", maxWidth: 600, margin: "0 auto" }}>
        {/* Section header */}
        <div style={{ marginBottom: 20 }}>
          <h2 style={{
            fontSize: 14, fontWeight: 800, color: C.muted,
            textTransform: "uppercase", letterSpacing: "0.06em",
            fontFamily: "'Nunito', sans-serif", margin: "0 0 4px",
          }}>AI Models</h2>
          <p style={{
            fontSize: 13, color: C.muted, fontFamily: "'Nunito', sans-serif",
            fontWeight: 600, margin: 0,
          }}>Choose which model powers each feature</p>
        </div>

        {/* Model cards */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {FEATURES.map((feature) => {
            const current = models?.[feature.id];
            const selectedId = current?.model_id || "gpt-5.4";

            return (
              <div key={feature.id} style={{
                background: C.card, border: `1px solid ${C.border}`,
                borderRadius: 12, padding: "16px 18px",
              }}>
                {/* Feature header */}
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
                  <span style={{ color: C.accent, display: "flex" }}>{feature.icon}</span>
                  <span style={{
                    fontSize: 15, fontWeight: 800, color: C.text,
                    fontFamily: "'Nunito', sans-serif",
                  }}>{feature.label}</span>
                  <div style={{ flex: 1 }} />
                  {saving === feature.id && (
                    <span style={{
                      fontSize: 11, fontWeight: 800, color: C.muted,
                      fontFamily: "'Nunito', sans-serif",
                      textTransform: "uppercase", letterSpacing: "0.05em",
                      display: "flex", alignItems: "center", gap: 6,
                    }}>
                      <span style={{
                        width: 10, height: 10, borderRadius: "50%",
                        border: `2px solid ${C.border}`, borderTopColor: C.accent,
                        display: "inline-block", animation: "gpdfSpin 1s linear infinite",
                      }} />
                      Guardando
                    </span>
                  )}
                  {savedFeature === feature.id && saving !== feature.id && (
                    <span style={{
                      fontSize: 11, fontWeight: 800, color: "#059669",
                      fontFamily: "'Nunito', sans-serif",
                      textTransform: "uppercase", letterSpacing: "0.05em",
                      display: "flex", alignItems: "center", gap: 4,
                      background: "#D1FAE5", padding: "3px 8px", borderRadius: 999,
                    }}>
                      ✓ Guardado
                    </span>
                  )}
                </div>
                <p style={{
                  fontSize: 12, color: C.muted, fontFamily: "'Nunito', sans-serif",
                  fontWeight: 600, margin: "0 0 12px", paddingLeft: 30,
                }}>{feature.description}</p>

                {/* Model selector */}
                <div style={{ position: "relative", paddingLeft: 30 }}>
                  <select
                    value={selectedId}
                    onChange={(e) => handleChange(feature.id, e.target.value)}
                    disabled={!models || saving === feature.id}
                    style={{
                      width: "100%", padding: "10px 14px",
                      fontSize: 14, fontWeight: 700,
                      fontFamily: "'Nunito', sans-serif",
                      color: C.text, background: C.inputBg,
                      border: `1.5px solid ${C.border}`,
                      borderRadius: 8, cursor: "pointer",
                      appearance: "none",
                      WebkitAppearance: "none",
                      backgroundImage: `url("data:image/svg+xml,%3Csvg width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%235E8078' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round' xmlns='http://www.w3.org/2000/svg'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E")`,
                      backgroundRepeat: "no-repeat",
                      backgroundPosition: "right 12px center",
                      paddingRight: 36,
                      transition: "border-color 0.15s",
                      outline: "none",
                    }}
                    onFocus={(e) => { e.target.style.borderColor = C.accent; }}
                    onBlur={(e) => { e.target.style.borderColor = C.border; }}
                  >
                    {tiers.map((tier) => (
                      <optgroup key={tier} label={tier}>
                        {MODEL_OPTIONS.filter((m) => m.tier === tier).map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.displayName}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </select>

                  {/* Provider badge */}
                  {current && (
                    <span style={{
                      position: "absolute", right: 44, top: "50%", transform: "translateY(-50%)",
                      fontSize: 10, fontWeight: 800, textTransform: "uppercase",
                      letterSpacing: "0.04em",
                      color: providerColor(current.provider),
                      background: `${providerColor(current.provider)}14`,
                      padding: "2px 6px", borderRadius: 4,
                      fontFamily: "'Nunito', sans-serif",
                      pointerEvents: "none",
                    }}>
                      {current.provider}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Carolina Voice (voice ID + brain/reflex/TTS model + speed + reflex toggle) */}
        <CarolinaVoiceSettings />

        {/* Pricing comparison table */}
        <div style={{ marginTop: 36 }}>
          {PRICING_TIERS.map((tier) => (
            <div key={tier.label} style={{ marginBottom: 28 }}>
              <h3 style={{
                fontSize: 13, fontWeight: 800, color: C.text,
                textTransform: "uppercase", letterSpacing: "0.05em",
                fontFamily: "'Nunito', sans-serif", margin: "0 0 12px",
              }}>{tier.label}</h3>

              <div style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                gap: 12,
              }}>
                {tier.models.map((model) => (
                  <div key={model.name} style={{
                    background: "#fff",
                    border: `1px solid ${C.border}`,
                    borderRadius: 12,
                    padding: "16px 18px",
                  }}>
                    {/* Provider badge */}
                    <span style={{
                      display: "inline-block",
                      fontSize: 11, fontWeight: 700,
                      color: model.providerColor,
                      background: model.providerBg,
                      padding: "2px 8px", borderRadius: 4,
                      fontFamily: "'Nunito', sans-serif",
                      marginBottom: 8,
                    }}>{model.provider}</span>

                    {/* Model name */}
                    <div style={{
                      fontSize: 16, fontWeight: 800, color: C.text,
                      fontFamily: "'Nunito', sans-serif", marginBottom: 12,
                    }}>{model.name}</div>

                    {/* Base prices */}
                    {model.prices.map((p) => (
                      <div key={p.label} style={{
                        display: "flex", justifyContent: "space-between",
                        alignItems: "baseline", marginBottom: 4,
                      }}>
                        <span style={{
                          fontSize: 13, color: C.muted,
                          fontFamily: "'Nunito', sans-serif", fontWeight: 600,
                        }}>{p.label}</span>
                        <span style={{
                          fontSize: 14, fontWeight: 800, color: C.text,
                          fontFamily: "'Nunito', sans-serif",
                        }}>{p.value}</span>
                      </div>
                    ))}

                    {/* Extra prices (cache etc.) */}
                    {model.extraPrices.length > 0 && (
                      <>
                        <div style={{
                          borderTop: `1px solid ${C.border}`,
                          margin: "8px 0",
                        }} />
                        {model.extraPrices.map((p) => (
                          <div key={p.label} style={{
                            display: "flex", justifyContent: "space-between",
                            alignItems: "baseline", marginBottom: 4,
                          }}>
                            <span style={{
                              fontSize: 13, color: C.muted,
                              fontFamily: "'Nunito', sans-serif", fontWeight: 600,
                            }}>{p.label}</span>
                            <span style={{
                              fontSize: 14, fontWeight: 800, color: C.text,
                              fontFamily: "'Nunito', sans-serif",
                            }}>{p.value}</span>
                          </div>
                        ))}
                      </>
                    )}

                    {/* Note */}
                    <div style={{
                      fontSize: 11, color: C.muted,
                      fontFamily: "'Nunito', sans-serif", fontWeight: 600,
                      marginTop: 10,
                    }}>{model.note}</div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>


    </div>
  );
}
