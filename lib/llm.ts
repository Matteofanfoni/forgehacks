// Minimal OpenAI-compatible chat client. Works with Groq, Gemini (OpenAI endpoint),
// Featherless, OpenAI, etc. Configure via LLM_API_KEY / LLM_BASE_URL / LLM_MODEL.

export const llmEnabled = () => Boolean(process.env.LLM_API_KEY);

export async function chatJSON<T>(system: string, user: string): Promise<T> {
  const base = (process.env.LLM_BASE_URL ?? "https://api.groq.com/openai/v1").replace(/\/$/, "");
  const model = process.env.LLM_MODEL ?? "llama-3.3-70b-versatile";

  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.LLM_API_KEY}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0.4,
      messages: [
        { role: "system", content: `${system}\n\nRespond with a single valid JSON object only, no prose, no code fences.` },
        { role: "user", content: user },
      ],
    }),
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`LLM ${res.status}: ${(await res.text()).slice(0, 200)}`);

  const data = await res.json();
  const text: string = data.choices?.[0]?.message?.content ?? "";
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < 0) throw new Error("LLM returned no JSON");
  return JSON.parse(text.slice(start, end + 1)) as T;
}
