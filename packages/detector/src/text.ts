import { Node, SyntaxKind, type Expression } from "ts-morph";

const NORMALIZERS = new Set([
  "toLowerCase",
  "toUpperCase",
  "toLocaleLowerCase",
  "toLocaleUpperCase",
  "trim",
  "trimStart",
  "trimEnd",
  "normalize"
]);

const NON_NATURAL_WORDS = new Set([
  "http", "https", "www", "px", "em", "rem", "json", "xml", "html", "css", "utf", "utf8",
  "true", "false", "null", "undefined", "get", "post", "put", "patch", "delete", "head",
  "options", "src", "dist", "node", "npm", "api", "id", "uuid", "png", "jpg", "jpeg", "gif",
  "svg", "pdf", "csv", "txt", "md", "ts", "tsx", "js", "jsx", "mjs", "cjs", "env", "dev",
  "prod", "test", "string", "number", "object", "function", "boolean", "symbol", "bigint"
]);

/** Split `userMessage`, `user_message`, `USER-MESSAGE` into lower-case tokens. */
export function nameTokens(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((t) => t.toLowerCase());
}

/** "graph TD", "mode RW": a phrase carrying an all-caps code token is a DSL, not prose. */
function hasCodeToken(v: string): boolean {
  const words = v.split(/\s+/);
  return words.length > 1 && words.some((w) => /^[A-Z]{2,4}$/.test(w));
}

