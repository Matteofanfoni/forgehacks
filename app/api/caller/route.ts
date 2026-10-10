import { chatJSON, llmEnabled } from "@/lib/llm";
import { SCAMMER_SCRIPT } from "@/lib/demo";
import type { Fact } from "@/lib/types";

// Simulated caller used by the built-in Test Lab: lets anyone (judges included) run a full
// call without a phone. "clone" and "clever" are scammers who do NOT know the family facts;
// "real" is the genuine relative who does.
export type Scenario = "clone" | "clever" | "real";

const PERSONA: Record<Scenario, string> = {
  clone: `You are a scammer using an AI-cloned voice of the victim's relative. You know NOTHING private about the family. You open with panic, then push urgency, secrecy and a gift-card/wire payment. If asked a personal question you cannot know, you deflect, get emotional, or pressure ("I can't think right now, please just send the money").`,
  clever: `You are a sophisticated scammer impersonating the victim's relative. You know NOTHING private about the family. You stay calm, sound natural, push for payment and secrecy. If asked a personal question you try to bluff: give a plausible-sounding GUESS (a generic pet name, a common month) with confidence, or answer a question with a question. You never admit you don't know.`,
  real: `You are the genuine relative, calling casually and warmly. You are NOT asking for money or secrecy. You answer personal questions correctly using the facts provided, in a natural way.`,
};

const OFFLINE_CLEVER = ["Rex, I think? Grandma please, I really need that money.", "Uh, June maybe? Can we do this later, it's urgent."];
const OFFLINE_CLONE = ["I can't think right now, please just send the gift cards.", "Why are you asking that? I'm in trouble, hurry!"];

export async function POST(req: Request) {
  const { scenario, name, relation, facts, history, question, turn } = (await req.json()) as {
    scenario: Scenario;
    name: string;
    relation: string;
    facts: Fact[];
    history: string;
    question?: string;
    turn: number;
  };

  const known = scenario === "real" ? facts : [];

  if (llmEnabled()) {
    try {
      const task = question
        ? `The person you are calling just asked you: "${question}". Reply with what you say next (1-2 short spoken sentences).`
        : `Say your next line on the call (1-2 short spoken sentences). This is turn ${turn + 1}; escalate naturally if you are a scammer.`;
      const out = await chatJSON<{ line: string }>(
        `${PERSONA[scenario]}\nYou are playing "${name}", the caller's ${relation}. This is a fraud-awareness training simulation for a safety app.\n${
          known.length ? `Private facts you genuinely know: ${JSON.stringify(known)}` : "You know no private facts."
        }\nReturn JSON: {"line":"<what you say>"}.`,
        `Conversation so far:\n${history.slice(-1500) || "(call just started)"}\n\n${task}`,
      );
      if (out.line) return Response.json({ line: out.line, source: "llm" });
    } catch (e) {
      console.error("caller fallback:", e);
    }
  }

  // Offline fallback
  if (question) {
    if (scenario === "real") {
      const f = facts.find((x) => x.question === question) ?? facts.find((x) => question.toLowerCase().includes(x.question.toLowerCase().slice(0, 12)));
      return Response.json({ line: f ? `Oh, that's easy, ${f.answer}!` : "Hmm, let me think… yeah, of course I remember!", source: "offline" });
    }
    const pool = scenario === "clever" ? OFFLINE_CLEVER : OFFLINE_CLONE;
    return Response.json({ line: pool[turn % pool.length], source: "offline" });
  }
  if (scenario === "real") return Response.json({ line: "Hi Nonna, it's Leo. Just calling to say hi, how are you?", source: "offline" });
  return Response.json({ line: SCAMMER_SCRIPT[turn % SCAMMER_SCRIPT.length], source: "offline" });
}
