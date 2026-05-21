import { createServer } from "node:http";
import { config as loadEnv } from "dotenv";
import { WebSocketServer, WebSocket } from "ws";
import {
  createClient as createDeepgram,
  LiveTranscriptionEvents,
  type ListenLiveClient,
} from "@deepgram/sdk";
import { createClient as createSupabase } from "@supabase/supabase-js";
import Anthropic from "@anthropic-ai/sdk";
import type { ClientMessage, ServerMessage } from "./types.ts";
import { STT_PATH } from "./types.ts";
import { buildBrainSystem } from "./prompt.ts";
import {
  CAROLINA_VOICE_DEFAULTS,
  sanitiseCarolinaVoiceConfig,
  type CarolinaVoiceConfig,
} from "./carolina-voice-config.ts";

const EMPTY_TURN_NUDGE =
  "(El usuario no dijo nada. Continúa la conversación con una pregunta o un comentario breve.)";
const GREET_TRIGGER = "Hola, Carolina.";

loadEnv();

const port = Number(process.env.PORT) || 3100;
// Brain / TTS model + voice + speed live per-user in Supabase
// (table `user_carolina_voice`, RLS-gated). Fetched once on WS auth.
// Reflex (Haiku filler) was removed; `disable_reflex` and `reflex_model` are
// dead fields kept in the schema for back-compat with Settings UI.
const HISTORY_CAP = 20;
// User pressed Done; close Deepgram immediately and finalize with a small
// safety net to drain in-flight finals.
const STOP_FINALIZE_MS = 200;
// Flush partial TTS sooner — first audio chunk leaves before a full sentence.
const TTS_FLUSH_MIN_CHARS = 10;

const allowedOrigins = (process.env.CAROLINA2_ALLOWED_ORIGIN || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || "";
const supabase =
  SUPABASE_URL && SUPABASE_ANON_KEY
    ? createSupabase(SUPABASE_URL, SUPABASE_ANON_KEY)
    : null;

// Verifies the WS-supplied JWT and returns the authenticated user id, or null
// on any failure (misconfig / bad token / Supabase error). Fail-closed.
async function verifyToken(token: string | undefined): Promise<string | null> {
  if (!token) return null;
  if (!supabase) return null;
  try {
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data?.user) return null;
    return data.user.id;
  } catch {
    return null;
  }
}

// Fetches the user's carolina-voice config row using the same JWT they
// authenticated with. RLS enforces that they only ever see their own row.
// Any missing column / failed read falls back to CAROLINA_VOICE_DEFAULTS;
// every value is re-validated before use to neutralise a tampered row.
async function fetchVoiceConfig(token: string): Promise<CarolinaVoiceConfig> {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return { ...CAROLINA_VOICE_DEFAULTS };
  }
  try {
    const userClient = createSupabase(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data } = await userClient
      .from("user_carolina_voice")
      .select("voice_id, brain_model, reflex_model, tts_model, speed, disable_reflex")
      .maybeSingle();
    return sanitiseCarolinaVoiceConfig(data);
  } catch {
    return { ...CAROLINA_VOICE_DEFAULTS };
  }
}

type ChatMessage = { role: "user" | "assistant"; content: string };

function send(ws: WebSocket, msg: ServerMessage) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

const server = createServer((req, res) => {
  // Health/readiness only; this process serves no pages.
  if (req.method === "GET" && (req.url === "/" || req.url === "/health")) {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("carolina2-voice ok");
    return;
  }
  res.writeHead(404);
  res.end();
});

const wss = new WebSocketServer({
  noServer: true,
  verifyClient: (info, cb) => {
    if (allowedOrigins.length === 0) return cb(true); // dev: allow all
    const origin = info.origin || "";
    cb(allowedOrigins.includes(origin), 403, "origin not allowed");
  },
});

server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url || "/", "http://localhost");
  if (url.pathname === STT_PATH) {
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  } else {
    socket.destroy();
  }
});

