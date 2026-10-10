import { chatJSON, llmEnabled } from "@/lib/llm";
import { offlineAnalyze } from "@/lib/offline";
import { TACTICS, type Analysis } from "@/lib/types";

const SYSTEM = `You are a fraud analyst protecting people from impersonation scams (voice-clone "family emergency" calls, fake officials, etc).
Given a live transcript of a call, identify manipulation tactics from exactly this list: ${TACTICS.join(", ")}.
- urgency: pressure to act immediately
- secrecy: asking the victim not to tell others or verify
- payment: asking for gift cards, wires, crypto, cash, bail money
- authority: police, lawyer, hospital, arrest claims used as leverage
- emotional: panic, crying, pleading, guilt
Return JSON: {"tactics":[{"tactic":"<one of list>","evidence":"<short quote from transcript>"}],"risk":<0-100 integer scam likelihood from the transcript alone>,"summary":"<one short sentence>"}.
Only include tactics with real evidence. Do not invent quotes.`;

export async function POST(req: Request) {
  const { transcript } = (await req.json()) as { transcript: string };
  if (!transcript?.trim()) return Response.json(offlineAnalyze(""));
  if (!llmEnabled()) return Response.json(offlineAnalyze(transcript));
  try {
    const out = await chatJSON<Omit<Analysis, "source">>(SYSTEM, `Transcript:\n"""${transcript.slice(-3000)}"""`);
    const tactics = (out.tactics ?? []).filter((t) => (TACTICS as readonly string[]).includes(t.tactic));
    const risk = Math.max(0, Math.min(100, Math.round(Number(out.risk) || 0)));
    return Response.json({ tactics, risk, summary: out.summary ?? "", source: "llm" } satisfies Analysis);
  } catch (e) {
    console.error("analyze fallback:", e);
    return Response.json(offlineAnalyze(transcript));
  }
}
