// A tiny diagram-language lexer. Matches *source code*, not human text.
const KEYWORDS = ["graph", "subgraph", "end", "click", "style", "class", "direction"];
const KEYWORD_RE = /^(graph|subgraph|end|click|style|classDef|direction)\b/;

export function tokenize(input: string) {
  const tokens: { type: string; value: string }[] = [];
  for (const raw of input.split(/\s+/)) {
    if (KEYWORDS.includes(raw)) tokens.push({ type: "keyword", value: raw });
    else if (raw.startsWith("%%")) tokens.push({ type: "comment", value: raw });
    else if (KEYWORD_RE.test(raw)) tokens.push({ type: "keyword", value: raw });
    else tokens.push({ type: "ident", value: raw });
  }
  return tokens;
}

export function directionOf(text: string): string {
  if (text.includes("graph TD")) return "top-down";
  if (text.includes("graph LR")) return "left-right";
  if (text.includes("graph BT")) return "bottom-top";
  return "top-down";
}

const SQL = /\b(select|from|where|join|group by|order by|insert|update|delete)\b/gi;
export function highlightSql(query: string): string {
  return query.replace(SQL, (m) => m.toUpperCase());
}
