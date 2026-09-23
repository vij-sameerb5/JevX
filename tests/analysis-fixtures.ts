// Tiny structural fixtures for analyzer unit tests. These are NOT dataset examples and are
// never used to measure accuracy — they pin down what each generator / triage rule does.
export const FIXTURES = {
  classify: `
export function classify(message: string) {
  const t = message.toLowerCase();
  if (t.includes("refund") || t.includes("money back")) return "refund";
  if (t.includes("invoice")) return "billing";
  return "other";
}`,
  // Same structure, different vocabulary: generators must not care about words.
  classifyRenamed: `
export function pick(x: string) {
  const t = x.toLowerCase();
  if (t.includes("alpha") || t.includes("beta gamma")) return "one";
  if (t.includes("delta")) return "two";
  return "three";
}`,
  switchMap: `
export function nextStep(state: string) {
  switch (state) {
    case "new": return "triage";
    case "blocked": return "escalate";
    case "waiting": return "remind";
    default: return "close";
  }
}`,
  enumDispatch: `
type Kind = "a" | "b" | "c";
export function colorOf(kind: Kind) {
  if (kind === "a") return "red";
  if (kind === "b") return "green";
  return "blue";
}`,
  scorer: `
export function riskScore(tx: { amount: number; country: string; newDevice: boolean }) {
  let score = 0;
  if (tx.amount > 1000) score += 30;
  if (tx.country !== "US") score += 20;
  if (tx.newDevice) score += 25;
  return score;
}`,
  selector: `
export function bestModel(models: { name: string; quality: number; cost: number }[]) {
  return models.sort((a, b) => b.quality / b.cost - a.quality / a.cost)[0];
}`,
  gate: `
export async function review(order: { total: number; flagged: boolean }, approve: () => void, reject: () => void) {
  if (order.total > 500 && order.flagged) {
    reject();
  } else {
    approve();
  }
}`,
  comparator: `
export const byAge = (a: { age: number }, b: { age: number }) => (a.age > b.age ? 1 : a.age < b.age ? -1 : a.age - b.age);`,
  caughtError: `
export async function pay(go: () => Promise<void>) {
  try {
    await go();
  } catch (e: any) {
    const msg = e.message;
    if (/rejected|denied/i.test(msg)) return "cancelled";
    if (msg.includes("timeout")) return "retry";
    return "error";
  }
  return "ok";
}`,
  lexer: `
export function kindOf(ch: string) {
  if (ch === "(") return "open";
  if (ch === ")") return "close";
  if (ch === ",") return "comma";
  return "other";
}`,
  env: `
export function mode() {
  if (process.env.NODE_ENV === "production") return "prod";
  if (process.env.NODE_ENV === "test") return "test";
  return "dev";
}`,
  keyEvent: `
export function onKey(e: KeyboardEvent, submit: () => void, cancel: () => void) {
  if (e.key === "Enter") submit();
  else if (e.key === "Escape") cancel();
  else if (e.key === "Tab") cancel();
}`,
  guardsOnly: `
export function load(id?: string) {
  if (!id) return null;
  if (id.length === 0) return null;
  return fetchIt(id);
}
declare function fetchIt(id: string): unknown;`,
  nested: `
export function outer(items: string[]) {
  const inner = (s: string) => {
    if (s.startsWith("a")) return "A";
    if (s.endsWith("z")) return "Z";
    return "-";
  };
  return items.map(inner);
}`,
  request: `
export async function handler(req: { body: { text: string } }) {
  const text = req.body.text;
  if (text.includes("cancel") || text.includes("stop")) return "unsubscribe";
  if (text.includes("help")) return "support";
  return "ignore";
}`,
  secret: `
export function client(kind: string) {
  const apiKey = "sk-live-abcdefghijklmnopqrstuvwx";
  if (kind === "fast" || kind === "cheap") return "small";
  if (kind === "smart") return "large";
  return apiKey;
}`
} as const;
