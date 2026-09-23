// Structural facts about one decision unit (a function). Everything here is AST shape and
// type information — no vocabulary lists, no names-that-sound-semantic.
import { Node, SyntaxKind, type Type } from "ts-morph";
import type { InputRef, OutcomeKind, Provenance } from "@jevx/core";

export type FunctionLike = Node & { getBody(): Node | undefined };

export function isFunctionLike(n: Node): n is FunctionLike {
  return (
    Node.isFunctionDeclaration(n) ||
    Node.isMethodDeclaration(n) ||
    Node.isArrowFunction(n) ||
    Node.isFunctionExpression(n) ||
    Node.isGetAccessorDeclaration(n)
  );
}

export type ReturnKind = "string" | "number" | "boolean" | "null" | "enum" | "discriminant" | "jsx" | "identifier" | "call" | "other" | "void";

export interface ReturnFact {
  kind: ReturnKind;
  value: string;
  line: number;
}

export type ConditionShape =
  | "trivial" // x, !x, x == null, typeof x, x.length === 0, Array.isArray(x), x instanceof Y
  | "exact_literal" // x === "a" / x === 3
  | "relational" // x > 10
  | "text_method" // s.includes(...), s.startsWith(...), s.match(...), s.indexOf(...)
  | "regex" // /re/.test(s)
  | "membership" // set.has(x), list.includes(x), key in obj
  | "call" // isFoo(x), await check(x)
  | "other";

export interface ConditionFact {
  line: number;
  text: string;
  shapes: ConditionShape[];
  /** Number of atomic checks joined by && / || */
  atoms: number;
  operands: InputRef[];
  /** String literals the condition compares against / searches for. */
  stringLiterals: string[];
  /** Numeric literals compared against. */
  numericLiterals: number[];
  /** Compared against single characters or char codes (lexer-style). */
  charCompare: boolean;
}

export interface ArmSet {
  kind: "if-chain" | "switch" | "guard-chain" | "ternary-chain";
  start: number;
  end: number;
  arms: number;
  /** Distinct effects of the arms (returned value, called action, assigned literal). */
  effects: string[];
  discriminant?: InputRef;
}

export interface UnitFacts {
  params: InputRef[];
  returns: ReturnFact[];
  /** Literals assigned in branches to a local that is later returned. */
  assignedOutcomes: string[];
  conditions: ConditionFact[];
  armSets: ArmSet[];
  ternaries: number;
  calls: string[];
  awaits: number;
  throws: number;
  loops: number;
  arithmetic: number;
  /** `score += …` style updates of a local numeric inside a branch. */
  conditionalAccumulations: number;
  /** a * w1 + b * w2 style weighted sums. */
  weightedTerms: number;
  selectorOps: string[];
  textOps: string[];
  statements: number;
  lines: number;
  maxDepth: number;
  comparatorShape: boolean;
}

// ─── Helpers ────────────────────────────────────────────────────────────

/** Visit a unit's own code, not nested functions (each nested function is its own unit). */
export function forEachOwn(unit: FunctionLike, fn: (n: Node, depth: number) => void): void {
  const body = unit.getBody();
  if (!body || isFunctionLike(body)) return;
  const visit = (n: Node, depth: number) => {
    fn(n, depth);
    n.forEachChild((c) => {
      if (isFunctionLike(c)) return;
      const d = Node.isIfStatement(c) || Node.isSwitchStatement(c) || Node.isConditionalExpression(c) ? depth + 1 : depth;
      visit(c, d);
    });
  };
  visit(body, 0);
}

const strip = (n: Node): Node => {
  let e = n;
  while (Node.isParenthesizedExpression(e) || Node.isAsExpression(e) || Node.isNonNullExpression(e) || Node.isSatisfiesExpression(e) || Node.isTypeAssertion(e))
    e = e.getExpression();
  return e;
};

const short = (s: string, max = 48) => {
  const one = s.replace(/\s+/g, " ").trim();
  return one.length > max ? one.slice(0, max - 1) + "…" : one;
};

const isStringLit = (n: Node) => Node.isStringLiteral(n) || Node.isNoSubstitutionTemplateLiteral(n);
const isJsx = (n: Node) => Node.isJsxElement(n) || Node.isJsxSelfClosingElement(n) || Node.isJsxFragment(n);

function typeSafe<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

