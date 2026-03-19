import { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { C } from "../styles/theme";
import { useNormalMode } from "../lib/useNormalMode";
import { useInstantMode } from "../lib/useInstantMode";

// Blue accent for Instant mode
const B = {
  primary: "#4285F4",
  light: "#E8F0FE",
  dark: "#1A73E8",
  ring: "rgba(66, 133, 244, 0.12)",
};

const formatTime = (s) =>
  `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

export default function DialogScreen() {
  const navigate = useNavigate();
  const [mode, setMode] = useState("normal");
  const [currentUnit, setCurrentUnit] = useState("");
  const [availableUnits, setAvailableUnits] = useState([]);
  const [selectedUnit, setSelectedUnit] = useState("");
  const scrollRef = useRef(null);

  const normal = useNormalMode(currentUnit);
  const instant = useInstantMode();

  // Discover available units
  useEffect(() => {
    const units = [];
    (async () => {
      for (let i = 1; i <= 20; i++) {
        const num = String(i).padStart(2, "0");
        try {
          const res = await fetch(`/units/unit-${num}.txt`, { method: "HEAD" });
          if (res.ok) units.push(`unit-${num}`);
          else break;
        } catch {
          break;
        }
      }
      setAvailableUnits(units);
      if (units.length > 0) {
        setSelectedUnit(units[0]);
        const res = await fetch(`/units/${units[0]}.txt`);
        if (res.ok) setCurrentUnit(await res.text());
      }
    })();
  }, []);

  const handleUnitChange = async (unitId) => {
    setSelectedUnit(unitId);
    try {
      const res = await fetch(`/units/${unitId}.txt`);
      if (res.ok) setCurrentUnit(await res.text());
    } catch {}
  };

  const handleModeSwitch = (newMode) => {
    if (newMode === mode) return;
    if (mode === "normal" && (normal.isProcessing || normal.isRecording)) return;
    if (mode === "instant" && instant.isSessionActive) return;
    if (mode === "normal") normal.reset();
    setMode(newMode);
  };

  const handleStartInstant = () => {
    instant.startSession(currentUnit);
  };

  // Auto-scroll messages in Normal mode
  useEffect(() => {
    if (mode === "normal" && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [normal.messages, normal.correction, normal.isProcessing, mode]);

  const error = mode === "normal" ? normal.error : instant.error;
  const clearError = mode === "normal" ? normal.clearError : instant.clearError;

  const isToggleLocked =
    (mode === "normal" && (normal.isProcessing || normal.isRecording)) ||
    (mode === "instant" && (instant.isSessionActive || instant.isConnecting));

  const unitLabel = (id) => `Unit ${parseInt(id.replace("unit-", ""), 10)}`;

  return (
    <div
      className="fade-in"
      style={{
        minHeight: "100vh",
        background: C.bg,
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* Header */}
      <div
        className="safe-top"
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          zIndex: 20,
          background: C.bg,
          padding: "16px 20px 12px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
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
            <svg
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
              stroke={C.text}
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
          <h1 style={{ fontSize: 20, fontWeight: 900, color: C.text }}>
            Hablar
          </h1>
        </div>

        {/* Timer (instant active) or Unit selector */}
        {mode === "instant" && instant.isSessionActive ? (
          <div
            style={{ display: "flex", alignItems: "center", gap: 6 }}
          >
            <div
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: B.primary,
                animation: "dotBlink 1.5s infinite ease-in-out",
              }}
            />
            <span
              style={{ fontSize: 14, fontWeight: 700, color: C.text }}
            >
              {formatTime(instant.sessionDuration)}
            </span>
          </div>
        ) : (
          availableUnits.length > 0 && (
            <select
              value={selectedUnit}
              onChange={(e) => handleUnitChange(e.target.value)}
              style={{
                padding: "6px 12px",
                borderRadius: 10,
                border: `2px solid ${mode === "instant" ? B.primary : C.accent}`,
                backgroundColor: mode === "instant" ? B.primary : C.accent,
                color: "#fff",
                fontSize: 13,
                fontWeight: 700,
                fontFamily: "'Nunito', sans-serif",
                cursor: "pointer",
                appearance: "none",
                WebkitAppearance: "none",
                paddingRight: 28,
                backgroundImage: `url("data:image/svg+xml,%3Csvg width='10' height='6' viewBox='0 0 10 6' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M1 1L5 5L9 1' stroke='white' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E")`,
                backgroundRepeat: "no-repeat",
                backgroundPosition: "right 10px center",
                transition: "background 0.2s, border-color 0.2s",
              }}
            >
              {availableUnits.map((u) => (
                <option key={u} value={u}>
                  {unitLabel(u)}
                </option>
              ))}
            </select>
          )
        )}
      </div>

      {/* Header spacer */}
      <div style={{ height: 72 }} className="safe-top" />

      {/* Mode Toggle */}
      <div style={{ padding: "4px 20px 12px" }}>
        <div
          style={{
            display: "flex",
            maxWidth: 280,
            margin: "0 auto",
            borderRadius: 12,
            border: `2px solid ${C.border}`,
            overflow: "hidden",
            background: C.card,
            opacity: isToggleLocked ? 0.5 : 1,
            pointerEvents: isToggleLocked ? "none" : "auto",
            transition: "opacity 0.2s",
          }}
        >
          <button
            onClick={() => handleModeSwitch("normal")}
            style={{
              flex: 1,
              padding: "10px 0",
              border: "none",
              cursor: "pointer",
              fontSize: 14,
              fontWeight: 700,
              fontFamily: "'Nunito', sans-serif",
              background: mode === "normal" ? C.accent : "transparent",
              color: mode === "normal" ? "#fff" : C.muted,
              transition: "background 0.2s, color 0.2s",
            }}
          >
            Normal
          </button>
          <button
            onClick={() => handleModeSwitch("instant")}
            style={{
              flex: 1,
              padding: "10px 0",
              border: "none",
              cursor: "pointer",
              fontSize: 14,
              fontWeight: 700,
              fontFamily: "'Nunito', sans-serif",
              background: mode === "instant" ? B.primary : "transparent",
              color: mode === "instant" ? "#fff" : C.muted,
              transition: "background 0.2s, color 0.2s",
            }}
          >
            ⚡ Instant
          </button>
        </div>
      </div>

      {/* ============ NORMAL MODE ============ */}
      {mode === "normal" && (
        <>
          {/* Messages area */}
          <div
            ref={scrollRef}
            style={{
              flex: 1,
              overflowY: "auto",
              padding: "8px 16px 16px",
              maxWidth: 520,
              margin: "0 auto",
              width: "100%",
            }}
          >
            {normal.messages.length === 0 && !normal.isProcessing && (
              <div style={{ textAlign: "center", padding: "60px 20px" }}>
                <div style={{ fontSize: 48, marginBottom: 12, opacity: 0.8 }}>
                  🎙️
                </div>
                <p
                  style={{
                    color: C.text,
                    fontSize: 17,
                    fontWeight: 800,
                    marginBottom: 6,
                  }}
                >
                  Ready to practice!
                </p>
                <p
                  style={{
                    color: C.muted,
                    fontSize: 14,
                    fontWeight: 600,
                    lineHeight: 1.6,
                  }}
                >
                  Tap the mic and speak in Spanish.
                </p>
              </div>
            )}

            {normal.messages.map((msg, i) => (
              <div key={i} style={{ marginBottom: 12 }}>
                <div
                  style={{
                    display: "flex",
                    justifyContent:
                      msg.role === "user" ? "flex-end" : "flex-start",
                    alignItems: "flex-end",
                    gap: 8,
                  }}
                >
                  {msg.role === "assistant" && <AssistantAvatar />}
                  <div
                    style={{
                      maxWidth: "75%",
                      padding: "10px 14px",
                      borderRadius:
                        msg.role === "user"
                          ? "16px 16px 4px 16px"
                          : "16px 16px 16px 4px",
                      background: msg.role === "user" ? C.accent : C.card,
                      color: msg.role === "user" ? "#fff" : C.text,
                      fontSize: 15,
                      fontWeight: 600,
                      lineHeight: 1.5,
                      boxShadow:
                        msg.role === "assistant"
                          ? "0 1px 4px rgba(0,60,50,0.06)"
                          : "none",
                    }}
                  >
                    {msg.text}
                  </div>
                </div>

                {msg.role === "assistant" &&
                  i === normal.messages.length - 1 &&
                  normal.correction && (
                    <div
                      style={{
                        marginLeft: 40,
                        marginTop: 6,
                        padding: "6px 12px",
                        background: "#FFFBEB",
                        borderRadius: 10,
                        border: "1px solid #F5D680",
                        fontSize: 13,
                        fontWeight: 600,
                        color: "#92400E",
                        fontStyle: "italic",
                        lineHeight: 1.5,
                      }}
                    >
                      ✓ {normal.correction}
                    </div>
                  )}
              </div>
            ))}

            {/* Processing dots */}
            {normal.isProcessing && (
              <div
                style={{
                  display: "flex",
                  alignItems: "flex-end",
                  gap: 8,
                  marginBottom: 12,
                }}
              >
                <AssistantAvatar />
                <div
                  style={{
                    padding: "10px 18px",
                    borderRadius: "16px 16px 16px 4px",
                    background: C.card,
                    boxShadow: "0 1px 4px rgba(0,60,50,0.06)",
                    display: "flex",
                    gap: 4,
                    alignItems: "center",
                  }}
                >
                  {[0, 1, 2].map((i) => (
                    <div
                      key={i}
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: "50%",
                        background: C.accent,
                        opacity: 0.5,
                        animation: `dotPulse 1.2s ${i * 0.2}s infinite ease-in-out`,
                      }}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Mic button area */}
          <div
            style={{
              padding: "16px 20px 32px",
              textAlign: "center",
              paddingBottom: "max(32px, env(safe-area-inset-bottom, 32px))",
            }}
          >
            {normal.isRecording && (
              <div style={{ marginBottom: 12 }}>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "center",
                    gap: 3,
                    marginBottom: 8,
                    height: 28,
                  }}
                >
                  {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
                    <div
                      key={i}
                      style={{
                        width: 4,
                        borderRadius: 2,
                        background: C.error,
                        animation: `waveBar 0.8s ${i * 0.1}s infinite ease-in-out alternate`,
                      }}
                    />
                  ))}
                </div>
                <p
                  style={{ color: C.error, fontSize: 13, fontWeight: 700 }}
                >
                  Recording... tap to stop
                </p>
              </div>
            )}

            {!normal.isRecording && !normal.isProcessing && (
              <p
                style={{
                  color: C.muted,
                  fontSize: 13,
                  fontWeight: 600,
                  marginBottom: 12,
                }}
              >
                Tap to speak · ~3-5s response
              </p>
            )}

            <button
              onClick={normal.handleMicTap}
              disabled={normal.isProcessing}
              style={{
                width: 72,
                height: 72,
                borderRadius: "50%",
                border: "none",
                cursor: normal.isProcessing ? "default" : "pointer",
                background: normal.isRecording
                  ? C.error
                  : normal.isProcessing
                    ? C.muted
                    : C.accent,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                transition: "transform 0.15s, background 0.2s",
                transform: normal.isRecording ? "scale(1.1)" : "scale(1)",
                boxShadow: normal.isRecording
                  ? `0 0 0 8px ${C.errorLight}, 0 4px 20px rgba(255,101,132,0.3)`
                  : "0 4px 16px rgba(0,180,160,0.25)",
                opacity: normal.isProcessing ? 0.5 : 1,
              }}
            >
              {normal.isRecording ? (
                <div
                  style={{
                    width: 22,
                    height: 22,
                    borderRadius: 4,
                    background: "#fff",
                  }}
                />
              ) : normal.isProcessing ? (
                <svg
                  width="28"
                  height="28"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#fff"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  style={{ animation: "spin 1s linear infinite" }}
                >
                  <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                </svg>
              ) : (
                <MicIcon />
              )}
            </button>
          </div>
        </>
      )}

      {/* ============ INSTANT MODE ============ */}
      {mode === "instant" && (
        <>
          {!instant.isSessionActive ? (
            /* ---------- Idle / Connecting state ---------- */
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
                {/* Static orb */}
                <div
                  style={{
                    width: 120,
                    height: 120,
                    borderRadius: "50%",
                    background: B.light,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    marginBottom: 28,
                    boxShadow: `0 0 0 16px ${B.ring}, 0 0 0 32px rgba(66,133,244,0.05)`,
                    opacity: instant.isConnecting ? 0.6 : 1,
                    transition: "opacity 0.2s",
                  }}
                >
                  {instant.isConnecting ? (
                    <svg
                      width="48"
                      height="48"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke={B.primary}
                      strokeWidth="2"
                      strokeLinecap="round"
                      style={{ animation: "spin 1s linear infinite" }}
                    >
                      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                    </svg>
                  ) : (
                    <HeadphonesIcon size={48} color={B.primary} />
                  )}
                </div>
                <p
                  style={{
                    fontSize: 18,
                    fontWeight: 800,
                    color: C.text,
                    marginBottom: 6,
                  }}
                >
                  {instant.isConnecting
                    ? "Connecting..."
                    : "Start a conversation"}
                </p>
                <p
                  style={{
                    fontSize: 14,
                    fontWeight: 600,
                    color: C.muted,
                    textAlign: "center",
                    lineHeight: 1.6,
                  }}
                >
                  {instant.isConnecting
                    ? "Setting up microphone and Gemini session..."
                    : (
                      <>
                        Select a unit above and tap start.
                        <br />
                        Just speak naturally — no push-to-talk.
                      </>
                    )}
                </p>
              </div>

              <div
                style={{
                  padding: "16px 20px 32px",
                  textAlign: "center",
                  paddingBottom:
                    "max(32px, env(safe-area-inset-bottom, 32px))",
                }}
              >
                <p
                  style={{
                    color: C.muted,
                    fontSize: 13,
                    fontWeight: 600,
                    marginBottom: 12,
                  }}
                >
                  {instant.isConnecting
                    ? "Please wait..."
                    : "Tap to start session"}
                </p>
                <button
                  onClick={handleStartInstant}
                  disabled={instant.isConnecting}
                  style={{
                    width: 72,
                    height: 72,
                    borderRadius: "50%",
                    border: "none",
                    cursor: instant.isConnecting ? "default" : "pointer",
                    background: B.primary,
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    boxShadow: "0 4px 16px rgba(66,133,244,0.3)",
                    transition: "transform 0.15s",
                    opacity: instant.isConnecting ? 0.5 : 1,
                  }}
                >
                  {instant.isConnecting ? (
                    <svg
                      width="28"
                      height="28"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="#fff"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      style={{ animation: "spin 1s linear infinite" }}
                    >
                      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                    </svg>
                  ) : (
                    <HeadphonesIcon size={28} color="#fff" />
                  )}
                </button>
              </div>
            </>
          ) : (
            /* ---------- Active session ---------- */
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
                {/* Animated orb with rings */}
                <div
                  style={{
                    position: "relative",
                    width: 160,
                    height: 160,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    marginBottom: 24,
                  }}
                >
                  {/* Expanding rings */}
                  {[0, 1, 2].map((i) => (
                    <div
                      key={i}
                      style={{
                        position: "absolute",
                        width: 120,
                        height: 120,
                        borderRadius: "50%",
                        border: `2px solid ${B.primary}`,
                        opacity: 0,
                        animation: `ringExpand 2.4s ${i * 0.8}s infinite ease-out`,
                      }}
                    />
                  ))}

                  {/* Main orb */}
                  <div
                    style={{
                      width: 120,
                      height: 120,
                      borderRadius: "50%",
                      background: instant.isAISpeaking
                        ? B.primary
                        : B.light,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      animation: instant.isAISpeaking
                        ? "none"
                        : "orbPulse 3s infinite ease-in-out",
                      transition: "background 0.3s",
                      zIndex: 1,
                    }}
                  >
                    {instant.isAISpeaking ? (
                      <div
                        style={{
                          display: "flex",
                          gap: 3,
                          alignItems: "center",
                          height: 36,
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
                    ) : (
                      <HeadphonesIcon size={48} color={B.primary} />
                    )}
                  </div>
                </div>

                {/* Status text */}
                <p
                  style={{
                    fontSize: 20,
                    fontWeight: 800,
                    color: instant.isAISpeaking ? B.primary : C.text,
                    marginBottom: 4,
                    transition: "color 0.2s",
                  }}
                >
                  {instant.isAISpeaking ? "Speaking..." : "Listening..."}
                </p>
                <p
                  style={{
                    fontSize: 14,
                    fontWeight: 600,
                    color: C.muted,
                  }}
                >
                  {instant.isAISpeaking
                    ? "Interrupt anytime"
                    : "Just speak naturally"}
                </p>

                {/* Live transcript */}
                {instant.transcript.length > 0 && (
                  <div
                    style={{
                      marginTop: 24,
                      width: "100%",
                      maxWidth: 340,
                      border: `1px solid ${C.border}`,
                      borderRadius: 12,
                      padding: 12,
                      background: C.card,
                    }}
                  >
                    <p
                      style={{
                        fontSize: 11,
                        fontWeight: 700,
                        color: C.muted,
                        marginBottom: 8,
                        textTransform: "uppercase",
                        letterSpacing: 0.5,
                      }}
                    >
                      Live transcript
                    </p>
                    {instant.transcript.slice(-4).map((t, i) => (
                      <p
                        key={i}
                        style={{
                          fontSize: 14,
                          fontWeight: 600,
                          marginBottom: 4,
                          color:
                            t.role === "user" ? C.text : B.primary,
                          lineHeight: 1.5,
                        }}
                      >
                        <span style={{ fontWeight: 700 }}>
                          {t.role === "user" ? "You: " : "AI: "}
                        </span>
                        {t.text}
                      </p>
                    ))}
                  </div>
                )}
              </div>

              {/* End session button */}
              <div
                style={{
                  padding: "16px 20px 32px",
                  textAlign: "center",
                  paddingBottom:
                    "max(32px, env(safe-area-inset-bottom, 32px))",
                }}
              >
                <p
                  style={{
                    color: C.muted,
                    fontSize: 13,
                    fontWeight: 600,
                    marginBottom: 12,
                  }}
                >
                  Tap to end session
                </p>
                <button
                  onClick={instant.endSession}
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
                  {/* End call icon (rotated phone) */}
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
              </div>
            </>
          )}
        </>
      )}

      {/* Error toast */}
      {error && (
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
          {error}
          <button
            onClick={clearError}
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

      {/* Animations */}
      <style>{`
        @keyframes dotPulse {
          0%, 80%, 100% { transform: scale(0.6); opacity: 0.3; }
          40% { transform: scale(1); opacity: 1; }
        }
        @keyframes waveBar {
          from { height: 6px; }
          to { height: 24px; }
        }
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
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
      `}</style>
    </div>
  );
}

/* ---- Small helper components ---- */

function AssistantAvatar() {
  return (
    <div
      style={{
        width: 32,
        height: 32,
        borderRadius: "50%",
        background: C.accentLight,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
      }}
    >
      <MicIcon size={16} color={C.accent} strokeWidth="2" />
    </div>
  );
}

function MicIcon({ size = 28, color = "#fff", strokeWidth = "2.5" }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <line x1="12" y1="19" x2="12" y2="23" />
      <line x1="8" y1="23" x2="16" y2="23" />
    </svg>
  );
}

function HeadphonesIcon({ size = 28, color = "#fff" }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 18v-6a9 9 0 0 1 18 0v6" />
      <path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3z" />
      <path d="M3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z" />
    </svg>
  );
}
