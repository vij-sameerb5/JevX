// M5b layer B — the Jev-call FINDER. Deterministic, offline, no AI.
//
// It answers one factual question: "where in this repository is Jev actually used?".
// It never decides whether Jev SHOULD be used anywhere. A found usage is evidence of a developer's
// choice, not ground truth.
//
// Tiers (see JevEvidenceTier): definite (resolved SDK symbols) > likely (known Jev HTTP APIs) >
// wrapper (verified local wrappers of the above) > uncertain (recorded apart, never an anchor).
// Test files are excluded: they are full of fakes (local `noul()` helpers, stub `systemOne`).
import { createHash } from "node:crypto";
import path from "node:path";
import { Node, SyntaxKind, type CallExpression, type ObjectLiteralExpression, type SourceFile } from "ts-morph";
import {
  scrubSecrets,
  type JevCallRef,
  type JevEvidenceTier,
  type JevPrimitiveKind,
  type JevQuestionRef,
  type JevSite,
  type JevSiteRole,
  type JevUsageReport
} from "@jevx/core";
import { isFunctionLike, type FunctionLike } from "./facts.js";
import { unitName } from "./analyze.js";
import { fileRole } from "./project.js";

export const JEV_FINDER_VERSION = "u1";

/** Packages whose imports are definite Jev usage. */
export const JEV_SDK_MODULES = new Set(["@typesafe-ai/sdk", "@typesafeai/sdk"]);
export const JEV_AI_SDK_PROVIDER = "@ai-sdk/typesafe-ai";
const AI_SDK_MODULE = "ai";
const AI_SDK_EVALUATE = new Set(["experimental_evaluate", "evaluate"]);
const BUILDERS = new Set<JevPrimitiveKind>(["noul", "choice", "score"]);

/** Known Jev HTTP endpoints / model ids (likely tier). */
const ENDPOINTS: { re: RegExp; kind: JevCallRef["kind"]; what: string; tier: JevEvidenceTier }[] = [
  { re: /api\.typesafe\.ai|\/v1\/systemone\b/i, kind: "http_typesafe", what: "TypeSafe Jev HTTP API", tier: "likely" },
  { re: /openrouter\.ai\/api\/[\w/]*decisions/i, kind: "http_openrouter_jev", what: "OpenRouter decisions endpoint", tier: "likely" },
  { re: /^~?typesafe\/jev/i, kind: "http_openrouter_jev", what: "Jev model id on OpenRouter", tier: "likely" },
  { re: /^typesafe-ai\/jev/i, kind: "http_gateway_jev", what: "Jev model id on an AI gateway", tier: "likely" },
  // the app's own route to a server-side Jev proxy; verified at the end (needs a proxy that calls Jev)
  { re: /^\/api\/jev(\/|$)/i, kind: "http_local_jev_proxy", what: "the app's /api/jev proxy route", tier: "wrapper" }
];

/** Object properties that mark a question definition (vs. an answer object). */
const QUESTION_PROPS = new Set(["instructions", "question", "criteria", "legend", "text", "prompt", "description"]);
const ANSWER_PROPS = new Set(["noul", "choice", "score", "probabilities", "confidence"]);
const ITERATION_CALLEES = /\.(map|forEach|filter|reduce|flatMap|some|every|find|findIndex|sort)$|^Promise\.(all|allSettled|race)$/;

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const clip = (s: string, n = 200) => scrubSecrets(s.replace(/\s+/g, " ").trim()).text.slice(0, n);
const TIER_RANK: Record<JevEvidenceTier, number> = { definite: 0, likely: 1, wrapper: 2, uncertain: 3 };
const better = (a: JevEvidenceTier, b: JevEvidenceTier) => (TIER_RANK[a] <= TIER_RANK[b] ? a : b);

type Owner = { kind: "function"; fn: FunctionLike } | { kind: "module"; name: string; node: Node };

