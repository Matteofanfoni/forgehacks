import type { Analysis, Challenge, Fact, ScoreResult, Tactic } from "./types";

const PATTERNS: Record<Tactic, RegExp> = {
  urgency: /\b(right now|immediately|urgent|asap|hurry|quick(ly)?|no time|before it'?s too late|today|right away)\b/i,
  secrecy: /\b(don'?t tell|do not tell|keep (it|this) (a )?secret|between us|nobody (can )?know|don'?t (call|say anything))\b/i,
  payment: /\b(gift ?cards?|wire|western union|bitcoin|crypto|transfer|bail|send (me )?(money|cash)|\$\s?\d+|\d+\s?(dollars|euros))\b/i,
  authority: /\b(police|arrest(ed)?|jail|lawyer|attorney|court|judge|hospital|accident|custody)\b/i,
  emotional: /\b(please|scared|crying|trouble|help me|i'?m in danger|only you|you'?re my last)\b/i,
};

export function offlineAnalyze(transcript: string): Analysis {
  const tactics = (Object.keys(PATTERNS) as Tactic[]).flatMap((tactic) => {
    const m = transcript.match(PATTERNS[tactic]);
    return m ? [{ tactic, evidence: m[0] }] : [];
  });
  const risk = Math.min(100, tactics.length * 22 + (tactics.some((t) => t.tactic === "payment") ? 12 : 0));
  return {
    tactics,
    risk,
    summary: tactics.length
      ? `Detected ${tactics.map((t) => t.tactic).join(", ")} pressure tactics.`
      : "No pressure tactics detected yet.",
    source: "offline",
  };
}

export function offlineChallenge(facts: Fact[], asked: string[]): Challenge {
  const pool = facts.filter((f) => !asked.includes(f.id));
  const list = pool.length ? pool : facts;
  const f = list[Math.floor(Math.random() * list.length)];
  return { factId: f.id, question: f.question, source: "offline" };
}

const norm = (s: string) =>
  s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter(Boolean);
const EVASIVE =
  /\b(don'?t remember|can'?t remember|no time|not now|just send|doesn'?t matter|why (are you|do you) ask|stop asking|forgot)\b/i;

export function offlineScore(truth: string, reply: string): ScoreResult {
  const t = norm(truth);
  const r = new Set(norm(reply));
  if (!reply.trim() || EVASIVE.test(reply)) {
    return { result: "evasive", reason: "The caller dodged or deflected the question.", source: "offline" };
  }
  const hit = t.filter((w) => r.has(w)).length;
  const ratio = t.length ? hit / t.length : 0;
  if (ratio >= 0.99) return { result: "match", reason: "The answer matches the family fact.", source: "offline" };
  if (ratio >= 0.5) return { result: "partial", reason: "The answer only partly matches.", source: "offline" };
  return { result: "wrong", reason: "The answer does not match the family fact.", source: "offline" };
}
