import { chatJSON, llmEnabled } from "@/lib/llm";
import { offlineScore } from "@/lib/offline";
import type { ScoreResult } from "@/lib/types";

const SYSTEM = `You judge whether a caller's reply correctly answers a private family verification question.
Be semantic, not literal: nicknames, spelling variants, extra words and partial phrasing can still be a match ("Biscuit the beagle" matches "Biscuit").
Classify as exactly one of: match (clearly correct), partial (some correct detail but incomplete or unsure), wrong (incorrect or a guess), evasive (dodges, deflects, changes the subject, pressures to skip, or claims not to remember).
Be strict: a scammer guessing generic answers must be "wrong". Return JSON: {"result":"match|partial|wrong|evasive","reason":"<one short sentence>"}.`;

export async function POST(req: Request) {
  const { question, answer, reply } = (await req.json()) as {
    question: string;
    answer: string;
    reply: string;
  };
  if (!llmEnabled()) return Response.json(offlineScore(answer, reply));
  try {
    const out = await chatJSON<{ result: ScoreResult["result"]; reason: string }>(
      SYSTEM,
      `Question asked: ${question}\nCorrect answer: ${answer}\nCaller's reply: """${reply.slice(0, 500)}"""`,
    );
    if (!["match", "partial", "wrong", "evasive"].includes(out.result)) throw new Error("bad result");
    return Response.json({ result: out.result, reason: out.reason ?? "", source: "llm" } satisfies ScoreResult);
  } catch (e) {
    console.error("score fallback:", e);
    return Response.json(offlineScore(answer, reply));
  }
}
