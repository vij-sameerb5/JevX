// Content moderation written as string matching.

const BANNED = ["idiot", "stupid", "loser", "shut up", "kill yourself", "trash"];

export function isAbusive(comment: string): boolean {
  const normalized = comment.toLowerCase().replace(/[^a-z\s]/g, "");
  return BANNED.some((term) => normalized.includes(term));
}

const TOXIC_PATTERN = /\b(hate you|you suck|go away|nobody likes you)\b/i;

export function toxicity(message: string): "toxic" | "ok" {
  return TOXIC_PATTERN.test(message) ? "toxic" : "ok";
}

export function spamScore(post: { body: string }): number {
  const text = post.body.toLowerCase();
  let score = 0;
  if (text.includes("buy now")) score += 2;
  if (text.includes("free")) score += 1;
  if (text.includes("click here")) score += 2;
  if (text.includes("crypto")) score += 1;
  return score;
}

export function shouldEscalate(reviewText: string): boolean {
  const lower = reviewText.toLowerCase();
  return lower.includes("lawyer") || lower.includes("sue") || lower.includes("police");
}