wss.on("connection", (ws: WebSocket) => {
  const dgKey = process.env.DEEPGRAM_API_KEY;
  if (!dgKey) {
    send(ws, {
      type: "error",
      message: "DEEPGRAM_API_KEY is not set on the server.",
    });
    ws.close();
    return;
  }

  const deepgram = createDeepgram(dgKey);
  const history: ChatMessage[] = [];
  let sessionTtsChars = 0;
  let elBaseChars: number | null = null;
  let elCharLimit: number | null = null;

  // Set once from the first authenticated `start` / `greet`. The picked-lesson
  // markdown is chosen before the call, so it is constant for this connection.
  // `systemInstruction` is the full Carolina-voice prompt (identity + base +
  // unit-context/general-mode) built client-side via /api/carolina2-prompt.
  let authed = false;
  let lessonContext = "";
  let systemInstruction = "";
  // Per-connection config (voice id, models, speed) fetched from
  // user_carolina_voice on auth. Falls back to defaults until then.
  let voiceCfg: CarolinaVoiceConfig = { ...CAROLINA_VOICE_DEFAULTS };

  const fetchElUsage = async (
    key: string,
  ): Promise<{ used: number; limit: number } | null> => {
    try {
      const res = await fetch("https://api.elevenlabs.io/v1/user/subscription", {
        headers: { "xi-api-key": key },
      });
      if (!res.ok) return null;
      const j = (await res.json()) as {
        character_count?: number;
        character_limit?: number;
      };
      if (typeof j.character_count !== "number") return null;
      return { used: j.character_count, limit: j.character_limit ?? 0 };
    } catch {
      return null;
    }
  };
  {
    const k = process.env.ELEVENLABS_API_KEY;
    if (k) {
      fetchElUsage(k).then((u) => {
        if (u) {
          elBaseChars = u.used;
          elCharLimit = u.limit;
        }
      });
    }
  }

  let dgConn: ListenLiveClient | null = null;
  // Promise that resolves once the current dgConn fires its Open event. Reset
  // to null whenever dgConn is null. Lets startDeepgram await whatever
  // prewarmDeepgram already kicked off without re-opening a second WS.
  let dgOpenPromise: Promise<void> | null = null;
  let utteranceParts: string[] = [];
  let finalizeTimer: NodeJS.Timeout | null = null;
  let finalized = false;
  let socketClosed = false;

  type TtsHandle = {
    feed: (text: string) => void;
    endInput: () => void;
    close: () => void;
  };
  let currentAbort: AbortController | null = null;
  let elBrain: TtsHandle | null = null;

  const cancelTurn = () => {
    if (currentAbort) {
      currentAbort.abort();
      currentAbort = null;
    }
    elBrain?.close();
    elBrain = null;
  };

  const openTts = (
    voiceId: string,
    elKey: string,
    onAudio: (b64: string) => void,
    onFinal: () => void,
  ): TtsHandle => {
    const el = new WebSocket(
      `wss://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream-input` +
        `?model_id=${voiceCfg.tts_model}&output_format=pcm_22050`,
    );
    let elReady = false;
    let closed = false;
    const pending: string[] = [];

    const rawSend = (payload: object) => {
      if (el.readyState === WebSocket.OPEN) el.send(JSON.stringify(payload));
    };

    el.on("open", () => {
      elReady = true;
      rawSend({
        text: " ",
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.8,
          speed: voiceCfg.speed,
        },
        xi_api_key: elKey,
      });
      for (const p of pending) {
        rawSend(p === "" ? { text: "" } : { text: p, try_trigger_generation: true });
      }
      pending.length = 0;
    });

    el.on("message", (raw: Buffer) => {
      let payload: { audio?: string | null; isFinal?: boolean };
      try {
        payload = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (payload.audio) onAudio(payload.audio);
      if (payload.isFinal) onFinal();
    });

    el.on("error", (err: Error) => {
      send(ws, { type: "error", message: `ElevenLabs error: ${err.message}` });
    });

    return {
      feed: (text: string) => {
        if (!text) return;
        if (elReady) rawSend({ text, try_trigger_generation: true });
        else pending.push(text);
      },
      endInput: () => {
        if (elReady) rawSend({ text: "" });
        else pending.push("");
      },
      close: () => {
        if (closed) return;
        closed = true;
        try {
          el.close();
        } catch {
          // already closing
        }
      },
    };
  };

  const closeDeepgram = () => {
    if (dgConn) {
      try {
        dgConn.requestClose();
      } catch {
        // already closing
      }
      dgConn = null;
      dgOpenPromise = null;
    }
  };

  // Open the Deepgram WS without sending `ready` to the client. Called
  // anticipatorily (after assistant_done) so the WS handshake finishes during
  // Carolina's TTS playback — the next user turn finds it already open.
  // Idempotent: subsequent calls while a conn is alive are no-ops.
  const prewarmDeepgram = () => {
    if (dgConn || socketClosed) return;
    const conn = deepgram.listen.live({
      model: "nova-3",
      language: "es",
      interim_results: true,
      endpointing: 300,
      utterance_end_ms: 1000,
      vad_events: true,
      smart_format: true,
    });
    dgConn = conn;
    dgOpenPromise = new Promise<void>((resolve) => {
      conn.on(LiveTranscriptionEvents.Open, () => resolve());
    });
    conn.on(LiveTranscriptionEvents.Transcript, (data) => {
      const alt = data?.channel?.alternatives?.[0];
      const text: string = alt?.transcript ?? "";
      if (!text) return;
      if (data.is_final) {
        utteranceParts.push(text);
        send(ws, { type: "final", text, ts: Date.now() });
      } else {
        send(ws, { type: "partial", text, ts: Date.now() });
      }
    });
    conn.on(LiveTranscriptionEvents.Error, (err) => {
      send(ws, {
        type: "error",
        message:
          typeof err?.message === "string" ? err.message : "Deepgram error",
      });
    });
    conn.on(LiveTranscriptionEvents.Close, () => {
      finalizeUtterance();
    });
  };

  // Begin a user turn: reset utterance state, ensure DG is open (reusing the
  // pre-warmed conn if present), then signal `ready` to the client.
  const startDeepgram = () => {
    cancelTurn();
    if (finalizeTimer) {
      clearTimeout(finalizeTimer);
      finalizeTimer = null;
    }
    utteranceParts = [];
    finalized = false;

    if (!dgConn) prewarmDeepgram();
    const pending = dgOpenPromise;
    if (!pending) return;
    pending.then(() => {
      if (socketClosed) return;
      send(ws, { type: "ready" });
    });
  };

  const finalizeUtterance = () => {
    if (finalized) return;
    finalized = true;
    if (finalizeTimer) {
      clearTimeout(finalizeTimer);
      finalizeTimer = null;
    }
    const userText = utteranceParts.join(" ").replace(/\s+/g, " ").trim();
    utteranceParts = [];

    if (!userText) {
      // User pressed Done without speaking — keep the conversation alive
      // instead of dying silent. Don't push the nudge to visible history,
      // but Anthropic needs at least one user turn to reply.
      history.push({ role: "user", content: EMPTY_TURN_NUDGE });
      if (history.length > HISTORY_CAP)
        history.splice(0, history.length - HISTORY_CAP);
      runTurn(EMPTY_TURN_NUDGE);
      return;
    }

    history.push({ role: "user", content: userText });
    if (history.length > HISTORY_CAP)
      history.splice(0, history.length - HISTORY_CAP);
    send(ws, { type: "user_transcript", text: userText });
    runTurn(userText);
  };

  // Run a full assistant turn (Anthropic brain → ElevenLabs TTS).
  // Reflex (Haiku filler) was removed: brain audio plays directly with no
  // gate or buffer, trading a fake "mmm, a ver…" for ~700 ms less round-trip.
  const runTurn = (_userText: string) => {
    const anthropicKey = process.env.ANTHROPIC_API_KEY;
    const elKey = process.env.ELEVENLABS_API_KEY;
    const voiceId = voiceCfg.voice_id;
    if (!anthropicKey || !elKey || !voiceId) {
      send(ws, {
        type: "error",
        message:
          "Missing AI keys / voice: set ANTHROPIC_API_KEY and ELEVENLABS_API_KEY " +
          "as Fly secrets, and configure a voice in Piñata Settings.",
      });
      return;
    }

    const t0 = Date.now();
    let ttft = 0;
    let ttfa = 0;
    let perceived = 0;
    let fullText = "";
    let ttsBuffer = "";
    let turnTtsChars = 0;

    const ac = new AbortController();
    currentAbort = ac;
    const anthropic = new Anthropic({ apiKey: anthropicKey });

    const sendChunk = (audio: string) => {
      if (!perceived) perceived = Date.now() - t0;
      send(ws, { type: "tts_chunk", audio, track: "brain" });
    };

    const brain = openTts(
      voiceId,
      elKey,
      (audio) => {
        if (!ttfa) ttfa = Date.now() - t0;
        sendChunk(audio);
      },
      () => {
        send(ws, { type: "tts_done" });
        sessionTtsChars += turnTtsChars;
        brain.close();
        if (elBrain === brain) elBrain = null;

        const baseMetrics = {
          type: "metrics" as const,
          ttft,
          ttfa,
          perceived,
          total: Date.now() - t0,
          ttsChars: turnTtsChars,
          sessionTtsChars,
        };
        send(ws, baseMetrics);

        if (elKey) {
          fetchElUsage(elKey).then((u) => {
            if (!u) return;
            if (elBaseChars === null) elBaseChars = u.used;
            if (elCharLimit === null) elCharLimit = u.limit;
            send(ws, {
              ...baseMetrics,
              elExactSessionChars: Math.max(0, u.used - elBaseChars),
              elCharsRemaining:
                u.limit > 0 ? Math.max(0, u.limit - u.used) : null,
            });
          });
        }
      },
    );
    elBrain = brain;

    const maybeFlush = (force: boolean) => {
      if (force) {
        if (ttsBuffer.trim()) {
          const chunk = ttsBuffer + " ";
          turnTtsChars += chunk.length;
          brain.feed(chunk);
        }
        ttsBuffer = "";
        return;
      }
      if (/[.?!,]/.test(ttsBuffer) || ttsBuffer.length >= TTS_FLUSH_MIN_CHARS) {
        const chunk = ttsBuffer + " ";
        turnTtsChars += chunk.length;
        brain.feed(chunk);
        ttsBuffer = "";
      }
    };

    (async () => {
      try {
        const sys = systemInstruction || buildBrainSystem(lessonContext, false);
        const stream = anthropic.messages.stream(
          {
            model: voiceCfg.brain_model,
            max_tokens: 400,
            system: sys,
            messages: history.map((m) => ({
              role: m.role,
              content: m.content,
            })),
          },
          { signal: ac.signal },
        );
        stream.on("text", (delta: string) => {
          if (!ttft) {
            ttft = Date.now() - t0;
            // Carolina is replying → user turn comes next. Open the Deepgram
            // WS now so its TLS+auth handshake finishes during TTS playback;
            // by the time the client sends `start` after the audio tail, the
            // WS is already open and `ready` fires near-instantly.
            prewarmDeepgram();
          }
          fullText += delta;
          ttsBuffer += delta;
          send(ws, { type: "assistant_delta", text: delta });
          maybeFlush(false);
        });
        await stream.finalMessage();
        maybeFlush(true);
        brain.endInput();

        const finalText = fullText.trim();
        if (finalText) {
          history.push({ role: "assistant", content: finalText });
          if (history.length > HISTORY_CAP)
            history.splice(0, history.length - HISTORY_CAP);
        }
        send(ws, { type: "assistant_done", text: finalText });
      } catch (err) {
        if (ac.signal.aborted) return;
        send(ws, {
          type: "error",
          message:
            err instanceof Error ? err.message : "Anthropic stream failed",
        });
        brain.close();
      } finally {
        if (currentAbort === ac) currentAbort = null;
      }
    })();
  };

  ws.on("message", async (data: Buffer, isBinary: boolean) => {
    if (socketClosed) return;
    if (isBinary) {
      if (authed && dgConn && dgConn.getReadyState() === 1) {
        const ab = data.buffer.slice(
          data.byteOffset,
          data.byteOffset + data.byteLength,
        ) as ArrayBuffer;
        dgConn.send(ab);
      }
      return;
    }
    let msg: ClientMessage;
    try {
      msg = JSON.parse(data.toString()) as ClientMessage;
    } catch {
      return;
    }
    if (msg.type === "start" || msg.type === "greet") {
      if (!authed) {
        const token = msg.token;
        const userId = await verifyToken(token);
        if (!userId) {
          send(ws, { type: "error", message: "unauthorized" });
          ws.close();
          return;
        }
        authed = true;
        // Pull this user's voice + model config now so the very first turn
        // uses their picks, not the defaults.
        voiceCfg = await fetchVoiceConfig(token!);
      }
      if (msg.type === "greet") {
        // New call — reset per-call state and pick up the latest lesson
        // selection / system prompt the client built.
        cancelTurn();
        history.length = 0;
        lessonContext = (msg.lessonContext || "").toString();
        systemInstruction = (msg.systemInstruction || "").toString();
        history.push({ role: "user", content: GREET_TRIGGER });
        runTurn(GREET_TRIGGER);
      } else {
        // `start` is a user turn within an in-progress call. Lesson context
        // and system prompt were already set at greet; allow late-binding if
        // the client wasn't ready then.
        if (msg.systemInstruction && !systemInstruction) {
          systemInstruction = msg.systemInstruction.toString();
        }
        if (msg.lessonContext && !lessonContext) {
          lessonContext = msg.lessonContext.toString();
        }
        startDeepgram();
      }
    } else if (msg.type === "stop") {
      if (!authed) return;
      // User pressed Done. Close Deepgram immediately (its Close event fires
      // finalizeUtterance); the timer is a safety net in case Close is slow.
      closeDeepgram();
      if (finalizeTimer) clearTimeout(finalizeTimer);
      finalizeTimer = setTimeout(finalizeUtterance, STOP_FINALIZE_MS);
    } else if (msg.type === "cancel") {
      if (!authed) return;
      cancelTurn();
      closeDeepgram();
      if (finalizeTimer) {
        clearTimeout(finalizeTimer);
        finalizeTimer = null;
      }
      utteranceParts = [];
      finalized = false;
    }
  });

  ws.on("close", () => {
    socketClosed = true;
    if (finalizeTimer) clearTimeout(finalizeTimer);
    cancelTurn();
    closeDeepgram();
  });
  ws.on("error", () => {
    socketClosed = true;
    if (finalizeTimer) clearTimeout(finalizeTimer);
    cancelTurn();
    closeDeepgram();
  });
});

server.listen(port, () => {
  console.log(`> carolina2-voice ready on http://localhost:${port} (ws ${STT_PATH})`);
});
