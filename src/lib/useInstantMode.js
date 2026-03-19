import { useState, useRef, useEffect } from "react";

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i++)
    binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function base64ToArrayBuffer(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

function pcm16ToFloat32(buffer) {
  const int16 = new Int16Array(buffer);
  const float32 = new Float32Array(int16.length);
  for (let i = 0; i < int16.length; i++) float32[i] = int16[i] / 32768;
  return float32;
}

export function useInstantMode() {
  const [isSessionActive, setIsSessionActive] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isAISpeaking, setIsAISpeaking] = useState(false);
  const [transcript, setTranscript] = useState([]);
  const [sessionDuration, setSessionDuration] = useState(0);
  const [error, setError] = useState(null);

  const wsRef = useRef(null);
  const audioCtxRef = useRef(null);
  const micStreamRef = useRef(null);
  const nodesRef = useRef([]);
  const timerRef = useRef(null);
  const nextPlayTimeRef = useRef(0);
  const activeSourcesRef = useRef([]);
  const pendingTextRef = useRef("");
  const connectingRef = useRef(false); // sync guard against rapid clicks
  const setupDoneRef = useRef(false);

  const clearPlayback = () => {
    for (const s of activeSourcesRef.current) {
      try {
        s.stop();
      } catch {}
    }
    activeSourcesRef.current = [];
    nextPlayTimeRef.current = 0;
  };

  const cleanup = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (wsRef.current) {
      const ws = wsRef.current;
      wsRef.current = null;
      // Remove handlers before closing to prevent re-entrant cleanup
      ws.onclose = null;
      ws.onerror = null;
      ws.onmessage = null;
      try {
        ws.close(1000);
      } catch {}
    }
    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach((t) => t.stop());
      micStreamRef.current = null;
    }
    for (const node of nodesRef.current) {
      try {
        node.disconnect();
      } catch {}
    }
    nodesRef.current = [];
    clearPlayback();
    if (audioCtxRef.current) {
      try {
        audioCtxRef.current.close();
      } catch {}
      audioCtxRef.current = null;
    }
    pendingTextRef.current = "";
    connectingRef.current = false;
    setupDoneRef.current = false;
    setIsConnecting(false);
    setIsSessionActive(false);
    setIsAISpeaking(false);
  };

  const playPCMChunk = (base64Data, mimeType) => {
    const ctx = audioCtxRef.current;
    if (!ctx || ctx.state === "closed") return;

    const buffer = base64ToArrayBuffer(base64Data);
    const float32 = pcm16ToFloat32(buffer);

    const rateMatch = mimeType?.match(/rate=(\d+)/);
    const rate = rateMatch ? parseInt(rateMatch[1]) : 24000;

    const audioBuffer = ctx.createBuffer(1, float32.length, rate);
    audioBuffer.copyToChannel(float32, 0);

    const source = ctx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(ctx.destination);

    const now = ctx.currentTime;
    const startTime = Math.max(now + 0.01, nextPlayTimeRef.current);
    source.start(startTime);
    nextPlayTimeRef.current = startTime + audioBuffer.duration;

    activeSourcesRef.current.push(source);
    source.onended = () => {
      activeSourcesRef.current = activeSourcesRef.current.filter(
        (s) => s !== source
      );
    };
  };

  const handleMessage = (data) => {
    let msg;
    try {
      msg = JSON.parse(data);
    } catch {
      return;
    }

    if (msg.serverContent) {
      const { modelTurn, turnComplete, interrupted } = msg.serverContent;

      if (modelTurn?.parts) {
        setIsAISpeaking(true);
        for (const part of modelTurn.parts) {
          if (part.inlineData?.data) {
            playPCMChunk(part.inlineData.data, part.inlineData.mimeType);
          }
          if (part.text) {
            pendingTextRef.current += part.text;
          }
        }
      }

      if (turnComplete) {
        setIsAISpeaking(false);
        if (pendingTextRef.current) {
          const text = pendingTextRef.current;
          pendingTextRef.current = "";
          setTranscript((prev) => [...prev, { role: "model", text }]);
        }
      }

      if (interrupted) {
        setIsAISpeaking(false);
        clearPlayback();
        if (pendingTextRef.current) {
          const text = pendingTextRef.current + "...";
          pendingTextRef.current = "";
          setTranscript((prev) => [...prev, { role: "model", text }]);
        }
      }
    }

    // User speech transcript (if Gemini provides it)
    if (msg.serverContent?.inputTranscript) {
      setTranscript((prev) => [
        ...prev,
        { role: "user", text: msg.serverContent.inputTranscript },
      ]);
    }
  };

  const setupMicStreaming = async (audioCtx, micStream, ws) => {
    const source = audioCtx.createMediaStreamSource(micStream);
    nodesRef.current.push(source);

    const silentGain = audioCtx.createGain();
    silentGain.gain.value = 0;
    silentGain.connect(audioCtx.destination);
    nodesRef.current.push(silentGain);

    const sendPCM = (buffer) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(
          JSON.stringify({
            realtimeInput: {
              audio: {
                data: arrayBufferToBase64(buffer),
                mimeType: "audio/pcm;rate=16000",
              },
            },
          })
        );
      }
    };

    try {
      await audioCtx.audioWorklet.addModule("/pcm-processor.js");
      const worklet = new AudioWorkletNode(audioCtx, "pcm-processor");
      nodesRef.current.push(worklet);

      worklet.port.onmessage = (e) => sendPCM(e.data);

      source.connect(worklet);
      worklet.connect(silentGain);
    } catch {
      const processor = audioCtx.createScriptProcessor(4096, 1, 1);
      nodesRef.current.push(processor);
      const ratio = audioCtx.sampleRate / 16000;
      let readIdx = 0;

      processor.onaudioprocess = (e) => {
        const input = e.inputBuffer.getChannelData(0);
        const output = [];

        while (readIdx < input.length - 1) {
          const idx = Math.floor(readIdx);
          const frac = readIdx - idx;
          const sample =
            input[idx] * (1 - frac) +
            input[Math.min(idx + 1, input.length - 1)] * frac;
          const s = Math.max(-1, Math.min(1, sample));
          output.push(s < 0 ? s * 0x8000 : s * 0x7fff);
          readIdx += ratio;
        }
        readIdx -= input.length;
        if (readIdx < 0) readIdx = 0;

        if (output.length > 0) {
          sendPCM(new Int16Array(output).buffer);
        }
      };

      source.connect(processor);
      processor.connect(silentGain);
    }
  };

  const startSession = async (unitContext) => {
    // Sync guard: prevents multiple concurrent startSession calls
    if (connectingRef.current || wsRef.current) return;
    connectingRef.current = true;
    setupDoneRef.current = false;
    setIsConnecting(true);
    setError(null);
    setTranscript([]);
    setSessionDuration(0);
    setIsAISpeaking(false);
    pendingTextRef.current = "";

    try {
      const configRes = await fetch("/api/gemini-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ unitContext }),
      });
      const config = await configRes.json();
      if (!configRes.ok) {
        setError(config.error || "Failed to start session.");
        connectingRef.current = false;
        setIsConnecting(false);
        return;
      }

      // AudioContext (on user gesture for iOS)
      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      audioCtxRef.current = audioCtx;
      if (audioCtx.state === "suspended") await audioCtx.resume();

      // Microphone
      const micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: { ideal: 16000 },
          channelCount: 1,
          echoCancellation: true,
        },
      });
      micStreamRef.current = micStream;

      // WebSocket
      const wsUrl = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${config.apiKey}`;
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log("[Gemini] WebSocket opened, sending setup...");
        ws.send(
          JSON.stringify({
            setup: {
              model: `models/${config.model}`,
              generationConfig: {
                responseModalities: ["AUDIO"],
                speechConfig: {
                  voiceConfig: {
                    prebuiltVoiceConfig: { voiceName: "Aoede" },
                  },
                },
              },
              systemInstruction: {
                parts: [{ text: config.systemInstruction }],
              },
            },
          })
        );
      };

      ws.onmessage = async (event) => {
        let raw = event.data;
        if (raw instanceof Blob) {
          raw = await raw.text();
        } else if (raw instanceof ArrayBuffer) {
          raw = new TextDecoder().decode(raw);
        }

        let msg;
        try {
          msg = JSON.parse(raw);
        } catch (e) {
          console.warn("[Gemini] Could not parse message:", e, raw);
          return;
        }

        if (msg.setupComplete) {
          console.log("[Gemini] Setup complete, starting mic stream...");
          setupDoneRef.current = true;
          connectingRef.current = false;
          setIsConnecting(false);
          setIsSessionActive(true);
          setupMicStreaming(audioCtx, micStream, ws);
          timerRef.current = setInterval(() => {
            setSessionDuration((d) => d + 1);
          }, 1000);
          return;
        }

        handleMessage(raw);
      };

      ws.onerror = (e) => {
        console.error("[Gemini] WebSocket error:", e);
        setError("Connection error. Please try again.");
        cleanup();
      };

      ws.onclose = (event) => {
        console.log(
          "[Gemini] WebSocket closed:",
          event.code,
          event.reason
        );
        // Only set error if we didn't close it ourselves
        if (wsRef.current !== null && event.code !== 1000) {
          if (!setupDoneRef.current) {
            setError(
              `Could not connect to Gemini (code ${event.code}). Check your API key and model name.`
            );
          } else {
            setError("Session disconnected unexpectedly.");
          }
        }
        cleanup();
      };
    } catch (e) {
      console.error("[Gemini] startSession error:", e);
      if (e.name === "NotAllowedError") {
        setError(
          "Microphone access denied. Please enable it in your device settings."
        );
      } else {
        setError("Could not start session: " + e.message);
      }
      cleanup();
    }
  };

  const endSession = () => cleanup();

  const clearError = () => setError(null);

  useEffect(() => () => cleanup(), []);

  return {
    isSessionActive,
    isConnecting,
    isAISpeaking,
    transcript,
    sessionDuration,
    error,
    startSession,
    endSession,
    clearError,
  };
}
