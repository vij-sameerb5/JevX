// Negatives: text *processing*, not text *classification*.

export function escapeHtml(input: string): string {
  return input.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function renderInline(markdown: string): string {
  if (markdown.startsWith("# ")) return `<h1>${markdown.slice(2)}</h1>`;
  if (markdown.startsWith("## ")) return `<h2>${markdown.slice(3)}</h2>`;
  if (markdown.startsWith("> ")) return `<blockquote>${markdown.slice(2)}</blockquote>`;
  return `<p>${markdown}</p>`;
}

export function truncate(text: string, max = 140): string {
  return text.length > max ? text.slice(0, max - 1) + "…" : text;
}

export function wordCount(content: string): number {
  return content.trim().split(/\s+/).filter(Boolean).length;
}
