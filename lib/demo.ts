import type { Contact } from "./types";

export const DEMO_CONTACTS: Contact[] = [
  {
    id: "leo",
    name: "Leo",
    relation: "grandson",
    phone: "+1 555 0142",
    facts: [
      { id: "f1", question: "What was the name of Leo's first dog?", answer: "Biscuit" },
      { id: "f2", question: "Which month does the family always go to the lake house?", answer: "July" },
      { id: "f3", question: "What nickname does Leo call his grandmother?", answer: "Nonna Bear" },
    ],
  },
];

// Scripted lines for the demo so the video never depends on the microphone.
export const SCAMMER_SCRIPT = [
  "Grandma, it's me, Leo. I'm in trouble, please help me.",
  "I got arrested after a car accident and I need bail money right now.",
  "The lawyer says I need $2,000 in gift cards today. Please don't tell Mom, she'll be furious.",
];

export const REAL_RELATIVE_LINES = ["Hi Nonna, it's Leo. I'm just calling to say hi!"];
