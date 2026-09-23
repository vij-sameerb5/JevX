// Caught-error handling: the text being matched is written by a library or the app itself,
// not by a person. Brittle, but the fix is error codes/types — not a semantic AI call.
// Pattern taken from a real app (GlobalCare checkout, 2026-09-19).
declare function sendTransaction(tx: unknown): Promise<{ hash: string }>;
declare function setError(message: string): void;

export async function pay(tx: unknown) {
  try {
    await sendTransaction(tx);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Payment failed.";
    if (/User rejected|rejected the request|denied/i.test(msg)) {
      setError("You cancelled the transaction — nothing was charged.");
    } else if (/timed out|timeout/i.test(msg)) {
      setError("The transaction was not confirmed in time.");
    } else if (/insufficient|balance|exceeds|funds/i.test(msg)) {
      setError("Not enough funds in your wallet.");
    } else {
      setError(msg);
    }
  }
}

export function retryable(err: Error): boolean {
  const message = err.message.toLowerCase();
  return message.includes("network error") || message.includes("rate limit") || message.includes("try again later");
}

export function loadProfile(id: string) {
  return fetch(`/api/profile/${id}`).catch((error) => {
    const text = String(error);
    if (text.includes("connection refused") || text.includes("not found") || text.includes("service unavailable")) {
      return null;
    }
    throw error;
  });
}
