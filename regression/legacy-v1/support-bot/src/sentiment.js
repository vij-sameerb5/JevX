// POSITIVE: switch over freeform text + early-return classifier.
export function reactTo(reply) {
  switch (reply.trim().toLowerCase()) {
    case "thanks":
    case "thank you":
    case "great":
      return "positive";
    case "this sucks":
    case "terrible":
      return "negative";
    default:
      return "neutral";
  }
}

export function classifyFeedback(feedback) {
  if (feedback.includes("love")) return "praise";
  if (feedback.includes("broken")) return "bug";
  if (feedback.includes("please add")) return "feature";
  return "other";
}
