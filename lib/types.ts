export type Fact = { id: string; question: string; answer: string };

export type Contact = {
  id: string;
  name: string;
  relation: string;
  phone: string;
  facts: Fact[];
};

export const TACTICS = [
  "urgency",
  "secrecy",
  "payment",
  "authority",
  "emotional",
] as const;
export type Tactic = (typeof TACTICS)[number];

export type Analysis = {
  tactics: { tactic: Tactic; evidence: string }[];
  risk: number; // 0-100
  summary: string;
  source: "llm" | "offline";
};

export type Challenge = {
  factId: string;
  question: string;
  source: "llm" | "offline";
};

export type ScoreResult = {
  result: "match" | "partial" | "wrong" | "evasive";
  reason: string;
  source: "llm" | "offline";
};

export type Verdict = "safe" | "suspicious" | "scam";