interface Draft {
  file: string;
  owner: Owner;
  questions: JevQuestionRef[];
  calls: JevCallRef[];
  questionSets: Set<string>;
  evidence: Set<string>;
}

/** Nearest meaningful enclosing function (skips inline iteration callbacks), else the module-level declaration. */
function ownerOf(n: Node): Owner {
  for (let a = n.getParent(); a; a = a.getParent()) {
    if (!isFunctionLike(a)) continue;
    const p = a.getParent();
    if (p && Node.isCallExpression(p) && ITERATION_CALLEES.test(p.getExpression().getText().replace(/\s+/g, ""))) continue;
    return { kind: "function", fn: a as FunctionLike };
  }
  const decl = n.getFirstAncestorByKind(SyntaxKind.VariableDeclaration);
  if (decl) return { kind: "module", name: decl.getName(), node: decl };
  const stmt = n.getFirstAncestor((a) => a.getParent() !== undefined && Node.isSourceFile(a.getParent()!)) ?? n;
  return { kind: "module", name: `<module@${stmt.getStartLineNumber()}>`, node: stmt };
}

const ownerKey = (file: string, o: Owner) => (o.kind === "function" ? `${file}@${o.fn.getStartLineNumber()}:${o.fn.getStart()}` : `${file}#${o.name}`);

/** Name node of a function, for reference search (callers / wrapper resolution). */
function nameNodeOf(fn: FunctionLike): Node | undefined {
  if (Node.isFunctionDeclaration(fn) || Node.isMethodDeclaration(fn)) return fn.getNameNode();
  const p = fn.getParent();
  if (p && (Node.isVariableDeclaration(p) || Node.isPropertyAssignment(p) || Node.isPropertyDeclaration(p))) return p.getNameNode();
  return undefined;
}

/** Local import bindings from the Jev packages (resolved by declaration, so shadowed names don't count). */
function jevImports(sf: SourceFile) {
  const sdk = new Map<string, string>(); // local name → exported name
  const namespaces = new Set<string>();
  const aiSdkProvider = new Set<string>();
  const aiEvaluate = new Set<string>();
  const specifiers: string[] = [];
  for (const imp of sf.getImportDeclarations()) {
    const mod = imp.getModuleSpecifierValue();
    if (JEV_SDK_MODULES.has(mod)) {
      specifiers.push(mod);
      for (const n of imp.getNamedImports()) sdk.set(n.getAliasNode()?.getText() ?? n.getName(), n.getName());
      const ns = imp.getNamespaceImport();
      if (ns) namespaces.add(ns.getText());
      const def = imp.getDefaultImport();
      if (def) namespaces.add(def.getText());
    } else if (mod === JEV_AI_SDK_PROVIDER) {
      specifiers.push(mod);
      for (const n of imp.getNamedImports()) aiSdkProvider.add(n.getAliasNode()?.getText() ?? n.getName());
    } else if (mod === AI_SDK_MODULE) {
      for (const n of imp.getNamedImports()) if (AI_SDK_EVALUATE.has(n.getName())) aiEvaluate.add(n.getAliasNode()?.getText() ?? n.getName());
    }
  }
  // const { choice, TypeSafeClient } = require("@typesafe-ai/sdk")
  for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    if (call.getExpression().getText() !== "require") continue;
    const arg = call.getArguments()[0];
    if (!arg || !Node.isStringLiteral(arg) || !JEV_SDK_MODULES.has(arg.getLiteralValue())) continue;
    specifiers.push(arg.getLiteralValue());
    const decl = call.getFirstAncestorByKind(SyntaxKind.VariableDeclaration);
    const nameNode = decl?.getNameNode();
    if (nameNode && Node.isObjectBindingPattern(nameNode))
      for (const el of nameNode.getElements()) sdk.set(el.getName(), el.getPropertyNameNode()?.getText() ?? el.getName());
    else if (nameNode) namespaces.add(nameNode.getText());
  }
  return { sdk, namespaces, aiSdkProvider, aiEvaluate, specifiers };
}

