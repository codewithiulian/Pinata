import { useState, useRef, useEffect } from "react";

const SILENT_MP3 =
  "data:audio/mp3;base64,SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4Ljc2LjEwMAAAAAAAAAAAAAAA//tQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWGluZwAAAA8AAAACAAABhgC7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7//////////////////////////////////////////////////////////////////8AAAAATGF2YzU4LjEzAAAAAAAAAAAAAAAAJAAAAAAAAAAAAYYoRBqSAAAAAAAAAAAAAAAAAAAA//tQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWGluZwAAAA8AAAACAAABhgC7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7//////////////////////////////////////////////////////////////////8AAAAATGF2YzU4LjEzAAAAAAAAAAAAAAAAJAAAAAAAAAAAAYYoRBqSAAAAAAAAAAAAAAAAAAAA";

export function useNormalMode(currentUnit) {
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [messages, setMessages] = useState([]);
  const [correction, setCorrection] = useState(null);
  const [error, setError] = useState(null);

  const recorderRef = useRef(null);
  const chunksRef = useRef([]);
  const streamRef = useRef(null);
  const audioElRef = useRef(null);
  const unlockedRef = useRef(false);
  const messagesRef = useRef([]);
  const unitRef = useRef(currentUnit);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);
  useEffect(() => {
    unitRef.current = currentUnit;
  }, [currentUnit]);

  const getAudio = () => {
    if (!audioElRef.current) audioElRef.current = new Audio();
    return audioElRef.current;
  };

  const unlockAudio = () => {
    if (unlockedRef.current) return;
    const a = getAudio();
    a.src = SILENT_MP3;
    a.play().catch(() => {});
    unlockedRef.current = true;
  };

  const getMimeType = () => {
    if (typeof MediaRecorder === "undefined") return null;
    if (MediaRecorder.isTypeSupported("audio/mp4")) return "audio/mp4";
    if (MediaRecorder.isTypeSupported("audio/webm")) return "audio/webm";
    if (MediaRecorder.isTypeSupported("audio/webm;codecs=opus"))
      return "audio/webm;codecs=opus";
    return null;
  };

  const processPipeline = async (blob, mimeType) => {
    try {
      // STT
      const contentType = mimeType.split(";")[0];
      const sttRes = await fetch("/api/stt", {
        method: "POST",
        headers: { "Content-Type": contentType },
        body: blob,
      });
      const sttData = await sttRes.json();
      if (!sttRes.ok || !sttData.text) {
        setError(sttData.error || "Could not transcribe audio.");
        setIsProcessing(false);
        return;
      }

      const updated = [
        ...messagesRef.current,
        { role: "user", text: sttData.text },
      ];
      setMessages(updated);

      // Chat
      const chatHistory = updated.map((m) => ({
        role: m.role === "assistant" ? "assistant" : "user",
        content: m.text,
      }));
      const chatRes = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: chatHistory,
          unitContext: unitRef.current,
        }),
      });
      const chatData = await chatRes.json();
      if (!chatRes.ok || !chatData.reply) {
        setError(chatData.error || "Could not get response.");
        setIsProcessing(false);
        return;
      }

      setMessages((prev) => [
        ...prev,
        { role: "assistant", text: chatData.reply },
      ]);
      setCorrection(chatData.correction || null);

      // TTS
      const ttsRes = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: chatData.reply }),
      });
      if (ttsRes.ok) {
        const audioBlob = await ttsRes.blob();
        const url = URL.createObjectURL(audioBlob);
        const a = getAudio();
        a.src = url;
        a.play().catch(() => {});
      }

      setIsProcessing(false);
    } catch {
      setError("Something went wrong. Please try again.");
      setIsProcessing(false);
    }
  };

  const startRecording = async () => {
    setError(null);
    unlockAudio();

    const mimeType = getMimeType();
    if (!mimeType) {
      setError("Your browser doesn't support audio recording.");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const recorder = new MediaRecorder(stream, { mimeType });
      recorderRef.current = recorder;
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: mimeType });
        stream.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        processPipeline(blob, mimeType);
      };

      recorder.start();
      setIsRecording(true);
    } catch (e) {
      if (e.name === "NotAllowedError") {
        setError(
          "Microphone access denied. Please enable it in your device settings."
        );
      } else {
        setError("Could not access microphone.");
      }
    }
  };

  const stopRecording = () => {
    if (recorderRef.current?.state === "recording") {
      recorderRef.current.stop();
      setIsRecording(false);
      setIsProcessing(true);
    }
  };

  const handleMicTap = () => {
    if (isProcessing) return;
    if (isRecording) stopRecording();
    else startRecording();
  };

  const reset = () => {
    setMessages([]);
    setCorrection(null);
    setError(null);
    setIsRecording(false);
    setIsProcessing(false);
    if (recorderRef.current?.state === "recording") {
      recorderRef.current.stop();
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
  };

  const clearError = () => setError(null);

  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }
    };
  }, []);

  return {
    isRecording,
    isProcessing,
    messages,
    correction,
    error,
    handleMicTap,
    clearError,
    reset,
  };
}