/** Closed = the type system already bounds the values (literal union, enum, boolean). */
export function isClosedType(t: Type): boolean {
  if (t.isBoolean() || t.isBooleanLiteral() || t.isEnum() || t.isEnumLiteral() || t.isLiteral()) return true;
  if (t.isUnion()) {
    const parts = t.getUnionTypes().filter((u) => !u.isUndefined() && !u.isNull());
    return parts.length > 0 && parts.every((u) => u.isLiteral() || u.isBooleanLiteral() || u.isEnumLiteral());
  }
  return false;
}

function describeType(node: Node): Pick<InputRef, "type" | "closedType" | "textual" | "numeric"> {
  return typeSafe<Pick<InputRef, "type" | "closedType" | "textual" | "numeric">>(
    () => {
      const t = node.getType();
      const text = short(t.getText(node), 60);
      const closed = isClosedType(t);
      const nonNull = t.getNonNullableType();
      return {
        type: text,
        closedType: closed,
        textual: !closed && (nonNull.isString() || nonNull.isTemplateLiteral()),
        numeric: !closed && nonNull.isNumber()
      };
    },
    {}
  );
}

// ─── Provenance ─────────────────────────────────────────────────────────

const REQUEST_TYPES = /\b(Request|NextRequest|IncomingMessage|FormData|URLSearchParams|ChangeEvent|FormEvent|InputEvent|Message|Interaction)\b/;
const UI_EVENT_TYPES = /\b(Keyboard|Mouse|Pointer|Touch|Wheel|Drag|Focus|Clipboard|UI)Event\b/;
const REQUEST_ROOTS = new Set(["req", "request", "ctx", "event", "e", "evt"]);
const REQUEST_MEMBERS = new Set(["body", "query", "params", "searchParams", "formData", "target", "value", "content", "text", "data"]);

function rootOf(n: Node): { root: Node; path: string[] } {
  let e = strip(n);
  const pathParts: string[] = [];
  for (;;) {
    if (Node.isPropertyAccessExpression(e)) {
      pathParts.unshift(e.getName());
      e = strip(e.getExpression());
    } else if (Node.isElementAccessExpression(e)) {
      pathParts.unshift("[]");
      e = strip(e.getExpression());
    } else if (Node.isCallExpression(e)) {
      const callee = e.getExpression();
      if (Node.isPropertyAccessExpression(callee)) {
        pathParts.unshift(callee.getName() + "()");
        e = strip(callee.getExpression());
      } else break;
    } else break;
  }
  return { root: e, path: pathParts };
}

export function provenanceOf(expr: Node, depth = 0): Provenance {
  if (depth > 4) return "unknown";
  const e = strip(expr);
  if (Node.isAwaitExpression(e)) return "awaited_call";
  if (isStringLit(e) || Node.isNumericLiteral(e) || Node.isTrueLiteral(e) || Node.isFalseLiteral(e) || Node.isNullLiteral(e) || Node.isRegularExpressionLiteral(e)) return "constant";
  if (Node.isArrayLiteralExpression(e)) return e.getElements().every((x) => provenanceOf(x, depth + 1) === "constant") ? "constant" : "unknown";
  if (Node.isNewExpression(e) && e.getExpression().getText() === "RegExp" && e.getArguments().every((a) => provenanceOf(a, depth + 1) === "constant")) return "constant";
  if (Node.isTemplateExpression(e)) {
    const inner = e.getTemplateSpans().map((s) => provenanceOf(s.getExpression(), depth + 1));
    return inner.find((p) => p !== "constant") ?? "constant";
  }
  if (Node.isBinaryExpression(e)) {
    const l = provenanceOf(e.getLeft(), depth + 1);
    return l !== "constant" ? l : provenanceOf(e.getRight(), depth + 1);
  }
  if (Node.isConditionalExpression(e)) {
    const a = provenanceOf(e.getWhenTrue(), depth + 1);
    return a !== "constant" ? a : provenanceOf(e.getWhenFalse(), depth + 1);
  }
  const { root, path: parts } = rootOf(e);
  const text = root.getText();
  if (text === "process" && parts[0] === "env") return "env_config";
  if (Node.isMetaProperty(root) && parts[0] === "env") return "env_config";
  if (Node.isThisExpression(root)) return "instance_state";
  if (Node.isAwaitExpression(root)) return "awaited_call";
  if (Node.isCallExpression(root) || Node.isNewExpression(root)) return "call_result";
  if (!Node.isIdentifier(root)) return "unknown";

  const decl = typeSafe(() => root.getSymbol()?.getDeclarations()?.[0], undefined);
  if (!decl) return "unknown";
  if (Node.isVariableDeclaration(decl) && Node.isCatchClause(decl.getParent())) return "caught_error";
  if (Node.isParameterDeclaration(decl) || Node.isBindingElement(decl)) {
    const typeText = typeSafe(() => decl.getType().getText(decl), "");
    if (UI_EVENT_TYPES.test(typeText)) return "ui_event";
    if (REQUEST_TYPES.test(typeText)) return "request_input";
    if (REQUEST_ROOTS.has(text) && parts.some((p) => REQUEST_MEMBERS.has(p.replace("()", "")))) return "request_input";
    if (Node.isBindingElement(decl)) {
      // const { body } = req  → follow the object being destructured
      const holder = decl.getFirstAncestor((a) => Node.isVariableDeclaration(a));
      if (holder && Node.isVariableDeclaration(holder) && holder.getInitializer()) return provenanceOf(holder.getInitializer()!, depth + 1);
    }
    return "parameter";
  }
  if (Node.isVariableDeclaration(decl)) {
    const init = decl.getInitializer();
    return init ? provenanceOf(init, depth + 1) : "unknown";
  }
  if (Node.isEnumDeclaration(decl) || Node.isEnumMember(decl)) return "constant";
  if (Node.isImportSpecifier(decl) || Node.isImportClause(decl) || Node.isNamespaceImport(decl)) return "constant";
  if (Node.isPropertyDeclaration(decl) || Node.isPropertySignature(decl)) return "instance_state";
  return "unknown";
}