/** A single natural-language word or short phrase: "refund", "money back", "can't". */
export function isWordLike(value: string): boolean {
  const v = value.trim();
  if (v.length < 2 || v.length > 60) return false;
  if (hasCodeToken(v)) return false;
  if (!/^[A-Za-z][A-Za-z' _-]*[A-Za-z]$/.test(v)) return false;
  if (/^[A-Z0-9_]+$/.test(v) && v.includes("_")) return false; // SCREAMING_CASE constant
  if (/[a-z][A-Z]/.test(v)) return false; // camelCase identifier
  if (/^[a-z]+(-[a-z]+)+$/.test(v) && !v.includes(" ")) {
    // kebab-case tokens are usually CSS classes, flags or slugs
    return false;
  }
  if (NON_NATURAL_WORDS.has(v.toLowerCase())) return false;
  return true;
}

/** Contains at least two alphabetic words separated by whitespace. */
export function isMultiWord(value: string): boolean {
  if (hasCodeToken(value.trim())) return false;
  const words = value.trim().split(/\s+/).filter((w) => /[A-Za-z]{2,}/.test(w));
  return words.length >= 2;
}

export function stringLiteralValue(node: Node | undefined): string | undefined {
  if (!node) return undefined;
  if (Node.isStringLiteral(node) || Node.isNoSubstitutionTemplateLiteral(node)) {
    return node.getLiteralValue();
  }
  return undefined;
}

export interface Unwrapped {
  expr: Node;
  normalized: boolean;
}

/** Strip parens, `!`, `as`, optional chaining and normalization calls: `(msg?.toLowerCase().trim())` → `msg`. */
export function unwrap(node: Node): Unwrapped {
  let current: Node = node;
  let normalized = false;
  for (let i = 0; i < 20; i++) {
    if (Node.isParenthesizedExpression(current) || Node.isNonNullExpression(current)) {
      current = current.getExpression();
      continue;
    }
    if (Node.isAsExpression(current) || Node.isTypeAssertion(current) || Node.isSatisfiesExpression(current)) {
      current = current.getExpression();
      continue;
    }
    if (Node.isCallExpression(current)) {
      const callee = current.getExpression();
      if (Node.isPropertyAccessExpression(callee) && NORMALIZERS.has(callee.getName())) {
        normalized = true;
        current = callee.getExpression();
        continue;
      }
      // String(x) / `${x}`
      if (Node.isIdentifier(callee) && callee.getText() === "String" && current.getArguments().length === 1) {
        current = current.getArguments()[0]!;
        continue;
      }
      // .replace(/\s+/g, " ") and friends are also normalization
      if (Node.isPropertyAccessExpression(callee) && ["replace", "replaceAll"].includes(callee.getName())) {
        normalized = true;
        current = callee.getExpression();
        continue;
      }
    }
    break;
  }
  return { expr: current, normalized };
}

/** Resolve an identifier to its variable initializer (one declaration, local project only). */
export function resolveInitializer(node: Node): Expression | undefined {
  if (!Node.isIdentifier(node)) return undefined;
  let decls: Node[];
  try {
    decls = node.getSymbol()?.getDeclarations() ?? [];
  } catch {
    return undefined;
  }
  for (const d of decls) {
    if (Node.isVariableDeclaration(d)) {
      const init = d.getInitializer();
      if (init) return init;
    }
    if (Node.isShorthandPropertyAssignment(d)) return undefined;
  }
  return undefined;
}

export interface TextJudgement {
  human: boolean;
  /** Known machine text (a caught error's message): never a match site, whatever its name. */
  machine?: boolean;
  normalized: boolean;
  /** The name that made it human text, for evidence messages. */
  via?: string;
}

const ERROR_TEXT_PROPS = new Set(["message", "stack", "reason", "shortMessage", "details"]);

/** Is this identifier the variable of a `catch (e)` clause or the first parameter of a `.catch(err => …)` callback? */
function isCaughtErrorVariable(id: Node): boolean {
  if (!Node.isIdentifier(id)) return false;
  let decls: Node[];
  try {
    decls = id.getSymbol()?.getDeclarations() ?? [];
  } catch {
    return false;
  }
  return decls.some((d) => {
    if (Node.isVariableDeclaration(d) && Node.isCatchClause(d.getParent())) return true;
    if (Node.isParameterDeclaration(d)) {
      const fn = d.getParent();
      const call = fn?.getParent();
      if (fn && call && Node.isCallExpression(call)) {
        const callee = call.getExpression();
        const params = (fn as unknown as { getParameters?: () => Node[] }).getParameters?.() ?? [];
        return Node.isPropertyAccessExpression(callee) && callee.getName() === "catch" && params[0] === d;
      }
    }
    return false;
  });
}

/** Does this expression's static type look like an Error (Error, TypeError, APIError, …)? */
function hasErrorType(node: Node): boolean {
  try {
    const t = node.getType();
    const name = t.getSymbol()?.getName() ?? t.getText();
    return /(^|\.)\w*Error$/.test(name) || /Error\b/.test(t.getBaseTypes().map((b) => b.getText()).join(" "));
  } catch {
    return false;
  }
}

/**
 * Text that comes from a caught error: `e.message`, `String(err)`, `err.toString()`,
 * `e instanceof Error ? e.message : "fallback"`. Written by a library or the app, not a person.
 */
export function isCaughtErrorText(node: Node, depth = 0): boolean {
  if (depth > 4) return false;
  // strip parens/casts and normalization: err.message.toLowerCase().trim() → err.message
  const expr: Node = unwrap(node).expr;
  if (Node.isConditionalExpression(expr)) {
    return isCaughtErrorText(expr.getWhenTrue(), depth + 1) || isCaughtErrorText(expr.getWhenFalse(), depth + 1);
  }
  if (Node.isBinaryExpression(expr)) {
    const op = expr.getOperatorToken().getKind();
    if (op === SyntaxKind.QuestionQuestionToken || op === SyntaxKind.BarBarToken || op === SyntaxKind.PlusToken) {
      return isCaughtErrorText(expr.getLeft(), depth + 1) || isCaughtErrorText(expr.getRight(), depth + 1);
    }
  }
  if (Node.isTemplateExpression(expr)) {
    return expr.getTemplateSpans().some((sp) => isCaughtErrorText(sp.getExpression(), depth + 1));
  }
  if (Node.isPropertyAccessExpression(expr) && ERROR_TEXT_PROPS.has(expr.getName())) {
    const recv = expr.getExpression();
    const base = Node.isParenthesizedExpression(recv) || Node.isAsExpression(recv) ? recv.getExpression() : recv;
    return isCaughtErrorVariable(base) || hasErrorType(base);
  }
  if (Node.isCallExpression(expr)) {
    const callee = expr.getExpression();
    // String(e)
    if (Node.isIdentifier(callee) && callee.getText() === "String" && expr.getArguments()[0]) {
      const a = expr.getArguments()[0]!;
      return isCaughtErrorVariable(a) || isCaughtErrorText(a, depth + 1);
    }
    // e.toString()
    if (Node.isPropertyAccessExpression(callee) && callee.getName() === "toString") {
      return isCaughtErrorVariable(callee.getExpression()) || hasErrorType(callee.getExpression());
    }
  }
  if (Node.isIdentifier(expr)) {
    if (isCaughtErrorVariable(expr)) return true;
    const init = resolveInitializer(expr);
    return init ? isCaughtErrorText(init, depth + 1) : false;
  }
  return false;
}

export class TextOracle {
  private readonly names: Set<string>;

  constructor(humanTextNames: string[]) {
    this.names = new Set(humanTextNames.map((n) => n.toLowerCase()));
  }

  isHumanName(name: string): boolean {
    const tokens = nameTokens(name);
    const last = tokens[tokens.length - 1];
    return last !== undefined && this.names.has(last);
  }

  /** Is this expression plausibly freeform human-written text? */
  judge(node: Node, depth = 0): TextJudgement {
    const { expr, normalized } = unwrap(node);
    const done = (human: boolean, via?: string, norm = false): TextJudgement => ({
      human,
      normalized: normalized || norm,
      via
    });
    if (depth > 4) return done(false);
    // A caught error's message is machine text, even in a variable called `msg` or `message`.
    if (isCaughtErrorText(expr)) return { human: false, machine: true, normalized, via: "caught error" };

    if (Node.isIdentifier(expr)) {
      const init = resolveInitializer(expr);
      if (this.isHumanName(expr.getText())) {
        // `const text = message.toLowerCase()` — still human, and normalized upstream.
        const norm = init ? unwrap(init).normalized : false;
        return done(true, expr.getText(), norm);
      }
      if (init) {
        const inner = this.judge(init, depth + 1);
        if (inner.human) return done(true, inner.via ?? expr.getText(), inner.normalized);
      }
      // Parameters typed as string with a human name are covered above; untyped names are not.
      return done(false);
    }
    if (Node.isPropertyAccessExpression(expr)) {
      const name = expr.getName();
      if (this.isHumanName(name)) return done(true, expr.getText());
      return done(false);
    }
    if (Node.isElementAccessExpression(expr)) {
      const arg = stringLiteralValue(expr.getArgumentExpression());
      if (arg && this.isHumanName(arg)) return done(true, expr.getText());
      return done(false);
    }
    if (Node.isCallExpression(expr)) {
      // getMessage(), readUserInput(), el.textContent via call, etc.
      const callee = expr.getExpression();
      const name = Node.isPropertyAccessExpression(callee)
        ? callee.getName()
        : Node.isIdentifier(callee)
          ? callee.getText()
          : "";
      if (name && this.isHumanName(name)) return done(true, `${name}()`);
      return done(false);
    }
    if (Node.isTemplateExpression(expr)) {
      for (const span of expr.getTemplateSpans()) {
        const j = this.judge(span.getExpression(), depth + 1);
        if (j.human) return done(true, j.via, j.normalized);
      }
      return done(false);
    }
    if (Node.isBinaryExpression(expr) && expr.getOperatorToken().getKind() === SyntaxKind.PlusToken) {
      const l = this.judge(expr.getLeft(), depth + 1);
      if (l.human) return done(true, l.via, l.normalized);
      const r = this.judge(expr.getRight(), depth + 1);
      if (r.human) return done(true, r.via, r.normalized);
    }
    return done(false);
  }
}

/** Collect every word-like string inside an array / Set / object literal (nested). */
export function wordLeaves(node: Node, out: string[] = [], depth = 0): string[] {
  if (depth > 5) return out;
  const value = stringLiteralValue(node);
  if (value !== undefined) {
    if (isWordLike(value) || isMultiWord(value)) out.push(value);
    return out;
  }
  if (Node.isArrayLiteralExpression(node)) {
    for (const el of node.getElements()) wordLeaves(el, out, depth + 1);
  } else if (Node.isNewExpression(node)) {
    // new Set([...]), new Map([...])
    for (const arg of node.getArguments()) wordLeaves(arg, out, depth + 1);
  } else if (Node.isObjectLiteralExpression(node)) {
    for (const prop of node.getProperties()) {
      if (Node.isPropertyAssignment(prop)) {
        const init = prop.getInitializer();
        if (init) wordLeaves(init, out, depth + 1);
      }
    }
  } else if (Node.isAsExpression(node) || Node.isSatisfiesExpression(node) || Node.isParenthesizedExpression(node)) {
    wordLeaves(node.getExpression(), out, depth + 1);
  } else if (Node.isCallExpression(node)) {
    // Object.freeze([...]), ["a","b"].map(...)
    const callee = node.getExpression();
    if (Node.isPropertyAccessExpression(callee)) wordLeaves(callee.getExpression(), out, depth + 1);
    for (const arg of node.getArguments()) wordLeaves(arg, out, depth + 1);
  }
  return out;
}

/** Heuristic: does this regex look like it is matching natural-language words? */
export function regexNaturalWords(source: string): string[] {
  // Structural patterns: file extensions, URLs, paths, HTML tags, emails, digit formats.
  if (/\\\.\(|\\\.[a-z]{2,4}\$|https?|@|\\d\{|\[0-9\]|\\\/|\.com|\.org|<[a-z]/i.test(source)) return [];
  // Extraction, not classification: capture groups that pull data out — (\d+), (.+), ([^"]*).
  if (/\((?:\\d|\.[+*]|\[\^)/.test(source)) return [];
  const stripped = source.replace(/\\[a-zA-Z]/g, " ").replace(/\[[^\]]*\]/g, " ");
  const tokens = stripped.split(/[^A-Za-z' ]+|\s{2,}/).map((t) => t.trim()).filter(Boolean);
  return tokens.filter((t) => t.length >= 2 && isWordLike(t));
}

/** Programming / query-language keywords. Word lists made of these are source code, not prose. */
export const CODE_WORDS = new Set([
  "select", "from", "where", "join", "group by", "order by", "insert", "update", "delete", "into",
  "values", "graph", "subgraph", "end", "class", "classdef", "style", "click", "direction",
  "function", "return", "import", "export", "const", "let", "var", "if", "else", "for", "while",
  "switch", "case", "default", "break", "continue", "new", "this", "typeof", "instanceof",
  "interface", "type", "enum", "extends", "implements", "public", "private", "protected", "static",
  "async", "await", "yield", "def", "lambda", "begin", "then", "elif", "fi", "do", "done"
]);
