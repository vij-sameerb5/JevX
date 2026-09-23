// POSITIVE: classic if/else intent router on a user message.
import { refundFlow, billingFlow, supportFlow, fallbackFlow } from "./flows";

export function routeMessage(message: string) {
  const text = message.toLowerCase().trim();

  if (text.includes("refund") || text.includes("money back")) {
    return refundFlow();
  } else if (text.includes("invoice") || text.includes("charged twice")) {
    return billingFlow();
  } else if (text.includes("help") || text.includes("not working")) {
    return supportFlow();
  } else {
    return fallbackFlow();
  }
}
