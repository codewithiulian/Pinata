# Carolina2: smooth audio + strict turns + shared prompts

## What ships
1. **Smooth audio.** ElevenLabs output switched from `mp3_22050_32` to `pcm_22050`. Client decodes raw 16-bit LE PCM directly into a Float32 `AudioBuffer` — no per-chunk `decodeAudioData`, so no codec priming/padding gaps. (Bandwidth ~352 kbps vs 32 kbps; fine on any normal connection.)
2. **Strict turn mode.** Hold-to-talk replaced with the original Carolina turn flow: on call start Carolina greets first (synthetic user msg `"Hola, Carolina."`), then the user's mic auto-opens; user taps a green **Done speaking** pill to flush; loop. Hangup cancels in-flight TTS via a new `cancel` WS message.
3. **Shared voice prompts.** Carolina2 now uses the same `prompts/carolina/carolina-voice/*` markdown as the original (identity + voice-base + unit-context OR general-mode), built in Next.js and shipped to the sidecar in the WS `start`/`greet` message. This is what fixes "Carolina2 doesn't understand when I add a lesson" — the original `gemini-voice-unit-context.md` is far more directive than the sidecar's old in-process `BASE_PROMPT`. Supabase user prompt overrides also flow through.

## Files

### New
- `app/api/carolina2-prompt/route.js` — POST endpoint; reuses `buildSystemInstruction` from `app/api/gemini-session/prompt.js`. Bearer-token authed; picks up per-user prompt overrides via Supabase just like the Gemini route.

