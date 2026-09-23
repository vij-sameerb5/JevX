// POSITIVE: keyword list + normalization + regex on natural language.
const SPAM_WORDS = ["free money", "click here", "winner", "act now", "limited offer", "viagra"];

const URGENT = /\b(urgent|asap|immediately|right now|emergency)\b/i;

export function isSpam(comment: string): boolean {
  const lower = comment.toLowerCase();
  return SPAM_WORDS.some((word) => lower.includes(word));
}

export function priorityOf(ticketBody: string): "high" | "low" {
  if (URGENT.test(ticketBody)) {
    return "high";
  }
  return "low";
}
