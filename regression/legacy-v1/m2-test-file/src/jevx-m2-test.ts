// JevX M2 detector test file
// Three examples:
// 1) GOOD: deterministic logic — JevX should NOT flag it.
// 2) MEDIUM: somewhat semantic/brittle — JevX may flag it.
// 3) STRONG: clearly semantic classification — JevX SHOULD flag it.

// ------------------------------------------------------------
// 1. GOOD — deterministic logic
// No Jev needed.
// ------------------------------------------------------------
function getFileType(filename: string): string {
  if (filename.endsWith(".pdf")) return "pdf";
  if (filename.endsWith(".png")) return "image";
  if (filename.endsWith(".jpg")) return "image";
  return "unknown";
}

// ------------------------------------------------------------
// 2. MEDIUM — somewhat semantic / brittle
// This uses keywords to classify a support message.
// A small rule-based system is being used, but it may be
// intentional. JevX should investigate this candidate.
// ------------------------------------------------------------
function classifySupportMessage(message: string): string {
  const text = message.toLowerCase().trim();

  if (
    text.includes("slow") ||
    text.includes("not working") ||
    text.includes("broken")
  ) {
    return "technical";
  }

  if (
    text.includes("price") ||
    text.includes("cost") ||
    text.includes("pricing")
  ) {
    return "sales";
  }

  return "other";
}

// ------------------------------------------------------------
// 3. STRONG — clearly semantic classification
// The code is trying to understand what a person means.
// Exact keywords are unlikely to cover all possible wording.
// This is a strong Jev candidate.
// ------------------------------------------------------------
function routeCustomerMessage(message: string): string {
  const text = message.toLowerCase().trim();

  if (
    text.includes("refund") ||
    text.includes("money back") ||
    text.includes("payment returned")
  ) {
    return "refund";
  }

  if (
    text.includes("can't login") ||
    text.includes("cannot sign in") ||
    text.includes("password problem")
  ) {
    return "account_access";
  }

  if (
    text.includes("how much") ||
    text.includes("pricing") ||
    text.includes("cost")
  ) {
    return "sales";
  }

  return "other";
}

// Example inputs that demonstrate why the strong case is semantic:
// "I want my money back"             -> refund
// "Please return the payment"        -> refund
// "I can't get into my account"      -> account_access
// "How much does this cost?"         -> sales
//
// The keyword implementation above will miss many of these
// variations unless more rules are continually added.