### Modified
- `src/lib/api.js` — added `fetchCarolina2Prompt(unitContext)`.
- `src/lib/carolina2/useCarolina2Voice.js`
  - PCM decode helper `pcmBase64ToAudioBuffer`; dropped `decodeAudioData` chain.
  - Third arg `systemInstructionRef`.
  - `greet()` method — sends `{type:"greet", token, lessonContext, systemInstruction}`, no mic, sets `callActiveRef=true`.
  - `endCall()` — stops local mic/playback, sends `{type:"cancel"}`, clears `callActiveRef`.
  - `start` payload now also carries `systemInstruction`.
  - `tts_done` handler: if `callActiveRef.current`, auto-fires `startTurn()` via `startTurnRef` (Promise.resolve microtask so React hasn't re-rendered yet — the old `status` closure still passes the "not recording/connecting" guard).
  - `assistant_delta` and `tts_chunk` short-circuit when `callActiveRef` is false, so post-hangup straggler chunks don't play.
- `carolina2-voice/types.ts` — `ClientMessage` gains `greet` and `cancel` variants; `start`/`greet` accept optional `systemInstruction`.
- `carolina2-voice/server.ts`
  - Stores `systemInstruction` per connection.
  - Brain Opus `system:` = client systemInstruction + `CONTINUITY_HINT` (only when reflex actually fires that turn). Falls back to legacy `buildBrainSystem` only if client didn't supply one.
  - `runTurn(text, { enableReflex })`. Greet path passes `enableReflex:false` so the opening greeting isn't prefaced by Haiku filler.
  - `greet` resets `history`, `lessonContext`, `systemInstruction` per call, pushes synthetic `"Hola, Carolina."` user message, runs the turn without Deepgram.
  - `finalizeUtterance` empty-transcript fallback: pushes Spanish nudge `(El usuario no dijo nada…)` to history and continues — mirrors original Carolina turn-mode behaviour.
  - New `cancel` message → `cancelTurn()` + `closeDeepgram()` + clears utterance/finalize state.
- `src/screens/Carolina2Screen.jsx`
  - On `startCall`: builds lesson context, then `fetchCarolina2Prompt(lessonContext)` → stored in `systemInstructionRef`. Tolerates fetch failure (sidecar fallback still works).
  - `useEffect` on `phase === "call"` (gated by `greetFiredRef`) fires `voice.greet()` once. Uses a ref-of-voice.greet to dodge useEffect dep-array churn since `voice` identity changes every render.
  - Hangup calls `voice.endCall()` and clears `greetFiredRef`.
  - Replaced hold-to-talk button with a status disc + green "✓ Done speaking" pill shown only when `status === "recording"`.

## Non-obvious decisions
- **PCM over MSE.** `MediaSource` for streaming MP3 would also fix the gap problem but has spotty iOS support; PCM is universal and the bandwidth cost is acceptable for one voice stream.
- **`history` reset on greet only.** A `start` within a call (every user turn) preserves history so context accumulates. Hangup → new call → first `greet` wipes history and re-reads `lessonContext`/`systemInstruction`, so lesson changes propagate without reconnecting the WS.
- **Synthetic `"Hola, Carolina."` is pushed to visible history.** It anchors the conversation naturally and Anthropic requires a user-first messages array.
- **`EMPTY_TURN_NUDGE` is pushed to history but NOT sent as `user_transcript`.** UI shouldn't show a fake transcript.
- **Reflex disabled on greet.** Filler before the opening "¡Hola!" sounds weird.
- **AudioContext is created inside `greet()`** so browser autoplay policy is satisfied (greet fires synchronously from the user's "Start call" click).

## Gotchas for a future agent
- `tts_done` auto-loop relies on the closure-captured `status` in `startTurn` being from BEFORE `setStatus("connecting")` lands. The microtask runs before React processes state, so the old `status === "speaking"` closure passes the guard. If you ever switch to a state-store that updates synchronously, that guard will need to read from a ref instead.
- `useCarolina2Voice` accepts `systemInstructionRef` as the 3rd arg. It's optional, but the screen always passes it now. Update both if you change the signature.
- PCM sample rate is hardcoded 22050 on both sides. Change `output_format=pcm_22050` in `server.ts` AND `PCM_SAMPLE_RATE` in `useCarolina2Voice.js` together.
- Hangup sends `cancel`, NOT `stop`. `stop` schedules `finalizeUtterance` (1.5s) and triggers a turn; that's the opposite of what hangup wants.
- The legacy `buildBrainSystem` is still imported as a fallback. If the `/api/carolina2-prompt` endpoint dies, calls will still work (with the weaker built-in prompt). Don't delete it unless you wire up a hard error path.

## Manual test
1. Restart sidecar (`cd carolina2-voice && npm run dev`) and web (`npm run dev`).
2. Open Carolina2, **start without lessons** → Carolina greets in Spanish, mic opens automatically, Done pill appears. Speak → Done → reply plays smooth (no per-second breaks). ✅
3. **Pick a lesson** → Start call → greeting references the lesson material or is at least clearly grounded; speak something tangential → Carolina weaves unit vocabulary into her reply per `gemini-voice-unit-context.md`. ✅
4. **Press Done with no speech** → Carolina elaborates with a question instead of dying silent (empty-turn nudge). ✅
5. **Hangup mid-Carolina-speech** → audio stops immediately, back to setup screen, no straggler audio. Start a new call with different lesson → new lesson context picked up (history reset). ✅

---

## Latency pass (3 s → ~1.1 s target)

User complaint: ~3 s between pressing Done and hearing Carolina. Root causes
addressed in this pass:

1. **Reflex removed.** Haiku-driven filler ("Mmm, a ver…") deleted entirely.
   No more reflex stream, reflex TTS WS, brain-audio buffer, or 1500 ms gate.
   Brain audio plays directly on first chunk. Saves the gate-vs-reflex
   coordination overhead (~200–400 ms) AND removes the second EL WS open per
   turn.
   - Server: `REFLEX_PROMPT`, `REFLEX_GATE_MS`, `elReflex`, `CONTINUITY_HINT`
     import all gone from `carolina2-voice/server.ts`.
   - `runTurn` no longer takes `enableReflex`; greet just calls `runTurn(text)`.
   - `ttfaReflex` metric dropped from `types.ts`, hook, and HUD.
   - **Dead config fields kept:** `disable_reflex` and `reflex_model` still
     live in `carolina-voice-config.ts` and the `user_carolina_voice` table so
     the Settings UI doesn't break. They are now no-ops server-side. Safe to
     drop in a follow-up migration + Settings cleanup.
2. **Finalize grace 1500 → 200 ms.** `stop` handler now calls
   `closeDeepgram()` immediately (its `Close` event fires `finalizeUtterance`)
   and uses a 200 ms safety-net timer. Saves ~1.3 s — biggest single win.
3. **TTS flush threshold 20 → 10 chars** (`TTS_FLUSH_MIN_CHARS`). Brain feeds
   ElevenLabs sooner, first audio leaves before a full clause arrives.

### Implicit warm-ping (no code)

`Carolina2Screen` invokes `useCarolina2Voice` on mount; the hook's mount
`useEffect` calls `connect()` which opens the WS to Fly. With
`auto_stop_machines='stop'` + `min_machines_running=0`, Fly's proxy holds the
upgrade while booting the machine on cold start. By the time the user picks
lessons and taps Start call, the machine is warm. **First-call cold start is
masked by lesson-selection time.** No `/health` ping or daily cron needed.

### Gotchas

- `STOP_FINALIZE_MS = 200` is a safety net. The actual finalize trigger is
  Deepgram's `Close` event firing → `finalizeUtterance` (idempotent via the
  `finalized` flag). If finals get cut off, raise this OR investigate
  Deepgram drain timing — don't ship a long blanket timer back.
- Removing the per-user `disable_reflex` toggle at the schema level means a
  migration. Defer until you also redesign the Settings UI; runtime no-op is
  fine in the meantime.
- Sub-1 s would need ElevenLabs WS persistence (pre-warm next brain WS at
  `tts_done`, or migrate to `multi-stream-input`). Not done in this pass.
