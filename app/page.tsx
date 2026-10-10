"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DEMO_CONTACTS } from "@/lib/demo";
import type { Analysis, Challenge, Contact, ScoreResult, Verdict } from "@/lib/types";

type Screen = "vault" | "call" | "verdict";
type Round = { question: string; answer: string; reply: string; score: ScoreResult };

const STORAGE_KEY = "guardian.contacts.v1";
const TACTIC_LABEL: Record<string, string> = {
  urgency: "Urgency",
  secrecy: "Secrecy",
  payment: "Payment request",
  authority: "Authority / arrest",
  emotional: "Emotional pressure",
};

const uid = () => Math.random().toString(36).slice(2, 9);

async function post<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${url} ${res.status}`);
  return res.json();
}

function computeVerdict(rounds: Round[], risk: number): Verdict {
  const failed = rounds.some((r) => r.score.result === "wrong" || r.score.result === "evasive");
  const passed = rounds.some((r) => r.score.result === "match");
  if (failed) return "scam";
  if (passed && risk < 60) return "safe";
  return "suspicious";
}

export default function Home() {
  const [screen, setScreen] = useState<Screen>("vault");
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [loaded, setLoaded] = useState(false);

  // call state
  const [transcript, setTranscript] = useState("");
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [asked, setAsked] = useState<string[]>([]);
  const [rounds, setRounds] = useState<Round[]>([]);
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState<"" | "challenge" | "score">("");
  const [listening, setListening] = useState(false);
  const [error, setError] = useState("");
  const [sim, setSim] = useState<"clone" | "clever" | "real" | null>(null);
  const [callerBusy, setCallerBusy] = useState(false);
  const [voiceOn, setVoiceOn] = useState(true);
  const [answerListening, setAnswerListening] = useState(false);

  const recRef = useRef<SpeechRecognition | null>(null);
  const scriptIdx = useRef(0);

  const contact = useMemo(() => contacts.find((c) => c.id === selectedId), [contacts, selectedId]);

  // ---- persistence (on-device only) ----
  // Hydrate from localStorage after mount (reading it during render would break SSR hydration).
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const parsed: Contact[] = raw ? JSON.parse(raw) : [];
      setContacts(parsed);
      setSelectedId(parsed[0]?.id ?? "");
    } catch {}
    setLoaded(true);
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!loaded) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(contacts));
    } catch {}
  }, [contacts, loaded]);

  // ---- live tactic analysis (debounced) ----
  useEffect(() => {
    if (screen !== "call" || !transcript.trim()) return;
    const t = setTimeout(() => {
      post<Analysis>("/api/analyze", { transcript })
        .then(setAnalysis)
        .catch(() => setError("Could not analyze the call."));
    }, 900);
    return () => clearTimeout(t);
  }, [transcript, screen]);

  // ---- speech recognition ----
  const stopListening = useCallback(() => {
    recRef.current?.stop();
    recRef.current = null;
    setListening(false);
  }, []);
  useEffect(() => () => recRef.current?.stop(), []);

  const toggleListening = () => {
    if (listening) return stopListening();
    const Ctor = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!Ctor) {
      setError("Speech recognition isn't supported in this browser. Use Chrome, or type/paste what the caller says.");
      return;
    }
    const rec = new Ctor();
    rec.continuous = true;
    rec.interimResults = false;
    rec.lang = "en-US";
    rec.onresult = (e: SpeechRecognitionEvent) => {
      let text = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) text += e.results[i][0].transcript + " ";
      }
      if (text) setTranscript((t) => (t + " " + text).trim());
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    rec.start();
    recRef.current = rec;
    setListening(true);
  };

  // ---- vault editing ----
  const updateContact = (id: string, patch: Partial<Contact>) =>
    setContacts((cs) => cs.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  const addContact = () => {
    const c: Contact = { id: uid(), name: "", relation: "", phone: "", facts: [] };
    setContacts((cs) => [...cs, c]);
    setSelectedId(c.id);
  };
  const removeContact = (id: string) => {
    setContacts((cs) => cs.filter((c) => c.id !== id));
    setSelectedId((s) => (s === id ? "" : s));
  };

  // ---- call flow ----
  const startCall = () => {
    setTranscript("");
    setAnalysis(null);
    setChallenge(null);
    setAsked([]);
    setRounds([]);
    setReply("");
    setError("");
    scriptIdx.current = 0;
    setScreen("call");
  };

  const endCall = () => {
    stopListening();
    setScreen("verdict");
  };

  const getChallenge = async () => {
    if (!contact || !contact.facts.length) return;
    setBusy("challenge");
    setError("");
    try {
      const c = await post<Challenge>("/api/challenge", {
        name: contact.name,
        relation: contact.relation,
        facts: contact.facts,
        asked,
      });
      setChallenge(c);
      setAsked((a) => [...a, c.factId]);
      setReply("");
    } catch {
      setError("Could not generate a challenge question.");
    }
    setBusy("");
  };

  const submitReply = async (text: string = reply) => {
    if (!contact || !challenge) return;
    const fact = contact.facts.find((f) => f.id === challenge.factId);
    if (!fact) return;
    setBusy("score");
    setError("");
    try {
      const score = await post<ScoreResult>("/api/score", {
        question: challenge.question,
        answer: fact.answer,
        reply: text,
      });
      setRounds((r) => [...r, { question: challenge.question, answer: fact.answer, reply: text, score }]);
      setChallenge(null);
      setReply("");
    } catch {
      setError("Could not score the answer.");
    }
    setBusy("");
  };

  // ---- Test Lab: simulated caller (so the whole flow can be tried without a phone) ----
  const speak = (text: string) => {
    if (!voiceOn || typeof speechSynthesis === "undefined") return;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1.02;
    speechSynthesis.speak(u);
  };

  const callerSpeaks = async () => {
    if (!contact || !sim) return;
    setCallerBusy(true);
    setError("");
    try {
      const out = await post<{ line: string }>("/api/caller", {
        scenario: sim,
        name: contact.name,
        relation: contact.relation,
        facts: contact.facts,
        history: transcript,
        turn: scriptIdx.current,
      });
      scriptIdx.current += 1;
      setTranscript((t) => (t + " " + out.line).trim());
      speak(out.line);
    } catch {
      setError("The simulated caller failed to respond.");
    }
    setCallerBusy(false);
  };

  const callerAnswers = async () => {
    if (!contact || !sim || !challenge) return;
    setCallerBusy(true);
    setError("");
    try {
      const out = await post<{ line: string }>("/api/caller", {
        scenario: sim,
        name: contact.name,
        relation: contact.relation,
        facts: contact.facts,
        history: transcript,
        question: challenge.question,
        turn: scriptIdx.current,
      });
      scriptIdx.current += 1;
      setReply(out.line);
      speak(out.line);
      setCallerBusy(false);
      await submitReply(out.line);
      return;
    } catch {
      setError("The simulated caller failed to respond.");
    }
    setCallerBusy(false);
  };

  // Listen once for the caller's spoken answer to the challenge question (real-call path).
  const listenForAnswer = () => {
    const Ctor = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!Ctor) {
      setError("Speech recognition isn't supported in this browser. Use Chrome, or type the answer.");
      return;
    }
    const rec = new Ctor();
    rec.continuous = false;
    rec.interimResults = false;
    rec.lang = "en-US";
    setAnswerListening(true);
    rec.onresult = (e: SpeechRecognitionEvent) => {
      const text = e.results[0]?.[0]?.transcript ?? "";
      setAnswerListening(false);
      if (text) {
        setReply(text);
        void submitReply(text);
      }
    };
    rec.onend = () => setAnswerListening(false);
    rec.onerror = () => setAnswerListening(false);
    rec.start();
  };

  const risk = analysis?.risk ?? 0;
  const verdict = computeVerdict(rounds, risk);

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 text-slate-100">
      <header className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">🛡️ Family Safe-Word Guardian</h1>
          <p className="text-sm text-slate-400">Don&apos;t trust the voice. Verify what only family would know.</p>
        </div>
        <nav className="flex gap-2 text-sm">
          <button className={tab(screen === "vault")} onClick={() => setScreen("vault")}>Vault</button>
          <button className={tab(screen === "call")} onClick={startCall} disabled={!contact?.facts.length}>New call</button>
        </nav>
      </header>

      {error && (
        <div className="mb-4 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
          {error}
        </div>
      )}

      {screen === "vault" && (
        <section className="space-y-6">
          <p className="text-sm text-slate-300">
            Add the people who might call you in an emergency, and a few private facts only they would know. Everything
            is stored <b>on this device only</b>.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {contacts.map((c) => (
              <button key={c.id} className={chip(c.id === selectedId)} onClick={() => setSelectedId(c.id)}>
                {c.name || "New contact"}
              </button>
            ))}
            <button className={chip(false)} onClick={addContact}>+ Add person</button>
            {contacts.length === 0 && (
              <button className="rounded-full bg-emerald-500 px-3 py-1 text-sm font-medium text-slate-900" onClick={() => { setContacts(DEMO_CONTACTS); setSelectedId(DEMO_CONTACTS[0].id); }}>
                Load demo family
              </button>
            )}
          </div>

          {contact && (
            <div className="space-y-4 rounded-xl border border-slate-700 bg-slate-900/60 p-4">
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Name" value={contact.name} onChange={(v) => updateContact(contact.id, { name: v })} />
                <Field label="Relation" value={contact.relation} onChange={(v) => updateContact(contact.id, { relation: v })} />
                <Field label="Saved phone (for callback)" value={contact.phone} onChange={(v) => updateContact(contact.id, { phone: v })} />
              </div>
              <div className="space-y-2">
                <h3 className="text-sm font-semibold text-slate-300">Private facts</h3>
                {contact.facts.map((f) => (
                  <div key={f.id} className="grid gap-2 sm:grid-cols-[1fr_200px_auto]">
                    <input className={input} placeholder="Question only they can answer" value={f.question}
                      onChange={(e) => updateContact(contact.id, { facts: contact.facts.map((x) => (x.id === f.id ? { ...x, question: e.target.value } : x)) })} />
                    <input className={input} placeholder="Answer" value={f.answer}
                      onChange={(e) => updateContact(contact.id, { facts: contact.facts.map((x) => (x.id === f.id ? { ...x, answer: e.target.value } : x)) })} />
                    <button className="text-slate-500 hover:text-red-400" onClick={() => updateContact(contact.id, { facts: contact.facts.filter((x) => x.id !== f.id) })}>✕</button>
                  </div>
                ))}
                <button className="text-sm text-emerald-400 hover:underline"
                  onClick={() => updateContact(contact.id, { facts: [...contact.facts, { id: uid(), question: "", answer: "" }] })}>
                  + Add fact
                </button>
              </div>
              <div className="flex justify-between pt-2">
                <button className="text-sm text-red-400 hover:underline" onClick={() => removeContact(contact.id)}>Delete person</button>
                <button className="rounded-lg bg-emerald-500 px-4 py-2 font-semibold text-slate-900 disabled:opacity-40"
                  disabled={!contact.facts.length} onClick={startCall}>
                  Someone is calling as {contact.name || "them"} →
                </button>
              </div>
            </div>
          )}
        </section>
      )}

      {screen === "call" && contact && (
        <section className="space-y-5">
          <div className="flex items-center justify-between rounded-xl border border-slate-700 bg-slate-900/60 p-4">
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-400">Caller claims to be</p>
              <p className="text-lg font-semibold">{contact.name} <span className="text-slate-400">({contact.relation})</span></p>
            </div>
            <RiskMeter risk={risk} />
          </div>

          <div className="rounded-xl border border-slate-700 bg-slate-900/60 p-4">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-300">What the caller is saying</h3>
              <button className={`rounded px-3 py-1 text-xs font-medium ${listening ? "bg-red-500 text-white" : "bg-emerald-500 text-slate-900"}`} onClick={toggleListening}>
                {listening ? "● Stop mic" : "🎙 Listen to the call"}
              </button>
            </div>
            <textarea className={`${input} h-28 w-full`} placeholder="Live transcript appears here. You can also type or paste what the caller says."
              value={transcript} onChange={(e) => setTranscript(e.target.value)} />
            <div className="mt-3 flex flex-wrap gap-2">
              {analysis?.tactics.map((t) => (
                <span key={t.tactic} title={`"${t.evidence}"`} className="rounded-full bg-red-500/20 px-3 py-1 text-xs font-medium text-red-300">
                  ⚠ {TACTIC_LABEL[t.tactic]}
                </span>
              ))}
              {analysis && !analysis.tactics.length && <span className="text-xs text-slate-400">No pressure tactics detected.</span>}
            </div>
            {analysis?.summary && <p className="mt-2 text-xs text-slate-400">{analysis.summary} <span className="opacity-60">({analysis.source === "llm" ? "AI" : "offline rules"})</span></p>}
          </div>

          {risk >= 40 && !challenge && rounds.length === 0 && (
            <div className="rounded-xl border border-red-500/50 bg-red-500/10 p-3 text-sm text-red-200">
              🚨 This call shows scam pressure tactics. <b>Don&apos;t send anything.</b> Verify the caller below before you do anything else.
            </div>
          )}

          <div className="rounded-xl border border-violet-500/40 bg-violet-500/5 p-4">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-violet-300">🧪 Test Lab — simulated caller (no phone needed)</h3>
              <label className="flex items-center gap-1 text-xs text-slate-400">
                <input type="checkbox" checked={voiceOn} onChange={(e) => setVoiceOn(e.target.checked)} /> Caller speaks aloud
              </label>
            </div>
            <div className="flex flex-wrap gap-2 text-xs">
              {([
                ["clone", "🎭 Voice-clone scammer"],
                ["clever", "🕵️ Clever bluffing scammer"],
                ["real", `✅ Real ${contact.name || "relative"}`],
              ] as const).map(([k, label]) => (
                <button key={k} className={chip(sim === k)} onClick={() => { setSim(k); scriptIdx.current = 0; }}>{label}</button>
              ))}
            </div>
            {sim && (
              <div className="mt-3 flex flex-wrap gap-2">
                <button className="rounded-lg bg-violet-500 px-3 py-2 text-sm font-semibold text-white disabled:opacity-40" onClick={callerSpeaks} disabled={callerBusy}>
                  {callerBusy ? "…" : transcript ? "Caller keeps talking" : "Caller starts talking"}
                </button>
                {challenge && (
                  <button className="rounded-lg bg-violet-500 px-3 py-2 text-sm font-semibold text-white disabled:opacity-40" onClick={callerAnswers} disabled={callerBusy || busy !== ""}>
                    Caller answers my question
                  </button>
                )}
              </div>
            )}
            <p className="mt-2 text-xs text-slate-500">
              The AI plays the caller. The scammers know nothing private about your family; the real relative does. Pick one, let them talk, ask the question, and watch the verdict.
            </p>
          </div>

          <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/5 p-4">
            <h3 className="mb-2 text-sm font-semibold text-emerald-300">Verify them</h3>
            {!challenge ? (
              <button className="rounded-lg bg-emerald-500 px-4 py-2 font-semibold text-slate-900 disabled:opacity-40" onClick={getChallenge} disabled={busy !== ""}>
                {busy === "challenge" ? "Thinking…" : rounds.length ? "Ask another question" : "Give me a question to ask"}
              </button>
            ) : (
              <div className="space-y-3">
                <p className="text-xs text-slate-400">Say this to the caller:</p>
                <p className="rounded-lg bg-slate-900 p-3 text-lg font-medium">“{challenge.question}”</p>
                <textarea className={`${input} h-16 w-full`} placeholder="Type (or paste) what the caller answered…" value={reply} onChange={(e) => setReply(e.target.value)} />
                <div className="flex flex-wrap gap-2">
                  <button className={`rounded-lg px-4 py-2 font-semibold disabled:opacity-40 ${answerListening ? "bg-red-500 text-white" : "bg-slate-100 text-slate-900"}`} onClick={listenForAnswer} disabled={busy !== "" || answerListening}>
                    {answerListening ? "● Listening for their answer…" : "🎙 Listen for their answer"}
                  </button>
                  <button className="rounded-lg bg-emerald-500 px-4 py-2 font-semibold text-slate-900 disabled:opacity-40" onClick={() => submitReply()} disabled={busy !== "" || !reply.trim()}>
                    {busy === "score" ? "Checking…" : "Check typed answer"}
                  </button>
                </div>
              </div>
            )}
            {rounds.length > 0 && (
              <ul className="mt-4 space-y-2">
                {rounds.map((r, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm">
                    <span>{r.score.result === "match" ? "✅" : r.score.result === "partial" ? "🟡" : "❌"}</span>
                    <span><b>{r.score.result.toUpperCase()}</b> — {r.score.reason}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="flex justify-end">
            <button className="rounded-lg bg-slate-100 px-4 py-2 font-semibold text-slate-900" onClick={endCall}>End call &amp; see verdict</button>
          </div>
        </section>
      )}

      {screen === "verdict" && contact && (
        <VerdictView contact={contact} verdict={verdict} risk={risk} analysis={analysis} rounds={rounds} onAgain={startCall} />
      )}
    </main>
  );
}

function VerdictView({ contact, verdict, risk, analysis, rounds, onAgain }: {
  contact: Contact; verdict: Verdict; risk: number; analysis: Analysis | null; rounds: Round[]; onAgain: () => void;
}) {
  const theme = {
    scam: { bg: "border-red-500/60 bg-red-500/10", title: "🚨 Likely a scam — hang up", text: "text-red-300" },
    suspicious: { bg: "border-amber-500/60 bg-amber-500/10", title: "⚠️ Not verified — be careful", text: "text-amber-300" },
    safe: { bg: "border-emerald-500/60 bg-emerald-500/10", title: "✅ Passed verification", text: "text-emerald-300" },
  }[verdict];
  return (
    <section className="space-y-5">
      <div className={`rounded-2xl border p-6 ${theme.bg}`}>
        <h2 className={`text-2xl font-bold ${theme.text}`}>{theme.title}</h2>
        <p className="mt-2 text-slate-200">
          {verdict === "scam" && "The caller failed or dodged a question only the real person could answer."}
          {verdict === "suspicious" && "You haven't verified this caller yet. Don't send money or share codes."}
          {verdict === "safe" && "The caller answered a private family question correctly and showed little pressure."}
        </p>
      </div>
      <div className="rounded-xl border border-slate-700 bg-slate-900/60 p-4 text-sm">
        <h3 className="mb-2 font-semibold text-slate-300">Why</h3>
        <ul className="list-disc space-y-1 pl-5 text-slate-300">
          <li>Scam pressure score: <b>{risk}/100</b></li>
          {analysis?.tactics.map((t) => (
            <li key={t.tactic}>{TACTIC_LABEL[t.tactic]} — “{t.evidence}”</li>
          ))}
          {rounds.map((r, i) => (
            <li key={i}>Challenge “{r.question}” → {r.score.result} ({r.score.reason})</li>
          ))}
          {!rounds.length && <li>No verification question was asked.</li>}
        </ul>
      </div>
      {verdict !== "safe" && (
        <div className="rounded-xl border border-slate-700 bg-slate-900/60 p-4 text-sm text-slate-200">
          <h3 className="mb-2 font-semibold">What to do now</h3>
          <ol className="list-decimal space-y-1 pl-5">
            <li>Hang up. Do not send money, gift cards or codes.</li>
            <li>
              Call {contact.name} back on the number you already have
              {contact.phone ? <> — <a className="text-emerald-400 underline" href={`tel:${contact.phone.replace(/\s/g, "")}`}>{contact.phone}</a></> : "."}
            </li>
            <li>Tell another family member. Scammers rely on secrecy.</li>
          </ol>
        </div>
      )}
      <button className="rounded-lg bg-emerald-500 px-4 py-2 font-semibold text-slate-900" onClick={onAgain}>Start another call</button>
    </section>
  );
}

function RiskMeter({ risk }: { risk: number }) {
  const color = risk >= 60 ? "bg-red-500" : risk >= 30 ? "bg-amber-400" : "bg-emerald-500";
  return (
    <div className="w-40">
      <div className="mb-1 flex justify-between text-xs text-slate-400"><span>Scam risk</span><span>{risk}</span></div>
      <div className="h-2 overflow-hidden rounded-full bg-slate-700">
        <div className={`h-full transition-all duration-500 ${color}`} style={{ width: `${risk}%` }} />
      </div>
    </div>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="block text-xs text-slate-400">
      {label}
      <input className={`${input} mt-1 w-full`} value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

const input = "rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-emerald-500 focus:outline-none";
const tab = (on: boolean) => `rounded-lg px-3 py-1.5 ${on ? "bg-slate-100 text-slate-900" : "border border-slate-600 text-slate-300 hover:bg-slate-800 disabled:opacity-40"}`;
const chip = (on: boolean) => `rounded-full border px-3 py-1 text-sm ${on ? "border-emerald-500 bg-emerald-500/20 text-emerald-200" : "border-slate-600 text-slate-300 hover:bg-slate-800"}`;
