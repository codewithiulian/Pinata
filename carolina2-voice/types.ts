// WS message contract between the Carolina2 browser hook and this sidecar.
export type ClientMessage =
  | {
      type: "start";
      mimeType: string;
      token?: string;
      lessonContext?: string;
      systemInstruction?: string;
    }
  | {
      type: "greet";
      token?: string;
      lessonContext?: string;
      systemInstruction?: string;
    }
  | { type: "stop" }
  | { type: "cancel" };

export type ServerMessage =
  | { type: "ready" }
  | { type: "partial"; text: string; ts: number }
  | { type: "final"; text: string; ts: number }
  | { type: "user_transcript"; text: string }
  | { type: "assistant_delta"; text: string }
  | { type: "assistant_done"; text: string }
  | { type: "tts_chunk"; audio: string; track: "brain" }
  | { type: "tts_done" }
  | {
      type: "metrics";
      ttft: number;
      ttfa: number;
      perceived: number;
      total: number;
      ttsChars: number;
      sessionTtsChars: number;
      elExactSessionChars?: number;
      elCharsRemaining?: number | null;
    }
  | { type: "error"; message: string }
  | { type: "closed" };

export const STT_PATH = "/api/stt";

// Per-lesson and total caps applied to injected lesson markdown (sidecar side
// is the last line of defence; the client also caps).
export const PER_LESSON_CAP = 4000;
export const TOTAL_CONTEXT_CAP = 16000;
