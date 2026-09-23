import type { Priority, Ticket } from "./types.js";

/** How urgently the ticket needs a human. */
export function priorityOf(t: Ticket): Priority {
  const text = `${t.subject} ${t.body}`.toLowerCase();
  const exclamations = (t.body.match(/!/g) ?? []).length;
  if (/\b(urgent|asap|immediately|down|outage|can't access|cannot access)\b/.test(text)) return "urgent";
  if (exclamations >= 3 || t.subject === t.subject.toUpperCase()) return "urgent";
  if (/\b(when you can|no rush|just wondering|feedback|suggestion)\b/.test(text)) return "low";
  return "normal";
}