/** Identifiers / member chains read inside an expression, as input refs. */
function operandsOf(cond: Node): InputRef[] {
  const out = new Map<string, InputRef>();
  const add = (n: Node) => {
    const { root } = rootOf(n);
    if (!Node.isIdentifier(root) && !Node.isThisExpression(root)) return;
    const name = short(n.getText(), 40);
    if (out.has(name)) return;
    const prov = provenanceOf(n);
    if (prov === "constant") return;
    out.set(name, { name, provenance: prov, ...describeType(n) });
  };
  const visit = (n: Node) => {
    const e = strip(n);
    if (Node.isPropertyAccessExpression(e) || Node.isIdentifier(e) || Node.isElementAccessExpression(e)) {
      // skip identifiers that are callee names or enum/namespace roots
      add(e);
      return;
    }
    if (Node.isCallExpression(e)) {
      const callee = e.getExpression();
      if (Node.isPropertyAccessExpression(callee)) visit(callee.getExpression());
      e.getArguments().forEach(visit);
      return;
    }
    e.forEachChild(visit);
  };
  visit(cond);
  return [...out.values()];
}

// ─── Conditions ─────────────────────────────────────────────────────────

const TEXT_METHODS = new Set(["includes", "startsWith", "endsWith", "indexOf", "match", "matchAll", "search", "localeCompare"]);
const EQ = new Set([SyntaxKind.EqualsEqualsEqualsToken, SyntaxKind.EqualsEqualsToken, SyntaxKind.ExclamationEqualsEqualsToken, SyntaxKind.ExclamationEqualsToken]);
const REL = new Set([SyntaxKind.LessThanToken, SyntaxKind.LessThanEqualsToken, SyntaxKind.GreaterThanToken, SyntaxKind.GreaterThanEqualsToken]);

function atomsOf(n: Node): Node[] {
  const e = strip(n);
  if (Node.isBinaryExpression(e)) {
    const k = e.getOperatorToken().getKind();
    if (k === SyntaxKind.AmpersandAmpersandToken || k === SyntaxKind.BarBarToken) return [...atomsOf(e.getLeft()), ...atomsOf(e.getRight())];
  }
  if (Node.isPrefixUnaryExpression(e) && e.getOperatorToken() === SyntaxKind.ExclamationToken) {
    const inner = strip(e.getOperand());
    if (Node.isBinaryExpression(inner) || Node.isParenthesizedExpression(e.getOperand())) return atomsOf(inner);
  }
  return [e];
}

function isNullish(n: Node) {
  const e = strip(n);
  return Node.isNullLiteral(e) || (Node.isIdentifier(e) && e.getText() === "undefined");
}

