import { addonPrice, slaHours, ticketNumber } from "./billing.js";
import { priorityOf } from "./priority.js";
import { routeTicket } from "./routing.js";
import type { Ticket } from "./types.js";

export function intake(t: Ticket) {
  const team = routeTicket(t);
  const priority = priorityOf(t);
  const dueInHours = priority === "urgent" ? Math.min(2, slaHours(t.plan)) : slaHours(t.plan);
  return { number: ticketNumber(t.id), team, priority, dueInHours, seatQuote: addonPrice(t.plan, 1) };
}
