// Chatbot intent handling.
import { refundFlow, greet, handoff, answerFaq } from "./flows";

// The blueprint's headline example: one branch, one keyword.
export function handle(message: string) {
  if (message.includes("refund")) {
    return refundFlow();
  }
  return answerFaq(message);
}

const GREETINGS = new Set(["hi", "hello", "hey", "good morning", "yo"]);

export function isGreeting(text: string): boolean {
  return GREETINGS.has(text.trim().toLowerCase());
}

export function parseConfirmation(answer: string): boolean | undefined {
  const a = answer.trim().toLowerCase();
  if (a === "yes" || a === "y" || a === "sure" || a === "ok") return true;
  if (a === "no" || a === "nope" || a === "cancel") return false;
  return undefined;
}

export function wantsHuman(userInput: string) {
  const t = userInput.toLowerCase();
  if (t.includes("talk to a human") || t.includes("real person") || t.includes("agent")) {
    return handoff();
  }
  return greet();
}