function classifyAtom(a: Node, fact: ConditionFact): ConditionShape {
  let e = strip(a);
  if (Node.isPrefixUnaryExpression(e) && e.getOperatorToken() === SyntaxKind.ExclamationToken) e = strip(e.getOperand());
  if (Node.isIdentifier(e) || Node.isPropertyAccessExpression(e) || Node.isElementAccessExpression(e)) {
    if (Node.isPropertyAccessExpression(e) && e.getName() === "length") return "trivial";
    return "trivial";
  }
  if (Node.isTypeOfExpression(e)) return "trivial";
  if (Node.isBinaryExpression(e)) {
    const k = e.getOperatorToken().getKind();
    const l = strip(e.getLeft());
    const r = strip(e.getRight());
    if (k === SyntaxKind.InstanceOfKeyword) return "trivial";
    if (k === SyntaxKind.InKeyword) return "membership";
    if (EQ.has(k)) {
      if (isNullish(l) || isNullish(r) || Node.isTypeOfExpression(l) || Node.isTypeOfExpression(r)) return "trivial";
      const lit = [l, r].find((x) => isStringLit(x) || Node.isNumericLiteral(x) || Node.isTrueLiteral(x) || Node.isFalseLiteral(x));
      const other = lit === l ? r : l;
      if (lit) {
        if (isStringLit(lit)) {
          const v = lit.getText().slice(1, -1);
          fact.stringLiterals.push(v);
          if (v.length === 1) fact.charCompare = true;
        }
        if (Node.isNumericLiteral(lit)) fact.numericLiterals.push(Number(lit.getLiteralValue()));
        if (Node.isPropertyAccessExpression(other) && other.getName() === "length" && Node.isNumericLiteral(lit) && Number(lit.getText()) === 0) return "trivial";
        if (Node.isTrueLiteral(lit) || Node.isFalseLiteral(lit)) return "trivial";
        return "exact_literal";
      }
      // enum member comparison: x === Kind.Foo
      if (Node.isPropertyAccessExpression(r) || Node.isPropertyAccessExpression(l)) {
        const side = Node.isPropertyAccessExpression(r) ? r : l;
        if (typeSafe(() => side.getType().isEnumLiteral() || side.getType().isLiteral(), false)) return "exact_literal";
      }
      return "other";
    }
    if (REL.has(k)) {
      for (const x of [l, r]) if (Node.isNumericLiteral(x)) fact.numericLiterals.push(Number(x.getLiteralValue()));
      if ([l, r].some((x) => Node.isPropertyAccessExpression(x) && x.getName() === "length") && [l, r].some((x) => Node.isNumericLiteral(x) && Number(x.getText()) <= 1))
        return "trivial";
      if ([l, r].some((x) => isStringLit(x) && x.getText().length === 3)) fact.charCompare = true;
      if ([l, r].some((x) => Node.isCallExpression(x) && /charCodeAt|codePointAt/.test(x.getExpression().getText()))) fact.charCompare = true;
      return "relational";
    }
    return "other";
  }
  if (Node.isCallExpression(e)) {
    const callee = strip(e.getExpression());
    if (Node.isPropertyAccessExpression(callee)) {
      const m = callee.getName();
      const recv = strip(callee.getExpression());
      if (m === "isArray" || m === "isInteger" || m === "isFinite" || m === "isNaN" || m === "hasOwnProperty" || m === "hasOwn") return "trivial";
      if (m === "test" && (Node.isRegularExpressionLiteral(recv) || Node.isIdentifier(recv))) {
        if (Node.isRegularExpressionLiteral(recv)) fact.stringLiterals.push(recv.getText());
        return "regex";
      }
      if (TEXT_METHODS.has(m)) {
        for (const arg of e.getArguments()) {
          const s = strip(arg);
          if (isStringLit(s)) {
            const v = s.getText().slice(1, -1);
            fact.stringLiterals.push(v);
            if (v.length === 1) fact.charCompare = true;
          } else if (Node.isRegularExpressionLiteral(s)) fact.stringLiterals.push(s.getText());
        }
        // list.includes(x) where the receiver is an array/set of literals = membership
        if (m === "includes" && typeSafe(() => recv.getType().isArray(), false)) return "membership";
        return "text_method";
      }
      if (m === "has") return "membership";
      if (m === "some" || m === "every") return "membership";
    }
    return "call";
  }
  if (Node.isAwaitExpression(e)) return "call";
  return "other";
}

function conditionFact(cond: Node): ConditionFact {
  const fact: ConditionFact = {
    line: cond.getStartLineNumber(),
    text: short(cond.getText(), 90),
    shapes: [],
    atoms: 0,
    operands: operandsOf(cond),
    stringLiterals: [],
    numericLiterals: [],
    charCompare: false
  };
  const atoms = atomsOf(cond);
  fact.atoms = atoms.length;
  fact.shapes = atoms.map((a) => classifyAtom(a, fact));
  return fact;
}

