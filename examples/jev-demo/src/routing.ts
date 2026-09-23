import type { Team, Ticket } from "./types.js";

const BILLING_WORDS = ["invoice", "refund", "charge", "payment", "billing", "subscription", "price"];
const TECH_WORDS = ["error", "bug", "crash", "broken", "not working", "500", "api", "timeout"];
const ACCOUNT_WORDS = ["password", "login", "log in", "2fa", "locked", "email change", "delete my account"];

/** Which team handles the ticket. Keyword guessing over what the customer wrote. */
export function routeTicket(t: Ticket): Team {
  const text = `${t.subject} ${t.body}`.toLowerCase();
  if (BILLING_WORDS.some((w) => text.includes(w))) return "billing";
  if (TECH_WORDS.some((w) => text.includes(w))) return "technical";
  if (ACCOUNT_WORDS.some((w) => text.includes(w))) return "account";
  return "general";
}
