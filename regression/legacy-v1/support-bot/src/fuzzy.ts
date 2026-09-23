// POSSIBLE: fuzzy match of a query against canned intents.
import leven from "leven";

const INTENTS = ["cancel subscription", "change password", "update billing", "talk to human"];

export function closestIntent(query: string) {
  const q = query.toLowerCase();
  let best = INTENTS[0];
  let bestScore = Infinity;
  for (const intent of INTENTS) {
    const d = leven(q, intent);
    if (d < bestScore) {
      bestScore = d;
      best = intent;
    }
  }
  return best;
}