// ─── Returns / effects ──────────────────────────────────────────────────

function returnFact(expr: Node | undefined, line: number): ReturnFact {
  if (!expr) return { kind: "void", value: "", line };
  const e = strip(expr);
  if (isStringLit(e)) return { kind: "string", value: e.getText().slice(1, -1), line };
  if (Node.isNumericLiteral(e) || (Node.isPrefixUnaryExpression(e) && Node.isNumericLiteral(e.getOperand())))
    return { kind: "number", value: e.getText(), line };
  if (Node.isTrueLiteral(e) || Node.isFalseLiteral(e)) return { kind: "boolean", value: e.getText(), line };
  if (isNullish(e)) return { kind: "null", value: e.getText(), line };
  if (isJsx(e)) return { kind: "jsx", value: short(e.getText(), 30), line };
  if (Node.isPropertyAccessExpression(e) && typeSafe(() => e.getType().isEnumLiteral() || e.getType().isStringLiteral(), false))
    return { kind: "enum", value: e.getText(), line };
  if (Node.isObjectLiteralExpression(e)) {
    // { type: "refund", … } / { action: "escalate" } — a discriminated outcome
    for (const p of e.getProperties()) {
      if (Node.isPropertyAssignment(p)) {
        const init = p.getInitializer();
        if (init && (isStringLit(strip(init)) || Node.isTrueLiteral(init) || Node.isFalseLiteral(init)))
          return { kind: "discriminant", value: `${p.getName()}: ${strip(init).getText()}`, line };
      }
    }
    return { kind: "other", value: short(e.getText(), 40), line };
  }
  if (Node.isIdentifier(e)) return { kind: "identifier", value: e.getText(), line };
  if (Node.isCallExpression(e) || Node.isAwaitExpression(e)) return { kind: "call", value: short(e.getText(), 40), line };
  return { kind: "other", value: short(e.getText(), 40), line };
}

/** `return c ? "a" : d ? "b" : "c"` returns each leaf of the conditional. */
function returnFacts(expr: Node | undefined, line: number): ReturnFact[] {
  const e = expr ? strip(expr) : undefined;
  if (e && Node.isConditionalExpression(e)) return [...returnFacts(e.getWhenTrue(), line), ...returnFacts(e.getWhenFalse(), line)];
  return [returnFact(expr, line)];
}

/** What an arm (then-branch, case clause) does: its return value, first call, or assignment. */
function effectOf(n: Node | undefined): string {
  if (!n) return "∅";
  const e = strip(n);
  if (Node.isReturnStatement(e)) {
    const r = returnFact(e.getExpression(), 0);
    return r.kind === "void" ? "return" : `→ ${r.value}`;
  }
  if (Node.isThrowStatement(e)) return "throw";
  if (Node.isExpressionStatement(e)) return effectOf(e.getExpression());
  if (Node.isCallExpression(e)) return `${short(e.getExpression().getText(), 40)}()`;
  if (Node.isAwaitExpression(e)) return effectOf(e.getExpression());
  if (Node.isBinaryExpression(e) && e.getOperatorToken().getKind() === SyntaxKind.EqualsToken) return `${short(e.getLeft().getText(), 20)} = ${short(e.getRight().getText(), 24)}`;
  if (Node.isBlock(e) || Node.isCaseClause(e) || Node.isDefaultClause(e)) {
    const stmts = e.getStatements().filter((s) => !Node.isBreakStatement(s));
    const ret = stmts.find((s) => Node.isReturnStatement(s) || Node.isThrowStatement(s));
    if (ret) return effectOf(ret);
    return stmts[0] ? effectOf(stmts[0]) : "∅";
  }
  if (Node.isIfStatement(e)) return "if…";
  return short(e.getText(), 30);
}

const exits = (n: Node | undefined): boolean => {
  if (!n) return false;
  if (Node.isReturnStatement(n) || Node.isThrowStatement(n)) return true;
  if (Node.isBlock(n)) {
    const last = n.getStatements().at(-1);
    return last ? Node.isReturnStatement(last) || Node.isThrowStatement(last) : false;
  }
  return false;
};

// ─── Main ───────────────────────────────────────────────────────────────

