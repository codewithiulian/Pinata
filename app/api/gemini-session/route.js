export async function POST(req) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return Response.json({ error: "Gemini not configured" }, { status: 500 });
  }

  try {
    const { unitContext } = await req.json();

    const systemInstruction = `You are a friendly Spanish conversation partner for a beginner (A1 level) learner. Have natural, simple conversations in Spanish.

Rules:
- Speak ONLY in Spanish. Keep sentences short and simple (A1 level).
- Use vocabulary and grammar from this unit context: ${unitContext || "General beginner Spanish conversation practice."}
- If the user makes a mistake, gently correct them, then continue the conversation.
- Ask follow-up questions to keep things flowing.
- If the user seems stuck, offer a simpler way to say what they're trying to say.
- Keep responses short — this is a real-time voice conversation, not a text chat.
- Be warm, encouraging, patient.`;

    return Response.json({
      apiKey,
      model: "gemini-2.5-flash-native-audio-preview-12-2025",
      systemInstruction,
    });
  } catch (e) {
    return Response.json({ error: "Failed to create session" }, { status: 500 });
  }
}
