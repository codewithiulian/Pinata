import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { C } from "../styles/theme";
import {
  fetchCarolinaResources,
  fetchLesson,
  fetchCarolina2Prompt,
} from "../lib/api.js";
import { buildLessonContext } from "../lib/carolina2/lessonContext.js";
import { useCarolina2Voice } from "../lib/carolina2/useCarolina2Voice.js";
import { ResourcePicker, ResourcePills } from "../components/ResourcePicker";

// Blue accent for orb & session UI (matches DialogScreen).
const B = {
  primary: "#4285F4",
  light: "#E8F0FE",
  dark: "#1A73E8",
  ring: "rgba(66, 133, 244, 0.12)",
};

// Green accent for the user's turn.
const G = {
  primary: "#34A853",
  ring: "rgba(52, 168, 83, 0.12)",
};

const WS_URL = process.env.NEXT_PUBLIC_CAROLINA2_WS_URL || "";
const USD_PER_1K = Number(process.env.NEXT_PUBLIC_EL_USD_PER_1K ?? "0.05");

const formatTime = (s) =>
  `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

function Hud({ status, sttLatencyMs, metrics, session, mimeType }) {
  const fmt = (n) => (n === null || n === undefined ? "—" : `${n} ms`);
  return (
    <div style={{
      position: "fixed", right: 12, top: 12, borderRadius: 8,
      background: "rgba(0,0,0,0.8)", padding: "8px 12px",
      fontFamily: "monospace", fontSize: 11, color: "#86efac", zIndex: 60,
      pointerEvents: "none",
    }}>
      <div>state: {status}</div>
      <div>stt latency: <span style={{ color: "#fff" }}>{fmt(sttLatencyMs)}</span></div>
      <div>perceived: <span style={{ color: "#fde047", fontWeight: 700 }}>{fmt(metrics?.perceived)}</span></div>
      <div>opus first token: <span style={{ color: "#fff" }}>{fmt(metrics?.ttft)}</span></div>
      <div>brain first audio: <span style={{ color: "#fff" }}>{fmt(metrics?.ttfa)}</span></div>
      <div>total turn: <span style={{ color: "#fff" }}>{fmt(metrics?.total)}</span></div>
      <div style={{ borderTop: "1px solid #14532d", margin: "4px 0" }} />
      <div>
        session chars ({session?.exact ? "exact" : "est"}):{" "}
        <span style={{ color: "#fff" }}>
          {session ? session.chars.toLocaleString() : "—"}
        </span>
      </div>
      <div>
        session cost:{" "}
        <span style={{ color: "#67e8f9", fontWeight: 700 }}>
          {session ? `~$${((session.chars / 1000) * USD_PER_1K).toFixed(4)}` : "—"}
        </span>
      </div>
      <div style={{ color: "#22c55e" }}>{mimeType || "mime: —"}</div>
    </div>
  );
}

export default function Carolina2Screen() {
  const navigate = useNavigate();

  // Phase: "setup" (pre-call lesson picker) vs "call" (call active or connecting).
  const [phase, setPhase] = useState("setup");

  // Pre-call state — mirrors DialogScreen's lesson picker shape.
  const [availableResources, setAvailableResources] = useState([]);
  const [attachedResources, setAttachedResources] = useState([]);
  const [selectedResourceIds, setSelectedResourceIds] = useState({});
  const [showResourcePicker, setShowResourcePicker] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  // In-call transcript panel toggle.
  const [showTranscript, setShowTranscript] = useState(false);
  const transcriptEndRef = useRef(null);

  const [loadingCtx, setLoadingCtx] = useState(false);
  const [setupError, setSetupError] = useState("");

  // Voice engine.
  const lessonContextRef = useRef("");
  const systemInstructionRef = useRef("");
  const voice = useCarolina2Voice(WS_URL, lessonContextRef, systemInstructionRef);
  const greetFiredRef = useRef(false);

  // Debug HUD only when ?hud=1 in URL.
  const [hudEnabled, setHudEnabled] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    setHudEnabled(new URLSearchParams(window.location.search).get("hud") === "1");
  }, []);

  // Load weeks + lessons.
  useEffect(() => {
    fetchCarolinaResources()
      .then(setAvailableResources)
      .catch(() => setAvailableResources([]));
  }, []);

  // Mobile detection.
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  // Auto-scroll transcript.
  useEffect(() => {
    if (showTranscript && transcriptEndRef.current) {
      transcriptEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [voice.transcript, showTranscript]);

  const handleToggleResource = (lessonId, label) => {
    setSelectedResourceIds((prev) => {
      const next = { ...prev };
      if (lessonId in next) delete next[lessonId];
      else next[lessonId] = label;
      return next;
    });
  };

  const handleAttachResources = () => {
    const newResources = Object.entries(selectedResourceIds).map(
      ([id, label]) => ({ type: "lesson", id, label }),
    );
    setAttachedResources(newResources);
    setShowResourcePicker(false);
  };

  const handleRemoveResource = (id) => {
    setAttachedResources((prev) => prev.filter((r) => r.id !== id));
    setSelectedResourceIds((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  };

  const handleStartInstant = async () => {
    setSetupError("");
    setLoadingCtx(true);
    try {
      const lessons = await Promise.all(
        attachedResources.map((r) =>
          fetchLesson(r.id)
            .then((l) => ({
              title: l?.title || r.label || "Lesson",
              markdown_content: l?.markdown_content || "",
            }))
            .catch(() => null),
        ),
      );
      lessonContextRef.current = buildLessonContext(lessons.filter(Boolean));
      try {
        systemInstructionRef.current = await fetchCarolina2Prompt(
          lessonContextRef.current,
        );
      } catch {
        systemInstructionRef.current = "";
      }
    } catch {
      lessonContextRef.current = "";
      systemInstructionRef.current = "";
      setSetupError("Could not load some lessons — starting without them.");
    } finally {
      setLoadingCtx(false);
      greetFiredRef.current = false;
      setPhase("call");
    }
  };

  // Fire opening greeting exactly once when entering call phase. We deliberately
  // depend only on `phase` and stash voice.greet in a ref to avoid the dep-array
  // churn that comes from `voice` being a fresh object every render.
  const voiceGreetRef = useRef(voice.greet);
  useEffect(() => {
    voiceGreetRef.current = voice.greet;
  });
  useEffect(() => {
    if (phase !== "call" || greetFiredRef.current) return;
    greetFiredRef.current = true;
    voiceGreetRef.current();
  }, [phase]);

  const handleEndCall = () => {
    voice.endCall();
    greetFiredRef.current = false;
    setShowTranscript(false);
    setPhase("setup");
  };

  // Mirrors DialogScreen's three sub-phases.
  const isPreCall = phase === "setup";
  const isConnecting = phase === "call" && voice.isConnecting && !voice.isSessionActive;
  const isActive = phase === "call" && voice.isSessionActive;

  // Active-call accent toggles between blue (Carolina speaking) and green (your turn).
  const isUserTurn = voice.isUserTurn;
  const accentPrimary = isUserTurn ? G.primary : B.primary;
  const accentRing = isUserTurn ? G.ring : B.ring;
  const accentSoft = isUserTurn
    ? "rgba(52,168,83,0.05)"
    : "rgba(66,133,244,0.05)";

  const messageCount = voice.transcript.length;

  return (
    <div
      className="fade-in desktop-main"
      style={{
        minHeight: "100vh",
        background: C.bg,
        display: "flex",
        flexDirection: "column",
      }}
    >
      {hudEnabled && (
        <Hud
          status={voice.status}
          sttLatencyMs={voice.sttLatencyMs}
          metrics={voice.metrics}
          session={voice.session}
          mimeType={voice.mimeType}
        />
      )}

      {/* Header */}
      <div
        className="safe-top"
        style={{
          position: "sticky",
          top: 0,
          zIndex: 20,
          background: C.bg,
          padding: "16px 20px 12px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
        }}
      >
        <div className="quiz-home-btn" style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button
            onClick={() => navigate("/")}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              padding: 4,
              minWidth: 44,
              minHeight: 44,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={C.text} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
          <h1 style={{ fontSize: 20, fontWeight: 900, color: C.text }}>
            {isPreCall ? "Hablar" : "Carolina"}
          </h1>
        </div>

        <div className="quiz-desktop-header" style={{ display: "none", alignItems: "center", gap: 12 }}>
          <button onClick={() => navigate("/")} style={{
            background: "none", border: `1.5px solid ${C.border}`, borderRadius: 10,
            color: C.muted, cursor: "pointer", padding: "6px 8px",
            display: "flex", alignItems: "center", justifyContent: "center",
            transition: "all 0.15s",
          }}
          onMouseEnter={(e) => { e.currentTarget.style.color = C.accent; e.currentTarget.style.borderColor = C.accent; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = C.muted; e.currentTarget.style.borderColor = C.border; }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
          <h1 style={{ fontSize: 17, fontWeight: 800, color: C.text }}>
            {isPreCall ? "Hablar" : "Carolina"}
          </h1>
        </div>

        {isActive && (
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <div
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: B.primary,
                animation: "dotBlink 1.5s infinite ease-in-out",
              }}
            />
            <span style={{ fontSize: 14, fontWeight: 700, color: C.text }}>
              {formatTime(voice.sessionDuration)}
            </span>
          </div>
        )}
      </div>

      {/* ============ PRE-CALL VIEW ============ */}
      {isPreCall && (
        <>
          <div
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              padding: 20,
            }}
          >
            <div
              style={{
                width: 152,
                height: 152,
                borderRadius: "50%",
                overflow: "hidden",
                marginBottom: 20,
                boxShadow: `0 0 0 12px ${B.ring}, 0 0 0 24px rgba(66,133,244,0.05)`,
              }}
            >
              <img
                src="/images/Carolina.png"
                alt="Carolina"
                style={{ width: "100%", height: "100%", objectFit: "cover" }}
              />
            </div>
            <p style={{ fontSize: 24, fontWeight: 900, color: C.text, marginBottom: 4 }}>
              Carolina
            </p>
            <p style={{ fontSize: 14, fontWeight: 600, color: C.muted, marginBottom: 28 }}>
              Your Spanish practice buddy
            </p>

            <ResourcePills resources={attachedResources} onRemove={handleRemoveResource} />

            <div style={{ position: "relative" }}>
              <button
                onClick={() => setShowResourcePicker((v) => !v)}
                style={{
                  padding: "8px 20px",
                  borderRadius: 20,
                  border: `2px solid ${C.accent}`,
                  backgroundColor: C.card,
                  color: C.text,
                  fontSize: 14,
                  fontWeight: 700,
                  fontFamily: "'Nunito', sans-serif",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
                </svg>
                {attachedResources.length > 0
                  ? `${attachedResources.length} lesson${attachedResources.length !== 1 ? "s" : ""} attached`
                  : "Add lessons"}
              </button>

              {showResourcePicker && (
                <ResourcePicker
                  availableResources={availableResources}
                  selectedIds={selectedResourceIds}
                  onToggle={handleToggleResource}
                  onClose={() => setShowResourcePicker(false)}
                  onAttach={handleAttachResources}
                  isMobile={isMobile}
                />
              )}
            </div>

            {setupError && (
              <p style={{ color: "#dc2626", fontSize: 13, marginTop: 16, textAlign: "center" }}>
                {setupError}
              </p>
            )}
          </div>

          <div
            style={{
              padding: "16px 20px 32px",
              textAlign: "center",
              paddingBottom: "max(32px, env(safe-area-inset-bottom, 32px))",
            }}
          >
            <button
              onClick={handleStartInstant}
              disabled={loadingCtx}
              aria-label="Call Carolina"
              style={{
                width: 72,
                height: 72,
                borderRadius: "50%",
                border: "none",
                cursor: loadingCtx ? "default" : "pointer",
                background: "#34A853",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                boxShadow: "0 4px 16px rgba(52,168,83,0.3)",
                opacity: loadingCtx ? 0.6 : 1,
                transition: "transform 0.15s",
              }}
            >
              <PhoneIcon size={28} color="#fff" />
            </button>
            <p style={{ color: C.muted, fontSize: 13, fontWeight: 600, marginTop: 12 }}>
              {loadingCtx ? "Preparing…" : "Tap to call Carolina"}
            </p>
          </div>
        </>
      )}

      {/* ============ CONNECTING VIEW ============ */}
      {isConnecting && (
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            padding: 20,
          }}
        >
          <div
            style={{
              width: 152,
              height: 152,
              borderRadius: "50%",
              overflow: "hidden",
              marginBottom: 28,
              animation: "orbPulse 1.5s infinite ease-in-out",
              boxShadow: `0 0 0 12px ${B.ring}, 0 0 0 24px rgba(66,133,244,0.05)`,
            }}
          >
            <img
              src="/images/Carolina.png"
              alt="Carolina"
              style={{ width: "100%", height: "100%", objectFit: "cover" }}
            />
          </div>
          <p style={{ fontSize: 20, fontWeight: 800, color: C.text, marginBottom: 6 }}>
            Calling Carolina...
          </p>
          <p style={{ fontSize: 14, fontWeight: 600, color: C.muted }}>
            Setting up your session
          </p>
        </div>
      )}

      {/* ============ ACTIVE SESSION ============ */}
      {isActive && (
        <>
          <div
            style={{
              flex: showTranscript && isMobile ? "none" : 1,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              padding: showTranscript && isMobile ? "12px 20px" : 20,
              transition: "padding 0.3s",
            }}
          >
            <div
              style={{
                position: "relative",
                width: showTranscript && isMobile ? 80 : 200,
                height: showTranscript && isMobile ? 80 : 200,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                marginBottom: showTranscript && isMobile ? 8 : 24,
                transition: "all 0.3s",
              }}
            >
              {!(showTranscript && isMobile) &&
                [0, 1, 2].map((i) => (
                  <div
                    key={i}
                    style={{
                      position: "absolute",
                      width: 152,
                      height: 152,
                      borderRadius: "50%",
                      border: `2px solid ${accentPrimary}`,
                      opacity: 0,
                      animation: `ringExpand 2.4s ${i * 0.8}s infinite ease-out`,
                      transition: "border-color 0.3s",
                    }}
                  />
                ))}

              <div
                style={{
                  width: showTranscript && isMobile ? 64 : 152,
                  height: showTranscript && isMobile ? 64 : 152,
                  borderRadius: "50%",
                  overflow: "hidden",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  boxShadow: showTranscript && isMobile ? "none" : `0 0 0 12px ${accentRing}, 0 0 0 24px ${accentSoft}`,
                  animation: voice.isAISpeaking
                    ? "none"
                    : "orbPulse 3s infinite ease-in-out",
                  transition: "box-shadow 0.3s",
                  zIndex: 1,
                }}
              >
                <img
                  src="/images/Carolina.png"
                  alt="Carolina"
                  style={{ width: "100%", height: "100%", objectFit: "cover" }}
                />
              </div>

              {voice.isAISpeaking && (
                <div
                  style={{
                    position: "absolute",
                    zIndex: 2,
                    display: "flex",
                    gap: 3,
                    alignItems: "center",
                    height: showTranscript && isMobile ? 24 : 36,
                  }}
                >
                  {[0, 1, 2, 3, 4].map((i) => (
                    <div
                      key={i}
                      style={{
                        width: 4,
                        borderRadius: 2,
                        background: "#fff",
                        animation: `waveBar 0.6s ${i * 0.1}s infinite ease-in-out alternate`,
                      }}
                    />
                  ))}
                </div>
              )}
            </div>

            <p
              style={{
                fontSize: showTranscript && isMobile ? 16 : 20,
                fontWeight: 800,
                color: voice.isAISpeaking
                  ? B.primary
                  : isUserTurn
                    ? G.primary
                    : C.text,
                marginBottom: showTranscript && isMobile ? 0 : 4,
                transition: "color 0.2s",
              }}
            >
              {voice.isAISpeaking
                ? "Carolina is speaking..."
                : isUserTurn
                  ? "Your turn"
                  : "Connecting..."}
            </p>
            {!(showTranscript && isMobile) && (
              <p style={{ fontSize: 14, fontWeight: 600, color: C.muted }}>
                {voice.isAISpeaking
                  ? "Your turn is next"
                  : isUserTurn
                    ? "Speak freely — tap ✓ when done"
                    : "One moment…"}
              </p>
            )}
          </div>

          {showTranscript && (
            <div
              style={{
                background: C.card,
                display: "flex",
                flexDirection: "column",
                overflow: "hidden",
                ...(isMobile
                  ? {
                      flex: 1,
                      borderTop: `1px solid ${C.border}`,
                      borderRadius: "16px 16px 0 0",
                      animation: "sheetUp 0.3s ease-out",
                    }
                  : {
                      position: "fixed",
                      top: 16,
                      right: 16,
                      bottom: 16,
                      width: 420,
                      zIndex: 30,
                      border: `1px solid ${C.border}`,
                      borderRadius: 16,
                      boxShadow: "0 8px 24px rgba(0,0,0,0.08)",
                      animation: "sheetSlideRight 0.3s ease-out",
                    }),
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "12px 16px",
                  borderBottom: `1px solid ${C.border}`,
                }}
              >
                <span
                  style={{
                    fontSize: 12,
                    fontWeight: 800,
                    color: C.muted,
                    textTransform: "uppercase",
                    letterSpacing: 1,
                  }}
                >
                  Transcript
                </span>
                <button
                  onClick={() => setShowTranscript(false)}
                  style={{
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    fontSize: 13,
                    fontWeight: 800,
                    color: B.primary,
                    display: "flex",
                    alignItems: "center",
                    gap: 4,
                    padding: "4px 0",
                  }}
                >
                  HIDE ✕
                </button>
              </div>

              <div
                style={{
                  flex: 1,
                  overflowY: "auto",
                  padding: "12px 16px",
                  display: "flex",
                  flexDirection: "column",
                  gap: 12,
                }}
              >
                {voice.transcript.map((msg, i) => {
                  const isUser = msg.role === "user";
                  const isFirstInSequence =
                    i === 0 || voice.transcript[i - 1].role !== msg.role;

                  return (
                    <div
                      key={i}
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        alignItems: isUser ? "flex-end" : "flex-start",
                      }}
                    >
                      {!isUser && isFirstInSequence && (
                        <span
                          style={{
                            fontSize: 11,
                            fontWeight: 700,
                            color: C.muted,
                            marginBottom: 4,
                          }}
                        >
                          Carolina
                        </span>
                      )}

                      <div
                        style={{
                          maxWidth: "80%",
                          padding: "10px 14px",
                          borderRadius: 16,
                          background: isUser ? C.accent : "#F1F3F4",
                          color: isUser ? "#fff" : C.text,
                          fontSize: 14,
                          fontWeight: 600,
                          lineHeight: 1.5,
                          borderBottomRightRadius: isUser ? 4 : 16,
                          borderBottomLeftRadius: isUser ? 16 : 4,
                        }}
                      >
                        {msg.text}
                      </div>

                      {isUser && isFirstInSequence && (
                        <span
                          style={{
                            fontSize: 11,
                            fontWeight: 700,
                            color: C.muted,
                            marginTop: 4,
                          }}
                        >
                          Iulian
                        </span>
                      )}
                    </div>
                  );
                })}
                {/* Live interim transcript while user is speaking. Persists
                    across Deepgram endpointing breaks so the bubble doesn't
                    flicker between phrases. */}
                {voice.liveUserText && (
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
                    <div
                      style={{
                        maxWidth: "80%",
                        padding: "10px 14px",
                        borderRadius: 16,
                        background: C.accent,
                        opacity: 0.7,
                        color: "#fff",
                        fontSize: 14,
                        fontWeight: 600,
                        fontStyle: "italic",
                        lineHeight: 1.5,
                        borderBottomRightRadius: 4,
                      }}
                    >
                      {voice.liveUserText}
                    </div>
                  </div>
                )}
                <div ref={transcriptEndRef} />
              </div>
            </div>
          )}

          <div
            style={{
              position: "relative",
              padding: "16px 20px 32px",
              textAlign: "center",
              paddingBottom: "max(32px, env(safe-area-inset-bottom, 32px))",
            }}
          >
            {!showTranscript && isMobile && (
              <button
                onClick={() => setShowTranscript(true)}
                style={{
                  position: "absolute",
                  right: 20,
                  top: 8,
                  width: 44,
                  height: 44,
                  borderRadius: "50%",
                  border: `1px solid ${C.border}`,
                  background: C.card,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <ChatBubbleIcon size={20} color={C.muted} />
                {messageCount > 0 && (
                  <span
                    style={{
                      position: "absolute",
                      top: -4,
                      right: -4,
                      minWidth: 20,
                      height: 20,
                      borderRadius: "50%",
                      background: B.primary,
                      color: "#fff",
                      fontSize: 10,
                      fontWeight: 800,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      padding: "0 4px",
                    }}
                  >
                    {messageCount > 99 ? "99" : messageCount}
                  </span>
                )}
              </button>
            )}

            {isUserTurn && (
              <div style={{ marginBottom: 16, display: "flex", justifyContent: "center" }}>
                <button
                  onClick={voice.endTurn}
                  aria-label="Done speaking"
                  style={{
                    minWidth: 220,
                    padding: "14px 28px",
                    borderRadius: 999,
                    border: "none",
                    cursor: "pointer",
                    background: G.primary,
                    color: "#fff",
                    fontSize: 16,
                    fontWeight: 800,
                    fontFamily: "'Nunito', sans-serif",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 10,
                    boxShadow: "0 6px 20px rgba(52,168,83,0.35)",
                    transition: "transform 0.1s, box-shadow 0.15s",
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.boxShadow = "0 8px 24px rgba(52,168,83,0.45)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.boxShadow = "0 6px 20px rgba(52,168,83,0.35)"; }}
                >
                  <CheckCircleIcon size={20} color="#fff" />
                  Done speaking
                </button>
              </div>
            )}

            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 24,
              }}
            >
              <button
                onClick={handleEndCall}
                aria-label="End call"
                style={{
                  width: 72,
                  height: 72,
                  borderRadius: "50%",
                  border: "none",
                  cursor: "pointer",
                  background: C.error,
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  boxShadow: "0 4px 16px rgba(255,101,132,0.3)",
                  transition: "transform 0.15s",
                }}
              >
                <svg
                  width="28"
                  height="28"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#fff"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  style={{ transform: "rotate(135deg)" }}
                >
                  <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z" />
                </svg>
              </button>

              {!isMobile && (
                <button
                  onClick={() => setShowTranscript((v) => !v)}
                  aria-label={showTranscript ? "Hide transcript" : "Show transcript"}
                  style={{
                    position: "relative",
                    width: 56,
                    height: 56,
                    borderRadius: "50%",
                    border: `1px solid ${C.border}`,
                    background: showTranscript ? B.light : C.card,
                    cursor: "pointer",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    transition: "background 0.15s",
                  }}
                >
                  <ChatBubbleIcon
                    size={22}
                    color={showTranscript ? B.primary : C.muted}
                  />
                  {messageCount > 0 && (
                    <span
                      style={{
                        position: "absolute",
                        top: -2,
                        right: -2,
                        minWidth: 20,
                        height: 20,
                        borderRadius: "50%",
                        background: B.primary,
                        color: "#fff",
                        fontSize: 10,
                        fontWeight: 800,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        padding: "0 4px",
                      }}
                    >
                      {messageCount > 99 ? "99" : messageCount}
                    </span>
                  )}
                </button>
              )}
            </div>
          </div>
        </>
      )}

      {/* Error toast */}
      {voice.errorMsg && (
        <div
          style={{
            position: "fixed",
            bottom: 180,
            left: "50%",
            transform: "translateX(-50%)",
            background: C.errorLight,
            border: `1px solid ${C.error}`,
            borderRadius: 12,
            padding: "10px 16px",
            fontSize: 13,
            fontWeight: 700,
            color: "#B91C45",
            maxWidth: 340,
            textAlign: "center",
            zIndex: 30,
            boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
          }}
        >
          {voice.errorMsg}
          <button
            onClick={voice.clearError}
            style={{
              background: "none",
              border: "none",
              color: "#B91C45",
              fontWeight: 800,
              marginLeft: 8,
              cursor: "pointer",
              fontSize: 13,
            }}
          >
            ✕
          </button>
        </div>
      )}

      <style>{`
        @keyframes waveBar {
          from { height: 6px; }
          to { height: 24px; }
        }
        @keyframes orbPulse {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.05); }
        }
        @keyframes ringExpand {
          0% { transform: scale(1); opacity: 0.4; }
          100% { transform: scale(1.6); opacity: 0; }
        }
        @keyframes dotBlink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
        @keyframes sheetSlideRight {
          from { transform: translateX(100%); }
          to { transform: translateX(0); }
        }
        @keyframes sheetUp {
          from { transform: translateY(100%); }
          to { transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}

/* ---- Small helper components (subset of DialogScreen's set) ---- */

function PhoneIcon({ size = 28, color = "#fff" }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z" />
    </svg>
  );
}

function ChatBubbleIcon({ size = 20, color = "#999" }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function CheckCircleIcon({ size = 20, color = "#fff" }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
      <polyline points="22 4 12 14.01 9 11.01" />
    </svg>
  );
}