export function collectFacts(unit: FunctionLike): UnitFacts {
  const facts: UnitFacts = {
    params: [],
    returns: [],
    assignedOutcomes: [],
    conditions: [],
    armSets: [],
    ternaries: 0,
    calls: [],
    awaits: 0,
    throws: 0,
    loops: 0,
    arithmetic: 0,
    conditionalAccumulations: 0,
    weightedTerms: 0,
    selectorOps: [],
    textOps: [],
    statements: 0,
    lines: unit.getEndLineNumber() - unit.getStartLineNumber() + 1,
    maxDepth: 0,
    comparatorShape: false
  };

  if (Node.isFunctionDeclaration(unit) || Node.isMethodDeclaration(unit) || Node.isArrowFunction(unit) || Node.isFunctionExpression(unit)) {
    for (const p of unit.getParameters()) facts.params.push({ name: p.getName(), provenance: "parameter", ...describeType(p) });
  }

  // Concise arrow body: `x => cond ? "a" : "b"`
  const body = unit.getBody();
  if (body && !Node.isBlock(body) && !isFunctionLike(body)) facts.returns.push(...returnFacts(body, body.getStartLineNumber()));

  const returnedLocals = new Set<string>();
  const chainMembers = new Set<Node>();

  forEachOwn(unit, (n, depth) => {
    facts.maxDepth = Math.max(facts.maxDepth, depth);
    if (Node.isStatement(n) && !Node.isBlock(n)) facts.statements++;

    if (Node.isReturnStatement(n)) {
      for (const r of returnFacts(n.getExpression(), n.getStartLineNumber())) {
        facts.returns.push(r);
        if (r.kind === "identifier") returnedLocals.add(r.value);
      }
    } else if (Node.isThrowStatement(n)) facts.throws++;
    else if (Node.isAwaitExpression(n)) facts.awaits++;
    else if (Node.isForStatement(n) || Node.isForOfStatement(n) || Node.isForInStatement(n) || Node.isWhileStatement(n) || Node.isDoStatement(n)) facts.loops++;

    if (Node.isIfStatement(n)) {
      facts.conditions.push(conditionFact(n.getExpression()));
      const parent = n.getParent();
      const isElseIf = Node.isIfStatement(parent) && parent.getElseStatement() === n;
      if (!isElseIf) {
        const effects: string[] = [];
        let cur: Node | undefined = n;
        let arms = 0;
        let end = n.getEndLineNumber();
        while (cur && Node.isIfStatement(cur)) {
          arms++;
          effects.push(effectOf(cur.getThenStatement()));
          end = cur.getEndLineNumber();
          cur = cur.getElseStatement();
        }
        if (cur) {
          arms++;
          effects.push(effectOf(cur));
        }
        if (arms >= 2) facts.armSets.push({ kind: "if-chain", start: n.getStartLineNumber(), end, arms, effects: [...new Set(effects)] });
      }
    }

    if (Node.isBlock(n) || Node.isSourceFile(n) || Node.isCaseClause(n) || Node.isDefaultClause(n)) {
      // guard chain: consecutive `if (c) return X;` statements (no else), plus the fall-through return
      const stmts = n.getStatements();
      let i = 0;
      while (i < stmts.length) {
        const run: Node[] = [];
        while (i < stmts.length && Node.isIfStatement(stmts[i]!) && !(stmts[i] as import("ts-morph").IfStatement).getElseStatement() && exits((stmts[i] as import("ts-morph").IfStatement).getThenStatement())) {
          run.push(stmts[i]!);
          i++;
        }
        if (run.length >= 2) {
          const effects = run.map((s) => effectOf((s as import("ts-morph").IfStatement).getThenStatement()));
          const next = stmts[i];
          if (next && (Node.isReturnStatement(next) || Node.isThrowStatement(next))) effects.push(effectOf(next));
          run.forEach((s) => chainMembers.add(s));
          facts.armSets.push({
            kind: "guard-chain",
            start: run[0]!.getStartLineNumber(),
            end: (next && (Node.isReturnStatement(next) || Node.isThrowStatement(next)) ? next : run.at(-1)!).getEndLineNumber(),
            arms: effects.length,
            effects: [...new Set(effects)]
          });
        }
        if (run.length === 0) i++;
      }
    }

    if (Node.isSwitchStatement(n)) {
      const clauses = n.getCaseBlock().getClauses();
      const disc = n.getExpression();
      const ops = operandsOf(disc);
      const cond: ConditionFact = {
        line: n.getStartLineNumber(),
        text: `switch (${short(disc.getText(), 40)})`,
        shapes: ["exact_literal"],
        atoms: 1,
        operands: ops,
        stringLiterals: [],
        numericLiterals: [],
        charCompare: false
      };
      for (const c of clauses) {
        if (Node.isCaseClause(c)) {
          const x = strip(c.getExpression());
          if (isStringLit(x)) {
            const v = x.getText().slice(1, -1);
            cond.stringLiterals.push(v);
            if (v.length === 1) cond.charCompare = true;
          } else if (Node.isNumericLiteral(x)) cond.numericLiterals.push(Number(x.getLiteralValue()));
        }
      }
      if (Node.isTrueLiteral(strip(disc))) cond.shapes = ["other"]; // switch (true) { case a > b: … }
      facts.conditions.push(cond);
      const discType = describeType(disc);
      facts.armSets.push({
        kind: "switch",
        start: n.getStartLineNumber(),
        end: n.getEndLineNumber(),
        arms: clauses.length,
        effects: [...new Set(clauses.map((c) => effectOf(c)))],
        discriminant: { name: short(disc.getText(), 40), provenance: provenanceOf(disc), ...discType }
      });
    }

    if (Node.isConditionalExpression(n)) {
      facts.ternaries++;
      facts.conditions.push(conditionFact(n.getCondition()));
      const parent = n.getParent();
      const nested = Boolean(parent && (Node.isConditionalExpression(parent) || (Node.isParenthesizedExpression(parent) && Node.isConditionalExpression(parent.getParent()))));
      if (!nested) {
        const effects: string[] = [];
        let cur: Node = n;
        let arms = 0;
        while (Node.isConditionalExpression(strip(cur))) {
          const c = strip(cur) as import("ts-morph").ConditionalExpression;
          arms++;
          effects.push(returnFact(c.getWhenTrue(), 0).value);
          cur = c.getWhenFalse();
        }
        arms++;
        effects.push(returnFact(cur, 0).value);
        if (arms >= 3) facts.armSets.push({ kind: "ternary-chain", start: n.getStartLineNumber(), end: n.getEndLineNumber(), arms, effects: [...new Set(effects)] });
      }
    }

    if (Node.isCallExpression(n)) {
      const callee = n.getExpression();
      const name = Node.isPropertyAccessExpression(callee) ? callee.getName() : short(callee.getText(), 30);
      facts.calls.push(short(callee.getText(), 40));
      if (Node.isPropertyAccessExpression(callee)) {
        const recv = strip(callee.getExpression());
        const parent = n.getParent();
        const indexedFirst = parent && Node.isElementAccessExpression(parent) && parent.getArgumentExpression()?.getText() === "0";
        if (name === "find" || name === "findLast") facts.selectorOps.push(`${short(callee.getText(), 30)}(…)`);
        else if ((name === "filter" || name === "sort" || name === "toSorted") && indexedFirst) facts.selectorOps.push(`${name}(…)[0]`);
        else if ((name === "sort" || name === "toSorted") && parent && Node.isPropertyAccessExpression(parent) && /^(at|shift|pop)$/.test(parent.getName()))
          facts.selectorOps.push(`${name}(…).${parent.getName()}`);
        else if (name === "reduce" && n.getArguments()[0] && [n.getArguments()[0]!, ...n.getArguments()[0]!.getDescendants()].some((d) => Node.isConditionalExpression(d)))
          facts.selectorOps.push("reduce(best-of)");
        else if ((name === "max" || name === "min") && recv.getText() === "Math" && n.getArguments().some((a) => Node.isSpreadElement(a)))
          facts.selectorOps.push(`Math.${name}(...)`);
        if (TEXT_METHODS.has(name) && !Node.isStringLiteral(recv) && !typeSafe(() => recv.getType().isArray(), false)) facts.textOps.push(`.${name}()`);
        if (name === "test" && Node.isRegularExpressionLiteral(recv)) facts.textOps.push("regex.test()");
        if ((name === "replace" || name === "replaceAll" || name === "split") && n.getArguments().some((a) => Node.isRegularExpressionLiteral(a))) facts.textOps.push(`.${name}(/re/)`);
      }
    }

    if (Node.isElementAccessExpression(n)) {
      // STRATEGIES[kind] where the object is a literal map declared nearby
      const obj = strip(n.getExpression());
      const arg = n.getArgumentExpression();
      if (Node.isIdentifier(obj) && arg && !Node.isNumericLiteral(arg) && !isStringLit(arg)) {
        const decl = typeSafe(() => obj.getSymbol()?.getDeclarations()?.[0], undefined);
        const init = decl && Node.isVariableDeclaration(decl) ? decl.getInitializer() : undefined;
        if (init && Node.isObjectLiteralExpression(strip(init)) && (strip(init) as import("ts-morph").ObjectLiteralExpression).getProperties().length >= 3)
          facts.selectorOps.push(`${obj.getText()}[${short(arg.getText(), 20)}]`);
      }
    }

    if (Node.isBinaryExpression(n)) {
      const k = n.getOperatorToken().getKind();
      if (k === SyntaxKind.PlusToken || k === SyntaxKind.MinusToken || k === SyntaxKind.AsteriskToken || k === SyntaxKind.SlashToken || k === SyntaxKind.PercentToken) {
        const numeric = typeSafe(() => n.getType().isNumber() || n.getType().isNumberLiteral(), false);
        if (numeric) facts.arithmetic++;
        if (k === SyntaxKind.AsteriskToken && [n.getLeft(), n.getRight()].some((x) => Node.isNumericLiteral(strip(x)))) facts.weightedTerms++;
      }
      if (k === SyntaxKind.PlusEqualsToken || k === SyntaxKind.MinusEqualsToken || k === SyntaxKind.AsteriskEqualsToken) {
        facts.arithmetic++;
        const inBranch = n.getFirstAncestor((a) => Node.isIfStatement(a) || Node.isConditionalExpression(a) || Node.isCaseClause(a));
        const target = strip(n.getLeft());
        const numeric = typeSafe(() => target.getType().isNumber() || target.getType().isNumberLiteral(), false);
        if (inBranch && numeric && Node.isIdentifier(target)) facts.conditionalAccumulations++;
      }
      if (k === SyntaxKind.EqualsToken) {
        const left = strip(n.getLeft());
        const right = strip(n.getRight());
        const inBranch = n.getFirstAncestor((a) => Node.isIfStatement(a) || Node.isCaseClause(a));
        if (inBranch && Node.isIdentifier(left) && (isStringLit(right) || Node.isNumericLiteral(right) || Node.isTrueLiteral(right) || Node.isFalseLiteral(right) || (Node.isPropertyAccessExpression(right) && typeSafe(() => right.getType().isEnumLiteral(), false))))
          facts.assignedOutcomes.push(`${left.getText()}=${isStringLit(right) ? right.getText().slice(1, -1) : right.getText()}`);
      }
    }
  });

  // Keep only literal assignments to locals that the function returns.
  facts.assignedOutcomes = [...new Set(facts.assignedOutcomes.filter((a) => returnedLocals.has(a.split("=")[0]!)).map((a) => a.slice(a.indexOf("=") + 1)))];

  // Comparator: (a, b) => number from a subtraction / localeCompare.
  if (facts.params.length === 2) {
    const text = unit.getText();
    const [a, b] = facts.params.map((p) => p.name);
    if (new RegExp(`\\b${a}\\b[\\w.]*\\s*-\\s*\\b${b}\\b|\\b${b}\\b[\\w.]*\\s*-\\s*\\b${a}\\b|localeCompare`).test(text) && facts.returns.every((r) => r.kind !== "string"))
      facts.comparatorShape = true;
  }
  void chainMembers;
  return facts;
}

