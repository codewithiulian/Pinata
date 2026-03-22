export async function POST(req) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return Response.json({ error: "AI not configured" }, { status: 500 });
  }

  // Auth check
  const token = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!token) return Response.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { word } = await req.json();
    if (!word || !word.trim()) {
      return Response.json({ error: "word is required" }, { status: 400 });
    }

    const systemPrompt = `You are a Spanish language expert. The user will give you a Spanish word or phrase (which may contain spelling mistakes or missing accents).

Your job:
1. Correct the word — fix any spelling errors, add proper accents/tildes. Return the corrected form.
2. Write a brief Spanish explanation (2-3 sentences, markdown formatted). Include the meaning and a short example sentence using the word in context. Use *italics* for the example sentence.
3. Write a brief English explanation (2-3 sentences, markdown formatted). Include the meaning and a short example sentence using the word in context. Use *italics* for the example sentence.

Respond ONLY with a JSON object (no markdown, no backticks):
{"corrected_word": "...", "explanation_es": "...", "explanation_en": "..."}`;

    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-5-nano",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: word.trim() },
        ],
      }),
    });

    if (!res.ok) {
      const errBody = await res.text();
      console.error("OpenAI error:", res.status, errBody);
      return Response.json(
        { error: `OpenAI error: ${res.status}` },
        { status: 502 }
      );
    }

    const data = await res.json();
    const raw = data.choices?.[0]?.message?.content || "";

    try {
      const parsed = JSON.parse(raw);
      return Response.json({
        corrected_word: parsed.corrected_word || word.trim(),
        explanation_es: parsed.explanation_es || null,
        explanation_en: parsed.explanation_en || null,
      });
    } catch {
      return Response.json(
        { error: "Failed to parse AI response" },
        { status: 502 }
      );
    }
  } catch (e) {
    return Response.json({ error: "Explain failed" }, { status: 500 });
  }
}
