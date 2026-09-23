// Helpdesk routing: departments and priority decided by keywords.

const DEPARTMENTS: Record<string, string[]> = {
  billing: ["invoice", "charge", "refund", "payment", "credit card"],
  technical: ["error", "crash", "bug", "not loading", "broken"],
  account: ["password", "login", "locked out", "sign in"]
};

export function departmentFor(ticket: { subject: string; description: string }): string {
  const text = `${ticket.subject} ${ticket.description}`.toLowerCase();
  for (const [dept, words] of Object.entries(DEPARTMENTS)) {
    if (words.some((w) => text.includes(w))) return dept;
  }
  return "general";
}

export function priorityFor(subject: string): "urgent" | "high" | "normal" {
  const s = subject.toLowerCase();
  if (s.includes("outage") || s.includes("down") || s.includes("asap")) return "urgent";
  if (s.includes("cannot") || s.includes("blocked")) return "high";
  return "normal";
}

export function isComplaint(feedback: string): boolean {
  return /(disappointed|unacceptable|worst|terrible service|want to cancel)/i.test(feedback);
}