/** Is this identifier really bound to the import (not a local variable with the same name)? */
function boundToImport(id: Node): boolean {
  const decl = id.getSymbol()?.getDeclarations()?.[0];
  if (!decl) return true; // unresolved in a JS file without type info: the file-level import is the best evidence
  return Node.isImportSpecifier(decl) || Node.isNamespaceImport(decl) || Node.isImportClause(decl) || Node.isBindingElement(decl);
}

function stringOf(n: Node | undefined): string | undefined {
  if (!n) return undefined;
  if (Node.isStringLiteral(n) || Node.isNoSubstitutionTemplateLiteral(n)) return n.getLiteralValue();
  if (Node.isTemplateExpression(n)) return n.getText().slice(1, -1);
  if (Node.isCallExpression(n)) return stringOf(n.getArguments()[0]); // frame("…") style helpers
  return undefined;
}

function objectKeys(n: Node | undefined): string[] | undefined {
  if (!n || !Node.isObjectLiteralExpression(n)) return undefined;
  return n
    .getProperties()
    .map((p) => (Node.isPropertyAssignment(p) || Node.isShorthandPropertyAssignment(p) || Node.isMethodDeclaration(p) ? p.getName() : undefined))
    .filter((x): x is string => Boolean(x))
    .map((k) => k.replace(/^["']|["']$/g, ""))
    .slice(0, 12);
}

/** Key under which a question sits in a questions object (`{ category: choice(…) }` / `questions.x = …`). */
function questionKey(n: Node): string | undefined {
  const p = n.getParent();
  if (p && Node.isPropertyAssignment(p)) return p.getName().replace(/^["']|["']$/g, "");
  if (p && Node.isBinaryExpression(p)) {
    const left = p.getLeft().getText();
    const m = left.match(/\[\s*[`"']?([^`"'\]]+)[`"']?\s*\]$|\.(\w+)$/);
    return m ? (m[1] ?? m[2]) : undefined;
  }
  return undefined;
}

function rawQuestion(o: ObjectLiteralExpression): { primitive: JevPrimitiveKind; text?: string; outcomes?: string[]; scale?: number } | undefined {
  const props = new Map<string, Node>();
  for (const p of o.getProperties()) {
    if (Node.isPropertyAssignment(p)) props.set(p.getName().replace(/^["']|["']$/g, ""), p.getInitializer() ?? p);
    else if (Node.isShorthandPropertyAssignment(p)) props.set(p.getName(), p.getNameNode());
  }
  const type = stringOf(props.get("type"));
  if (!type || !BUILDERS.has(type as JevPrimitiveKind)) return undefined;
  const keys = [...props.keys()];
  if (keys.some((k) => ANSWER_PROPS.has(k)) || !keys.some((k) => QUESTION_PROPS.has(k))) return undefined;
  const instr = props.get("instructions") ?? props.get("question") ?? props.get("text") ?? props.get("prompt") ?? props.get("description");
  let text = stringOf(instr);
  if (!text && instr && Node.isObjectLiteralExpression(instr)) {
    const q = instr.getProperty("question");
    text = q && Node.isPropertyAssignment(q) ? stringOf(q.getInitializer()) : undefined;
  }
  const legend = props.get("legend");
  return {
    primitive: type as JevPrimitiveKind,
    text: text ? clip(text) : undefined,
    outcomes: type === "choice" ? objectKeys(props.get("criteria")) : undefined,
    scale: type === "score" && legend && (Node.isArrayLiteralExpression(legend) || Node.isObjectLiteralExpression(legend)) ? (Node.isArrayLiteralExpression(legend) ? legend.getElements().length : legend.getProperties().length) : undefined
  };
}

export interface FindJevUsageOptions {
  root: string;
  files: SourceFile[];
}

/** Find observed Jev usage in a project. Pure and offline. */
export function findJevUsage(opts: FindJevUsageOptions): JevUsageReport {
  const root = path.resolve(opts.root);
  const relOf = (sf: SourceFile) => path.relative(root, sf.getFilePath()).split(path.sep).join("/");
  const drafts = new Map<string, Draft>();
  const excluded: JevUsageReport["excluded"] = [];
  const executors = new Map<string, { fn: FunctionLike; file: string; tier: JevEvidenceTier }>(); // functions that perform a Jev call
  let sdkImports = 0;

  const draft = (file: string, owner: Owner) => {
    const k = ownerKey(file, owner);
    let d = drafts.get(k);
    if (!d) drafts.set(k, (d = { file, owner, questions: [], calls: [], questionSets: new Set(), evidence: new Set() }));
    return d;
  };
  const addCall = (file: string, at: Node, call: Omit<JevCallRef, "line" | "text">, text?: string) => {
    const owner = ownerOf(at);
    const d = draft(file, owner);
    d.calls.push({ ...call, line: at.getStartLineNumber(), text: clip(text ?? at.getText(), 160) });
    if (owner.kind === "function" && call.kind !== "wrapper_call") {
      const k = ownerKey(file, owner);
      const prev = executors.get(k);
      executors.set(k, { fn: owner.fn, file, tier: prev ? better(prev.tier, call.tier) : call.tier });
    }
    return d;
  };

  for (const sf of opts.files) {
    const file = relOf(sf);
    const role = fileRole(file);
    const imp = jevImports(sf);
    const linked = imp.specifiers.length > 0;
    const text = sf.getFullText();
    const mentions = linked || /systemOne|typesafe|\/jev\b|jev-latest/i.test(text);
    if (!mentions && !/type\s*:\s*["'](noul|choice|score)["']/.test(text)) continue;
    if (role === "test" || role === "story") {
      if (mentions) excluded.push({ file, line: 1, reason: `${role} file (fakes / stubs are common; never an anchor)` });
      continue;
    }
    if (linked) sdkImports++;

    for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      const callee = call.getExpression();
      // choice / noul / score builders from the SDK (import-bound, not shadowed)
      let builder: string | undefined;
      if (Node.isIdentifier(callee) && imp.sdk.has(callee.getText()) && boundToImport(callee)) builder = imp.sdk.get(callee.getText());
      else if (Node.isPropertyAccessExpression(callee) && imp.namespaces.has(callee.getExpression().getText())) builder = callee.getName();
      if (builder && BUILDERS.has(builder as JevPrimitiveKind)) {
        recordBuilder(file, call, builder as JevPrimitiveKind);
        continue;
      }
      // AI SDK: experimental_evaluate({ model: typeSafeAi…, questions })
      if (Node.isIdentifier(callee) && imp.aiEvaluate.has(callee.getText()) && imp.aiSdkProvider.size > 0) {
        addCall(file, call, { kind: "ai_sdk_evaluate", tier: "definite" }).evidence.add(`${callee.getText()}() from "ai" with ${JEV_AI_SDK_PROVIDER} imported in the same file`);
        noteQuestionSetArgs(file, call);
      }
    }
    // systemOne: calls and references
    for (const pa of sf.getDescendantsOfKind(SyntaxKind.PropertyAccessExpression)) {
      if (pa.getName() !== "systemOne") continue;
      const parent = pa.getParent();
      const isCall = parent && Node.isCallExpression(parent) && parent.getExpression() === pa;
      const typeText = (() => {
        try {
          return pa.getExpression().getType().getText();
        } catch {
          return "";
        }
      })();
      const definite = linked || /TypeSafeClient/.test(typeText);
      const tier: JevEvidenceTier = definite ? "definite" : "uncertain";
      const d = addCall(file, pa, { kind: isCall ? "sdk_system_one" : "sdk_system_one_ref", tier }, isCall ? parent!.getText() : pa.getText());
      d.evidence.add(definite ? `systemOne on a TypeSafe client (${imp.specifiers[0] ?? "typed TypeSafeClient"})` : "systemOne on an unresolved receiver");
      if (isCall) noteQuestionSetArgs(file, parent as CallExpression);
    }
    // Known Jev endpoints / model ids
    for (const lit of [...sf.getDescendantsOfKind(SyntaxKind.StringLiteral), ...sf.getDescendantsOfKind(SyntaxKind.NoSubstitutionTemplateLiteral)]) {
      const v = lit.getLiteralValue();
      const hit = ENDPOINTS.find((e) => e.re.test(v));
      if (!hit) continue;
      // module-level constant (e.g. TYPESAFE_URL): the executors are the functions that use it
      const decl = lit.getFirstAncestorByKind(SyntaxKind.VariableDeclaration);
      const inFn = ownerOf(lit).kind === "function";
      if (!inFn && decl) {
        let used = 0;
        for (const ref of safeRefs(decl.getNameNode())) {
          if (ref === decl.getNameNode() || ownerOf(ref).kind !== "function") continue;
          addCall(relOf(ref.getSourceFile()), ref, { kind: hit.kind, tier: hit.tier }, `${decl.getName()} → ${hit.what}`).evidence.add(`uses ${decl.getName()} (${hit.what})`);
          used++;
        }
        if (!used) draft(file, ownerOf(lit)).evidence.add(`${hit.what} declared, no function uses it`);
      } else addCall(file, lit, { kind: hit.kind, tier: hit.tier }, hit.what).evidence.add(`${hit.what} in this function`);
    }
    // Raw question objects ({ type: "noul", instructions, … })
    for (const o of sf.getDescendantsOfKind(SyntaxKind.ObjectLiteralExpression)) {
      const q = rawQuestion(o);
      if (!q) continue;
      const owner = ownerOf(o);
      const d = draft(file, owner);
      d.questions.push({ key: questionKey(o), primitive: q.primitive, text: q.text, outcomes: q.outcomes, scale: q.scale, line: o.getStartLineNumber(), how: "raw_object", tier: "uncertain" });
      d.evidence.add("question-shaped object literal (type noul/choice/score)");
    }
  }

  function recordBuilder(file: string, call: CallExpression, primitive: JevPrimitiveKind) {
    const args = call.getArguments();
    const d = draft(file, ownerOf(call));
    const legend = args[1];
    d.questions.push({
      key: questionKey(call),
      primitive,
      text: stringOf(args[0]) ? clip(stringOf(args[0])!) : undefined,
      outcomes: primitive === "choice" ? objectKeys(args[1]) : undefined,
      scale: primitive === "score" && legend && Node.isArrayLiteralExpression(legend) ? legend.getElements().length : undefined,
      line: call.getStartLineNumber(),
      how: "sdk_builder",
      tier: "definite"
    });
    d.evidence.add(`${primitive}() from the Jev SDK`);
  }

  /** systemOne({ questions: X }) / evaluate({ questions: X }) with X a module-level const: remember the link. */
  function noteQuestionSetArgs(file: string, call: CallExpression) {
    const arg = call.getArguments()[0];
    if (!arg || !Node.isObjectLiteralExpression(arg)) return;
    const qp = arg.getProperty("questions");
    const init = qp && Node.isPropertyAssignment(qp) ? qp.getInitializer() : qp && Node.isShorthandPropertyAssignment(qp) ? qp.getNameNode() : undefined;
    if (init && Node.isIdentifier(init)) draft(file, ownerOf(call)).questionSets.add(init.getText());
  }

  // ─── /api/jev routes count only when the project has a server-side proxy that calls Jev ───
  const hasJevExecutor = [...drafts.values()].some((d) => d.calls.some((c) => c.kind !== "http_local_jev_proxy" && c.kind !== "wrapper_call" && (c.tier === "definite" || c.tier === "likely")));
  for (const [k, d] of drafts) {
    const proxied = d.calls.filter((c) => c.kind === "http_local_jev_proxy");
    if (!proxied.length) continue;
    if (hasJevExecutor) d.evidence.add("the project has a server-side proxy that forwards to the Jev API");
    else {
      for (const c of proxied) c.tier = "uncertain";
      if (d.calls.every((c) => c.tier === "uncertain")) executors.delete(k);
    }
  }

  // ─── Question sources: module-level question sets, question factories, local builders ───
  // A set: `const ACTION_QUESTIONS = { risk: { type: "score", … } }` / `const QUESTIONS = { x: score(…) }`.
  // A factory: a function that builds questions but asks nothing itself (`stepQuestions()`).
  // A local builder: a project's own `noul(text)` helper returning one question-shaped object.
  // Links are resolved through the TypeScript symbol table (imports followed), never by name alone.
  const sourceByDecl = new Map<Node, { d: Draft; kind: "set" | "factory" | "builder" }>();
  const declOf = (fn: FunctionLike): Node => (Node.isFunctionDeclaration(fn) || Node.isMethodDeclaration(fn) ? fn : fn.getParent() && Node.isVariableDeclaration(fn.getParent()!) ? fn.getParent()! : fn);
  // 1. local builders: `const noul = (instructions) => ({ type: "noul", instructions })`
  const builders = new Set<Draft>();
  for (const d of drafts.values()) {
    if (d.owner.kind !== "function" || d.calls.length || d.questions.length !== 1) continue;
    const fn = d.owner.fn;
    const q = d.questions[0]!;
    const params = Node.isFunctionDeclaration(fn) || Node.isArrowFunction(fn) || Node.isFunctionExpression(fn) || Node.isMethodDeclaration(fn) ? fn.getParameters().length : 0;
    if (q.how !== "raw_object" || q.key || params === 0) continue;
    builders.add(d);
    sourceByDecl.set(declOf(fn), { d, kind: "builder" });
  }
  // 2. every call of a local builder is a question definition where it is called
  for (const b of builders) {
    const nn = nameNodeOf((b.owner as { fn: FunctionLike }).fn);
    if (!nn) continue;
    const proto = b.questions[0]!;
    for (const ref of safeRefs(nn)) {
      const call = ref.getParent();
      if (!call || !Node.isCallExpression(call) || call.getExpression() !== ref) continue;
      const refFile = relOf(ref.getSourceFile());
      if (fileRole(refFile) === "test") continue;
      const d = draft(refFile, ownerOf(call));
      if (builders.has(d)) continue;
      const text = stringOf(call.getArguments()[0]);
      d.questions.push({ key: questionKey(call), primitive: proto.primitive, text: text ? clip(text) : undefined, outcomes: proto.primitive === "choice" ? objectKeys(call.getArguments()[1]) : undefined, line: call.getStartLineNumber(), how: "raw_object", tier: "uncertain" });
      d.evidence.add(`${proto.primitive}() — the project's own question-builder helper (${b.file}:${(b.owner as { fn: FunctionLike }).fn.getStartLineNumber()})`);
    }
  }
  // 3. sets (module level) and factories (functions that build but don't ask)
  for (const d of drafts.values()) {
    if (!d.questions.length || builders.has(d)) continue;
    if (d.owner.kind === "module") sourceByDecl.set(d.owner.node, { d, kind: "set" });
    else if (!d.calls.length) sourceByDecl.set(declOf(d.owner.fn), { d, kind: "factory" });
  }
  const used = new Set<Draft>();

  function resolveSource(id: Node): { d: Draft; kind: "set" | "factory" | "builder" } | undefined {
    try {
      const holder = id.getParent();
      // `{ questions }` — the shorthand's own symbol is the property; the value symbol is the variable
      let sym = holder && Node.isShorthandPropertyAssignment(holder) && holder.getNameNode() === id ? holder.getValueSymbol() : id.getSymbol();
      if (!sym) return undefined;
      if (sym.isAlias()) sym = sym.getAliasedSymbol() ?? sym;
      for (const decl of sym.getDeclarations()) {
        const hit = sourceByDecl.get(decl) ?? (decl.getParent() ? sourceByDecl.get(decl.getParent()!) : undefined);
        if (hit) return hit;
      }
    } catch {
      /* unresolvable (JS without type info): no link */
    }
    return undefined;
  }

  /** Fold the question sets / factories / builder calls a function refers to into it. */
  function linkQuestions(d: Draft): boolean {
    if (d.owner.kind !== "function") return false;
    const body = d.owner.fn.getBody();
    if (!body) return false;
    let found = false;
    const seen = new Set<Draft>();
    for (const id of body.getDescendantsOfKind(SyntaxKind.Identifier)) {
      const src = resolveSource(id);
      if (!src || src.d === d) continue;
      const parent = id.getParent();
      const call = parent && Node.isCallExpression(parent) && parent.getExpression() === id ? parent : undefined;
      if (src.kind === "builder") continue; // already expanded at every call site
      if (src.kind === "factory" && !call) continue;
      if (seen.has(src.d)) continue;
      seen.add(src.d);
      found = true;
      used.add(src.d);
      const name = id.getText();
      d.questionSets.add(name);
      for (const q of src.d.questions) d.questions.push({ ...q });
      d.evidence.add(src.kind === "set" ? `uses question set ${name} (${src.d.file}:${(src.d.owner as { node: Node }).node.getStartLineNumber()})` : `asks questions built by ${name}() (${src.d.file}:${(src.d.owner as { fn: FunctionLike }).fn.getStartLineNumber()})`);
    }
    return found;
  }
  const isDecision = (d: Draft | undefined) => Boolean(d && (d.questions.length || linkQuestions(d)));

  // Functions that perform a Jev call directly: link their questions first.
  for (const k of executors.keys()) isDecision(drafts.get(k));

  // ─── Wrappers: callers of functions that perform a Jev call (verified by the call graph) ───
  // Walk up from executors that are plumbing (no questions of their own). Stop at the first
  // function that defines or uses questions: that is the decision; its callers are just callers.
  const wrapperOf = new Map<string, { name: string; file: string; line: number; tier: JevEvidenceTier }>();
  for (const [k, ex] of executors) wrapperOf.set(k, { name: unitName(ex.fn).name, file: ex.file, line: ex.fn.getStartLineNumber(), tier: ex.tier });
  let frontier = [...executors.entries()].filter(([k]) => !drafts.get(k)?.questions.length);
  for (let depth = 0; depth < 4 && frontier.length; depth++) {
    const next: typeof frontier = [];
    for (const [k, ex] of frontier) {
      const nameNode = nameNodeOf(ex.fn);
      if (!nameNode) continue;
      const w = wrapperOf.get(k)!;
      for (const ref of safeRefs(nameNode)) {
        if (ref === nameNode) continue;
        const p = ref.getParent();
        const isCall = p && Node.isCallExpression(p) && p.getExpression() === ref;
        const pa = p && Node.isPropertyAccessExpression(p) && p.getNameNode() === ref ? p : undefined;
        const callNode = isCall ? p : pa && pa.getParent() && Node.isCallExpression(pa.getParent()!) ? pa.getParent()! : undefined;
        if (!callNode || !Node.isCallExpression(callNode)) continue;
        const refFile = relOf(ref.getSourceFile());
        if (fileRole(refFile) === "test") continue;
        const owner = ownerOf(callNode);
        if (owner.kind !== "function") continue;
        const ok = ownerKey(refFile, owner);
        if (ok === k) continue;
        const cd = draft(refFile, owner);
        cd.calls.push({ kind: "wrapper_call", line: callNode.getStartLineNumber(), text: clip(callNode.getText(), 160), via: { name: w.name, file: w.file, line: w.line }, tier: "wrapper" });
        cd.evidence.add(`calls ${w.name} (${w.file}:${w.line}), which performs a ${w.tier} Jev call`);
        if (isDecision(cd) || wrapperOf.has(ok)) continue; // a decision: stop here
        wrapperOf.set(ok, { name: unitName(owner.fn).name, file: refFile, line: owner.fn.getStartLineNumber(), tier: "wrapper" });
        next.push([ok, { fn: owner.fn, file: refFile, tier: "wrapper" }]);
      }
    }
    frontier = next;
  }
  // ─── Assemble sites ───
  const sites: JevSite[] = [];
  const uncertain: JevSite[] = [];
  for (const d of drafts.values()) {
    if (used.has(d)) continue; // a question set / factory folded into the decision that asks it
    if (builders.has(d)) continue; // a local question-builder helper, not a decision
    if (!d.questions.length && !d.calls.length) continue;
    // raw question objects become real only with a Jev call in the same function
    const callTier = d.calls.reduce<JevEvidenceTier>((t, c) => better(t, c.tier), "uncertain");
    for (const q of d.questions) if (q.how === "raw_object" && q.tier === "uncertain" && callTier !== "uncertain") q.tier = callTier;
    const qTier = d.questions.reduce<JevEvidenceTier>((t, q) => better(t, q.tier), "uncertain");
    const tier = better(callTier, qTier);
    const hasQuestions = d.questions.some((q) => q.tier !== "uncertain");
    const role: JevSiteRole = hasQuestions ? (d.calls.some((c) => c.tier !== "uncertain") ? "decision" : "questions") : "plumbing";
    const unit =
      d.owner.kind === "function"
        ? { name: unitName(d.owner.fn).name, start: d.owner.fn.getStartLineNumber(), end: d.owner.fn.getEndLineNumber() }
        : { name: d.owner.name, start: d.owner.node.getStartLineNumber(), end: d.owner.node.getEndLineNumber() };
    const code = d.owner.kind === "function" ? d.owner.fn.getText() : d.owner.node.getText();
    const callers =
      d.owner.kind === "function"
        ? (() => {
            const nn = nameNodeOf(d.owner.fn);
            if (!nn) return [];
            return safeRefs(nn)
              .filter((r) => r !== nn && fileRole(relOf(r.getSourceFile())) !== "test")
              .map((r) => ({ r, o: ownerOf(r) }))
              .filter((x) => x.o.kind === "function")
              .slice(0, 10)
              .map((x) => ({ file: relOf(x.r.getSourceFile()), name: unitName((x.o as { fn: FunctionLike }).fn).name, line: x.r.getStartLineNumber() }));
          })()
        : [];
    const site: JevSite = {
      id: sha(`${d.file}\0${unit.name}\0${unit.start}`).slice(0, 16),
      file: d.file,
      unit,
      role,
      tier,
      questions: d.questions.sort((a, b) => a.line - b.line),
      calls: d.calls.sort((a, b) => a.line - b.line),
      questionSets: [...d.questionSets],
      evidence: [...d.evidence],
      callers,
      codeHash: sha(code)
    };
    (tier === "uncertain" ? uncertain : sites).push(site);
  }
  const order = (a: JevSite, b: JevSite) => TIER_RANK[a.tier] - TIER_RANK[b.tier] || a.file.localeCompare(b.file) || a.unit.start - b.unit.start;
  sites.sort(order);
  uncertain.sort(order);
  return {
    version: JEV_FINDER_VERSION,
    root,
    sites,
    uncertain,
    excluded,
    stats: {
      files: opts.files.length,
      sdkImports,
      decisionSites: sites.filter((s) => s.role === "decision").length,
      questionSites: sites.filter((s) => s.role === "questions").length,
      plumbingSites: sites.filter((s) => s.role === "plumbing").length,
      uncertainSites: uncertain.length,
      questions: sites.reduce((n, s) => n + s.questions.length, 0)
    }
  };
}

/** Reference search that never throws (JS files without type info, odd syntax). */
function safeRefs(n: Node): Node[] {
  try {
    return Node.isIdentifier(n) || Node.isStringLiteral(n) ? (n as Node & { findReferencesAsNodes(): Node[] }).findReferencesAsNodes() : [];
  } catch {
    return [];
  }
}
