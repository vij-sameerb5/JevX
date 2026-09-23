export type Team = "billing" | "technical" | "account" | "general";
export type Priority = "urgent" | "normal" | "low";
export type Plan = "free" | "pro" | "enterprise";

export interface Ticket {
  id: string;
  subject: string;
  body: string;
  channel: "email" | "chat";
  plan: Plan;
}
