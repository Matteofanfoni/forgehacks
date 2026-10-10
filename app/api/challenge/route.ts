import { chatJSON, llmEnabled } from "@/lib/llm";
import { offlineChallenge } from "@/lib/offline";
import type { Challenge, Fact } from "@/lib/types";

const SYSTEM = `You help someone verify whether a caller is really their relative, using a private family fact only the real relative would know.
You are given the family facts as question/answer pairs, and the ids already asked. Pick ONE fact not yet asked.
Rewrite its question as a short, warm, natural spoken question the person can say out loud on the phone, addressed to the caller.
NEVER reveal or hint at the answer. Do not mention that this is a test.
Return JSON: {"factId":"<id>","question":"<spoken question>"}.`;

export async function POST(req: Request) {
  const { name, relation, facts, asked } = (await req.json()) as {
    name: string;
    relation: string;
    facts: Fact[];
    asked: string[];
  };
  if (!facts?.length) return Response.json({ error: "no facts" }, { status: 400 });
  if (!llmEnabled()) return Response.json(offlineChallenge(facts, asked ?? []));
  try {
    const out = await chatJSON<{ factId: string; question: string }>(
      SYSTEM,
      `Caller claims to be: ${name} (${relation}).\nFacts: ${JSON.stringify(facts)}\nAlready asked: ${JSON.stringify(asked ?? [])}`,
    );
    const fact = facts.find((f) => f.id === out.factId);
    if (!fact || !out.question) throw new Error("bad challenge");
    // Safety net: never show a question that leaks the answer.
    if (out.question.toLowerCase().includes(fact.answer.toLowerCase())) throw new Error("leaked answer");
    return Response.json({ factId: fact.id, question: out.question, source: "llm" } satisfies Challenge);
  } catch (e) {
    console.error("challenge fallback:", e);
    return Response.json(offlineChallenge(facts, asked ?? []));
  }
}
