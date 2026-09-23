// Secret scrubbing. Runs before code leaves the machine (TypeSafe) and before code is stored
// in the dataset. Deliberately over-eager: a false redaction costs nothing, a leaked key does.

export const REDACTED = "«redacted»";

const TOKEN_PATTERNS: RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /\b(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{10,}\b/g, // Stripe
  /\bsk-(?:proj-|ant-)?[A-Za-z0-9_-]{16,}\b/g, // OpenAI / Anthropic style
  /\btsk_[A-Za-z0-9_-]{8,}\b/g, // TypeSafe
  /\bAKIA[0-9A-Z]{16}\b/g, // AWS access key id
  /\bgh[pousr]_[A-Za-z0-9]{30,}\b/g, // GitHub
  /\bgithub_pat_[A-Za-z0-9_]{30,}\b/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g, // Slack
  /\bAIza[0-9A-Za-z_-]{35}\b/g, // Google API key
  /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g // JWT
];

/** name = "value" where the name says it is a credential. Only the value is redacted. */
const ASSIGNMENT =
  /((?:api[_-]?key|apikey|secret|token|passw(?:or)?d|pwd|private[_-]?key|client[_-]?secret|auth|credential|access[_-]?key)[\w-]*["']?\s*[:=]\s*)(["'`])([^"'`\s]{6,})\2/gi;

/** scheme://user:password@host */
const URL_PASSWORD = /(\b[a-z][a-z0-9+.-]*:\/\/[^\s:@/]+:)([^\s@/]+)(@)/gi;

/** Long opaque literals (hex ≥ 40, or mixed base64-ish ≥ 40) inside quotes. */
const OPAQUE = /(["'`])([A-Za-z0-9+/_=-]{40,})\1/g;
const looksOpaque = (s: string) => /[0-9]/.test(s) && (/^[0-9a-f]+$/i.test(s) || (/[a-z]/.test(s) && /[A-Z]/.test(s)));

export interface ScrubResult {
  text: string;
  redactions: number;
}

export function scrubSecrets(input: string): ScrubResult {
  let redactions = 0;
  let text = input;
  for (const re of TOKEN_PATTERNS) {
    text = text.replace(re, () => {
      redactions++;
      return REDACTED;
    });
  }
  text = text.replace(ASSIGNMENT, (_m, lhs: string, q: string, value: string) => {
    if (value === REDACTED) return `${lhs}${q}${value}${q}`;
    redactions++;
    return `${lhs}${q}${REDACTED}${q}`;
  });
  text = text.replace(URL_PASSWORD, (_m, a: string, _pw: string, at: string) => {
    redactions++;
    return `${a}${REDACTED}${at}`;
  });
  text = text.replace(OPAQUE, (m, q: string, s: string) => {
    if (!looksOpaque(s)) return m;
    redactions++;
    return `${q}${REDACTED}${q}`;
  });
  return { text, redactions };
}

export function containsSecret(text: string): boolean {
  return scrubSecrets(text).redactions > 0;
}