/** Summarize return facts into an OutcomeSet kind. */
export function outcomeKind(facts: UnitFacts): OutcomeKind {
  const kinds = new Set(facts.returns.filter((r) => r.kind !== "void" && r.kind !== "null").map((r) => r.kind));
  const literalOutcomes = facts.assignedOutcomes.length;
  if (kinds.size === 0 && literalOutcomes === 0) {
    const actionArms = facts.armSets.some((a) => a.effects.filter((e) => e.endsWith("()")).length >= 2);
    return actionArms ? "action" : "unknown";
  }
  if (kinds.size === 1) {
    const k = [...kinds][0]!;
    if (k === "boolean") return "boolean";
    if (k === "number") return "numeric";
    if (k === "string" || k === "enum") return "enumerated";
    if (k === "discriminant") return "object";
  }
  if ([...kinds].every((k) => k === "string" || k === "enum" || k === "discriminant")) return "enumerated";
  if (kinds.size === 0 && literalOutcomes > 0) return "enumerated";
  if ([...kinds].every((k) => k === "identifier" || k === "call" || k === "other")) {
    if (literalOutcomes >= 2) return "enumerated";
    const callees = new Set(facts.returns.filter((r) => r.kind === "call").map((r) => r.value.replace(/^await\s+/, "").split("(")[0]));
    if (callees.size >= 2) return "action";
    return "unknown";
  }
  return "mixed";
}
