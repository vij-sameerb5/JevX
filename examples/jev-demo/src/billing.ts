import type { Plan } from "./types.js";

/** SLA in hours — contractual, must stay exact. */
export function slaHours(plan: Plan): number {
  switch (plan) {
    case "enterprise":
      return 4;
    case "pro":
      return 24;
    default:
      return 72;
  }
}

/** Price of an add-on in cents — money, must stay exact. */
export function addonPrice(plan: Plan, seats: number): number {
  const perSeat = plan === "enterprise" ? 900 : plan === "pro" ? 1200 : 1500;
  const discount = seats >= 50 ? 0.8 : seats >= 10 ? 0.9 : 1;
  return Math.round(perSeat * seats * discount);
}

export function ticketNumber(id: string): string {
  return id.startsWith("T-") ? id : `T-${id.padStart(6, "0")}`;
}
