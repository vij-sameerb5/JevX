import { createHash } from "node:crypto";
import path from "node:path";
import { Node, SyntaxKind, type SourceFile, type CallExpression } from "ts-morph";
import { bandFor, type Candidate, type DetectorOptions, type FiredSignal, type RootKind, type SignalId } from "@jevx/core";
import {
  CODE_WORDS,
  TextOracle,
  nameTokens,
  isMultiWord,
  isWordLike,
  regexNaturalWords,
  resolveInitializer,
  stringLiteralValue,
  unwrap,
  wordLeaves
} from "./text.js";

type SiteKind = "includes" | "equals" | "regex" | "membership" | "fuzzy" | "switch";

interface Site {
  kind: SiteKind;
  node: Node;
  normalized: boolean;
  /** Literal values this site matches against. */
  literals: string[];
  /** Short evidence text. */
  evidence: string;
  regexWords?: string[];
  /** Membership sites: is the value being looked up human text? */
  human?: boolean;
}

const MATCH_METHODS = new Set(["includes", "startsWith", "endsWith", "indexOf", "lastIndexOf"]);
const REGEX_METHODS_ON_STRING = new Set(["match", "matchAll", "search"]);
const FUZZY_NAME = /(levenshtein|leven|similarity|similar|fuzzy|fuzz|jaro|winkler|dice|damerau|didyoumean|closestmatch|bestmatch|editdistance|stringdistance|comparetwostrings)/i;
const FUZZY_MODULES = /^(fuse\.js|string-similarity|fast-levenshtein|leven|js-levenshtein|fastest-levenshtein|natural|didyoumean|didyoumean2|fuzzball|fuzzysort|talisman)/;

function short(text: string, max = 70): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length > max ? oneLine.slice(0, max - 1) + "…" : oneLine;
}

function lineOf(node: Node): number {
  return node.getStartLineNumber();
}

function isStringType(node: Node): boolean | undefined {
  try {
    const type = node.getType();
    if (type.isAny() || type.isUnknown()) return undefined;
    if (type.isString() || type.isStringLiteral()) return true;
    if (type.isUnion() && type.getUnionTypes().every((u) => u.isString() || u.isStringLiteral() || u.isUndefined() || u.isNull())) {
      return true;
    }
    if (type.isArray() || type.isTuple()) return false;
    return undefined;
  } catch {
    return undefined;
  }
}

/** Find the regex a node refers to: /x/, new RegExp("x"), or an identifier bound to either. */
function regexSource(node: Node, depth = 0): { source: string; flags: string } | undefined {
  if (depth > 3) return undefined;
  if (Node.isRegularExpressionLiteral(node)) {
    const text = node.getLiteralText();
    const lastSlash = text.lastIndexOf("/");
    return { source: text.slice(1, lastSlash), flags: text.slice(lastSlash + 1) };
  }
  if (Node.isNewExpression(node) || Node.isCallExpression(node)) {
    const callee = node.getExpression();
    if (Node.isIdentifier(callee) && callee.getText() === "RegExp") {
      const [first, second] = node.getArguments();
      if (!first) return undefined;
      const lit = stringLiteralValue(first);
      const flags = stringLiteralValue(second) ?? "";
      if (lit !== undefined) return { source: lit, flags };
      // new RegExp(KEYWORDS.join("|")) — reconstruct from the list
      const words = collectWordsFromExpression(first, depth + 1);
      if (words.length) return { source: words.join("|"), flags };
    }
  }
  if (Node.isIdentifier(node)) {
    const init = resolveInitializer(node);
    if (init) return regexSource(init, depth + 1);
  }
  return undefined;
}

/** Resolve an expression (identifier, literal, `.join()`) to the word list it is built from. */
function collectWordsFromExpression(node: Node, depth = 0): string[] {
  if (depth > 4) return [];
  const { expr } = unwrap(node);
  if (Node.isIdentifier(expr)) {
    const init = resolveInitializer(expr);
    return init ? collectWordsFromExpression(init, depth + 1) : [];
  }
  if (Node.isCallExpression(expr)) {
    const callee = expr.getExpression();
    if (Node.isPropertyAccessExpression(callee)) {
      // KEYWORDS.join("|"), Object.values(INTENTS).flat(), Object.keys(X)
      const target = callee.getExpression();
      if (Node.isIdentifier(target) && ["Object"].includes(target.getText())) {
        const arg = expr.getArguments()[0];
        return arg ? collectWordsFromExpression(arg, depth + 1) : [];
      }
      return collectWordsFromExpression(target, depth + 1);
    }
  }
  if (Node.isPropertyAccessExpression(expr) || Node.isElementAccessExpression(expr)) {
    return collectWordsFromExpression(expr.getExpression(), depth + 1);
  }
  const leaves = wordLeaves(expr);
  if (Node.isObjectLiteralExpression(expr)) {
    // Object keys count too: { refund: [...], billing: [...] }
    for (const prop of expr.getProperties()) {
      if (Node.isPropertyAssignment(prop)) {
        const name = prop.getName().replace(/^["']|["']$/g, "");
        if (isWordLike(name)) leaves.push(name);
      }
    }
  }
  return leaves;
}

class FileDetector {
  private readonly sites: Site[] = [];
  private readonly oracle: TextOracle;
  private readonly labelSet: Set<string>;
  private readonly fileHash: string;

  constructor(
    private readonly sf: SourceFile,
    private readonly root: string,
    private readonly opts: DetectorOptions
  ) {
    this.oracle = new TextOracle(opts.humanTextNames);
    this.labelSet = new Set(opts.labels.map((l) => l.toLowerCase()));
    this.fileHash = createHash("sha256").update(sf.getFullText()).digest("hex");
  }

  run(): Candidate[] {
    this.collectSites();
    return this.buildCandidates();
  }

  // ─── Sites ────────────────────────────────────────────────────────────

  private fuzzyImports(): Set<string> {
    const names = new Set<string>();
    for (const imp of this.sf.getImportDeclarations()) {
      if (!FUZZY_MODULES.test(imp.getModuleSpecifierValue())) continue;
      const def = imp.getDefaultImport();
      if (def) names.add(def.getText());
      const ns = imp.getNamespaceImport();
      if (ns) names.add(ns.getText());
      for (const n of imp.getNamedImports()) names.add((n.getAliasNode() ?? n.getNameNode()).getText());
    }
    // const leven = require("leven")
    for (const call of this.sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      if (call.getExpression().getText() !== "require") continue;
      const mod = stringLiteralValue(call.getArguments()[0]);
      if (!mod || !FUZZY_MODULES.test(mod)) continue;
      const decl = call.getFirstAncestorByKind(SyntaxKind.VariableDeclaration);
      if (decl) names.add(decl.getNameNode().getText());
    }
    return names;
  }

  private collectSites(): void {
    const fuzzyNames = this.fuzzyImports();

    this.sf.forEachDescendant((node) => {
      if (Node.isCallExpression(node)) {
        this.callSite(node, fuzzyNames);
      } else if (Node.isBinaryExpression(node)) {
        const op = node.getOperatorToken().getKind();
        if (
          op === SyntaxKind.EqualsEqualsEqualsToken ||
          op === SyntaxKind.EqualsEqualsToken ||
          op === SyntaxKind.ExclamationEqualsEqualsToken ||
          op === SyntaxKind.ExclamationEqualsToken
        ) {
          this.equalitySite(node.getLeft(), node.getRight(), node);
        }
      } else if (Node.isSwitchStatement(node)) {
        this.switchSite(node);
      } else if (Node.isNewExpression(node)) {
        const callee = node.getExpression().getText();
        if (fuzzyNames.has(callee) || /^Fuse$/.test(callee)) {
          this.sites.push({ kind: "fuzzy", node, normalized: false, literals: [], evidence: short(node.getText()) });
        }
      }
    });
  }

  private callSite(call: CallExpression, fuzzyNames: Set<string>): void {
    const callee = call.getExpression();
    const args = call.getArguments();

    // Fuzzy: leven(a, b), stringSimilarity.compareTwoStrings(a, b), fuse.search(q)
    const calleeText = callee.getText();
    const calleeName = Node.isPropertyAccessExpression(callee) ? callee.getName() : calleeText;
    const rootName = calleeText.split(/[.(]/)[0] ?? "";
    if (fuzzyNames.has(rootName) || (FUZZY_NAME.test(calleeName) && args.length >= 1 && !/test|spec/i.test(calleeName))) {
      const normalized = args.some((a) => this.oracle.judge(a).normalized);
      this.sites.push({ kind: "fuzzy", node: call, normalized, literals: [], evidence: short(call.getText()) });
      return;
    }

    if (!Node.isPropertyAccessExpression(callee)) return;
    const method = callee.getName();
    const receiver = callee.getExpression();

    // GREETINGS.has(text.trim().toLowerCase()) — Set / Map membership of free text.
    if (method === "has" && args.length === 1) {
      const recvWords = collectWordsFromExpression(receiver);
      const argJudged = this.oracle.judge(args[0]!);
      if (argJudged.machine) return;
      if (recvWords.length >= 2 && argJudged.human) {
        this.sites.push({
          kind: "membership",
          node: call,
          normalized: argJudged.normalized,
          literals: recvWords,
          evidence: short(call.getText()),
          human: true
        });
      }
      return;
    }

    if (MATCH_METHODS.has(method) && args.length >= 1) {
      const arg = args[0]!;
      const argValue = stringLiteralValue(arg);
      const recvIsString = isStringType(unwrap(receiver).expr);
      const judged = this.oracle.judge(receiver);
      if (judged.machine) return; // e.message.includes("timeout") — library text, not a person's

      // Membership: KEYWORDS.includes(word) — receiver is a word list, argument is text.
      const recvWords = recvIsString === true ? [] : collectWordsFromExpression(receiver);
      if (recvWords.length >= 2 && method === "includes") {
        const argJudged = this.oracle.judge(arg);
        if (argJudged.machine) return;
        if (argJudged.human || recvWords.length >= this.opts.keywordListMin) {
          this.sites.push({
            kind: "membership",
            node: call,
            normalized: argJudged.normalized,
            literals: recvWords,
            evidence: short(call.getText()),
            human: argJudged.human
          });
        }
        return;
      }
      if (recvIsString === false) return;

      const argOk = argValue === undefined ? true : isWordLike(argValue) || isMultiWord(argValue);
      const multi = argValue !== undefined && isMultiWord(argValue);
      if ((judged.human && argOk) || multi) {
        this.sites.push({
          kind: "includes",
          node: call,
          normalized: judged.normalized,
          literals: argValue !== undefined ? [argValue] : [],
          evidence: short(call.getText())
        });
      }
      return;
    }

    // text.match(/refund|money back/i), text.search(re)
    if (REGEX_METHODS_ON_STRING.has(method) && args.length >= 1) {
      const re = regexSource(args[0]!);
      if (re) this.regexSite(call, receiver, re);
      return;
    }
    // /refund/i.test(text)
    if (method === "test" && args.length >= 1) {
      const re = regexSource(receiver);
      if (re) this.regexSite(call, args[0]!, re);
    }
  }

  private regexSite(call: Node, textNode: Node, re: { source: string; flags: string }): void {
    const words = regexNaturalWords(re.source);
    if (words.length === 0) return;
    const judged = this.oracle.judge(textNode);
    if (judged.machine) return;
    const strongPattern = words.length >= 2 || words.some(isMultiWord);
    if (!judged.human && !strongPattern) return;
    if (!judged.human && words.length < 2) return;
    this.sites.push({
      kind: "regex",
      node: call,
      normalized: judged.normalized || re.flags.includes("i"),
      literals: words,
      regexWords: words,
      evidence: short(call.getText())
    });
  }

  private equalitySite(left: Node, right: Node, node: Node): void {
    const lv = stringLiteralValue(left);
    const rv = stringLiteralValue(right);
    const [textSide, value] = lv !== undefined ? [right, lv] : rv !== undefined ? [left, rv] : [undefined, undefined];
    if (!textSide || value === undefined) return;
    if (!(isWordLike(value) || isMultiWord(value))) return;
    const judged = this.oracle.judge(textSide);
    if (judged.machine || !judged.human) return;
    this.sites.push({ kind: "equals", node, normalized: judged.normalized, literals: [value], evidence: short(node.getText()) });
  }

  private switchSite(sw: Node): void {
    if (!Node.isSwitchStatement(sw)) return;
    const disc = sw.getExpression();
    const judged = this.oracle.judge(disc);
    if (judged.machine) return;
    const labels: string[] = [];
    for (const clause of sw.getClauses()) {
      if (!Node.isCaseClause(clause)) continue;
      const v = stringLiteralValue(clause.getExpression());
      if (v !== undefined && (isWordLike(v) || isMultiWord(v))) labels.push(v);
    }
    const multi = labels.filter(isMultiWord).length;
    if (labels.length < 2) return;
    if (!judged.human && multi < 2) return;
    // Enum-like labels ("GET", "ADD_TODO", "png") are filtered by isWordLike already.
    this.sites.push({
      kind: "switch",
      node: sw,
      normalized: judged.normalized,
      literals: labels,
      evidence: `switch (${short(disc.getText(), 40)}) with ${labels.length} text cases`
    });
  }

  // ─── Grouping ─────────────────────────────────────────────────────────

  /** Climb from a site to the decision it belongs to. */
  private rootOf(site: Site): { node: Node; kind: RootKind } {
    if (site.kind === "switch") return { node: site.node, kind: "switch" };
    let child: Node = site.node;
    let parent = child.getParent();
    while (parent) {
      if (Node.isIfStatement(parent) && parent.getExpression() === child) {
        return { node: topOfIfChain(parent), kind: "if-chain" };
      }
      if (Node.isConditionalExpression(parent) && parent.getCondition() === child) {
        return { node: parent, kind: "ternary" };
      }
      if (Node.isSwitchStatement(parent) && parent.getExpression() === child) {
        return { node: parent, kind: "switch" };
      }
      if (Node.isCaseClause(parent) && parent.getExpression() === child) {
        const sw = parent.getParentOrThrow().getParentOrThrow();
        return { node: sw, kind: "switch" };
      }
      if (Node.isFunctionLikeDeclaration(parent) || Node.isArrowFunction(parent) || Node.isFunctionExpression(parent)) {
        // Callbacks passed inline (`.some(w => text.includes(w))`) belong to the outer decision.
        const gp = parent.getParent();
        if (gp && Node.isCallExpression(gp) && gp.getArguments().includes(parent as never)) {
          child = parent;
          parent = gp;
          continue;
        }
        return { node: parent, kind: "function" };
      }
      if (Node.isSourceFile(parent)) {
        return { node: child, kind: "statement" };
      }
      child = parent;
      parent = child.getParent();
    }
    return { node: site.node, kind: "statement" };
  }

  private buildCandidates(): Candidate[] {
    // 1. Anchor every site.
    const groups = new Map<Node, { kind: RootKind; sites: Site[] }>();
    for (const site of this.sites) {
      const { node, kind } = this.rootOf(site);
      const g = groups.get(node) ?? { kind, sites: [] };
      g.sites.push(site);
      groups.set(node, g);
    }

    // 2. Merge sibling if-statements in the same block (early-return classifiers).
    const merged = new Map<Node, { kind: RootKind; sites: Site[]; nodes: Node[] }>();
    const consumed = new Set<Node>();
    for (const [node, g] of groups) {
      if (consumed.has(node)) continue;
      if (g.kind === "if-chain") {
        const run = siblingIfRun(node, groups);
        if (run.length > 1) {
          const sites = run.flatMap((n) => groups.get(n)!.sites);
          run.forEach((n) => consumed.add(n));
          merged.set(run[0]!, { kind: "if-group", sites, nodes: run });
          continue;
        }
      }
      consumed.add(node);
      merged.set(node, { ...g, nodes: [node] });
    }

    // 3. A function root whose sites all live inside decisions already reported is redundant.
    const out: Candidate[] = [];
    for (const [node, g] of merged) {
      const c = this.score(node, g.kind, g.nodes, g.sites);
      if (c.score > 0) out.push(c);
    }
    return out.sort((a, b) => a.line - b.line);
  }

  // ─── Scoring ──────────────────────────────────────────────────────────

  private score(anchor: Node, kind: RootKind, nodes: Node[], sites: Site[]): Candidate {
    const w = this.opts.signals;
    const fired: FiredSignal[] = [];
    const fire = (id: SignalId, evidence: string[]) => {
      if (w[id] !== 0 && evidence.length) fired.push({ id, weight: w[id], evidence: [...new Set(evidence)].slice(0, 6) });
    };
    const ev = (s: Site) => `${s.evidence}  (line ${lineOf(s.node)})`;

    // stringIncludes
    fire("stringIncludes", sites.filter((s) => s.kind === "includes" || (s.kind === "membership" && s.human)).map(ev));

    // regexOnText
    fire("regexOnText", sites.filter((s) => s.kind === "regex").map(ev));

    // keywordList: an explicit list referenced by the decision, or many distinct literals matched inline.
    const listEvidence: string[] = [];
    const allRegionWords = new Set<string>();
    // `words.some((w) => text.includes(w))` matches against a variable: the list it came from
    // usually lives elsewhere in the function (a map iterated in a loop), so widen the search.
    const region: Node[] = [...nodes];
    if (sites.some((s) => s.kind === "includes" && s.literals.length === 0)) {
      const fn = (nodes[0] ?? anchor).getFirstAncestor(
        (a) => Node.isFunctionDeclaration(a) || Node.isMethodDeclaration(a) || Node.isArrowFunction(a) || Node.isFunctionExpression(a)
      );
      if (fn && !nodes.includes(fn)) region.push(fn);
    }
    const seenIds = new Set<string>();
    for (const n of region) {
      for (const id of n.getDescendantsOfKind(SyntaxKind.Identifier)) {
        if (seenIds.has(id.getText())) continue;
        const init = resolveInitializer(id);
        if (!init || !(Node.isArrayLiteralExpression(init) || Node.isNewExpression(init) || Node.isObjectLiteralExpression(init) || Node.isAsExpression(init) || Node.isCallExpression(init))) continue;
        const words = collectWordsFromExpression(init);
        if (words.length >= this.opts.keywordListMin) {
          seenIds.add(id.getText());
          listEvidence.push(`${id.getText()} — ${words.length} terms (${short(words.slice(0, 4).map((x) => `"${x}"`).join(", "), 50)}…)`);
          words.forEach((x) => allRegionWords.add(x));
        }
      }
      for (const arr of [n, ...n.getDescendantsOfKind(SyntaxKind.ArrayLiteralExpression)]) {
        if (!Node.isArrayLiteralExpression(arr)) continue;
        const words = wordLeaves(arr);
        if (words.length >= this.opts.keywordListMin) listEvidence.push(`inline list of ${words.length} terms (line ${lineOf(arr)})`);
      }
    }
    for (const s of sites) if (s.kind === "membership" && s.literals.length >= this.opts.keywordListMin) listEvidence.push(ev(s));
    const inlineLiterals = new Set(
      sites.filter((s) => s.kind !== "membership").flatMap((s) => s.literals.map((l) => l.toLowerCase()))
    );
    if (inlineLiterals.size >= this.opts.inlineTermsMin) {
      listEvidence.push(`${inlineLiterals.size} distinct terms matched inline`);
    }
    fire("keywordList", listEvidence);

    // textBranches: 3+ branches, at least 2 of them keyed on text
    if (kind === "if-chain" || kind === "if-group") {
      const conditions: Node[] = [];
      let elseCount = 0;
      for (const n of nodes) {
        let cur: Node | undefined = n;
        while (cur && Node.isIfStatement(cur)) {
          conditions.push(cur.getExpression());
          const els = cur.getElseStatement();
          if (els && !Node.isIfStatement(els)) elseCount++;
          cur = els;
        }
      }
      const keyed = conditions.filter((c) => sites.some((s) => c === s.node || c.containsRange(s.node.getPos(), s.node.getEnd())));
      const branches = conditions.length + elseCount;
      if (branches >= 3 && keyed.length >= 2) {
        fire("textBranches", [`${branches} branches, ${keyed.length} keyed on text`]);
      }
    }

    // switchOnText
    const switchEvidence = sites.filter((s) => s.kind === "switch").map(ev);
    // a === "yes" || a === "sure" || a === "ok" is a switch written with ===.
    const equalsTerms = new Set(sites.filter((s) => s.kind === "equals").flatMap((s) => s.literals.map((l) => l.toLowerCase())));
    if (equalsTerms.size >= this.opts.inlineTermsMin) {
      switchEvidence.push(`${equalsTerms.size}-way equality on free text (${short([...equalsTerms].slice(0, 5).map((t) => `"${t}"`).join(", "), 50)})`);
    }
    fire("switchOnText", switchEvidence);

    // normalizeThenMatch
    fire("normalizeThenMatch", sites.filter((s) => s.normalized).map(ev));

    // fuzzyMatch
    fire("fuzzyMatch", sites.filter((s) => s.kind === "fuzzy").map(ev));

    // hardcodedLabels: 2+ distinct known labels in the decision, or one used as a match term
    const found = new Set<string>();
    const matchTerms = new Set(sites.flatMap((s) => s.literals.map((l) => l.toLowerCase())));
    for (const n of nodes) {
      for (const lit of [n, ...n.getDescendants()]) {
        const v = stringLiteralValue(lit);
        if (v !== undefined && this.labelSet.has(v.toLowerCase())) found.add(v.toLowerCase());
      }
    }
    for (const word of allRegionWords) if (this.labelSet.has(word.toLowerCase())) found.add(word.toLowerCase());
    const labelAsTerm = [...found].some((l) => matchTerms.has(l));
    if (found.size >= 2 || labelAsTerm) {
      fire("hardcodedLabels", [[...found].slice(0, 8).map((l) => `"${l}"`).join(", ")]);
    }

    // codeContext (penalty): lexers, tokenizers, highlighters — or a vocabulary of code keywords.
    const codeNames = new Set(this.opts.codeContextNames.map((n) => n.toLowerCase()));
    const ctxName = enclosingName(nodes[0] ?? anchor) ?? "";
    const fileBase = path.basename(this.sf.getFilePath()).replace(/\.[^.]+$/, "");
    const nameHit = [...nameTokens(ctxName), ...nameTokens(fileBase)].find((t) => codeNames.has(t));
    const vocab = [...new Set([...matchTerms, ...[...allRegionWords].map((x) => x.toLowerCase())])];
    const codeVocab = vocab.filter((v) => CODE_WORDS.has(v));
    const codeEvidence: string[] = [];
    if (nameHit) codeEvidence.push(`"${nameHit}" in ${ctxName ? `${ctxName}()` : fileBase}`);
    if (vocab.length >= 3 && codeVocab.length / vocab.length >= 0.5) {
      codeEvidence.push(`${codeVocab.length}/${vocab.length} matched terms are code keywords (${codeVocab.slice(0, 4).join(", ")})`);
    }
    fire("codeContext", codeEvidence);

    const raw = fired.reduce((sum, f) => sum + f.weight, 0);
    const score = Math.max(0, Math.min(100, raw));
    const first = nodes[0] ?? anchor;
    const last = nodes[nodes.length - 1] ?? anchor;
    const rel = path.relative(this.root, this.sf.getFilePath()).split(path.sep).join("/");
    const normalizedSource = nodes.map((n) => n.getText().replace(/\s+/g, " ")).join("\n");

    return {
      id: createHash("sha1").update(rel + "\0" + normalizedSource).digest("hex").slice(0, 12),
      file: rel,
      line: first.getStartLineNumber(),
      column: this.sf.getLineAndColumnAtPos(first.getStart()).column,
      endLine: last.getEndLineNumber(),
      kind,
      context: enclosingName(first),
      snippet: snippetOf(this.sf, first.getStartLineNumber(), last.getEndLineNumber()),
      source: sourceFor(this.sf, first, last, kind),
      signals: fired,
      fileHash: this.fileHash,
      terms: vocab.slice(0, 40),
      score,
      band: bandFor(score, this.opts.thresholds)
    };
  }
}

function topOfIfChain(node: Node): Node {
  let cur = node;
  let parent = cur.getParent();
  while (parent && Node.isIfStatement(parent) && parent.getElseStatement() === cur) {
    cur = parent;
    parent = cur.getParent();
  }
  return cur;
}

/** Contiguous if-statements in the same block that each carry text sites. */
function siblingIfRun(node: Node, groups: Map<Node, { kind: RootKind }>): Node[] {
  const parent = node.getParent();
  if (!parent || !(Node.isBlock(parent) || Node.isSourceFile(parent) || Node.isCaseClause(parent) || Node.isDefaultClause(parent))) {
    return [node];
  }
  const statements = parent.getStatements() as Node[];
  const idx = statements.indexOf(node);
  const isTextIf = (n: Node | undefined) => !!n && Node.isIfStatement(n) && groups.get(n)?.kind === "if-chain";
  let start = idx;
  while (isTextIf(statements[start - 1])) start--;
  let end = idx;
  while (isTextIf(statements[end + 1])) end++;
  return statements.slice(start, end + 1);
}

function enclosingName(node: Node): string | undefined {
  for (const anc of node.getAncestors()) {
    if (Node.isFunctionDeclaration(anc) || Node.isMethodDeclaration(anc)) return anc.getName();
    if ((Node.isArrowFunction(anc) || Node.isFunctionExpression(anc)) && Node.isVariableDeclaration(anc.getParent())) {
      return (anc.getParent() as unknown as { getName(): string }).getName();
    }
  }
  if (Node.isFunctionDeclaration(node) || Node.isMethodDeclaration(node)) return node.getName();
  if ((Node.isArrowFunction(node) || Node.isFunctionExpression(node)) && Node.isVariableDeclaration(node.getParent())) {
    return (node.getParent() as unknown as { getName(): string }).getName();
  }
  return undefined;
}

const FUNCTION_LIKE = (a: Node) =>
  Node.isFunctionDeclaration(a) || Node.isMethodDeclaration(a) || Node.isArrowFunction(a) || Node.isFunctionExpression(a);

/**
 * What TypeSafe sees: the decision itself, and the function around it so the model can tell
 * where the matched text comes from (a user's message vs. a caught error). The function is
 * windowed around the decision to keep state small: header + ~20 lines before + ~8 after.
 */
function sourceFor(sf: SourceFile, first: Node, last: Node, kind: RootKind): Candidate["source"] {
  const start = first.getStartLineNumber();
  const end = last.getEndLineNumber();
  const decision = snippetOf(sf, start, end, 40);
  if (kind === "function") return { decision };
  const fn = first.getFirstAncestor(FUNCTION_LIKE);
  if (!fn) return { decision };
  // Prefer the named outer function when the nearest one is an inline callback.
  let outer: Node = fn;
  for (let a = outer.getFirstAncestor(FUNCTION_LIKE); a && outer.getEndLineNumber() - outer.getStartLineNumber() < 6; a = a.getFirstAncestor(FUNCTION_LIKE)) {
    outer = a;
  }
  const fStart = outer.getStartLineNumber();
  const fEnd = outer.getEndLineNumber();
  const all = sf.getFullText().split(/\r?\n/);
  const line = (n: number) => {
    const l = all[n - 1] ?? "";
    return l.length > 160 ? l.slice(0, 159) + "…" : l;
  };
  const pick = (a: number, b: number) => Array.from({ length: Math.max(0, b - a + 1) }, (_, i) => line(a + i));
  if (fEnd - fStart + 1 <= 60) return { decision, enclosing: pick(fStart, fEnd).join("\n"), enclosingStartLine: fStart };
  const from = Math.max(fStart + 2, start - 20);
  const to = Math.min(fEnd - 1, end + 8);
  const parts = [...pick(fStart, fStart + 1)];
  if (from > fStart + 2) parts.push("  // …");
  parts.push(...pick(from, to));
  if (to < fEnd - 1) parts.push("  // …");
  parts.push(line(fEnd));
  return { decision, enclosing: parts.join("\n"), enclosingStartLine: fStart };
}

function snippetOf(sf: SourceFile, start: number, end: number, maxLines = 14): string {
  const lines = sf
    .getFullText()
    .split(/\r?\n/)
    .slice(start - 1, Math.min(end, start - 1 + maxLines))
    .map((l) => (l.length > 160 ? l.slice(0, 159) + "…" : l));
  if (end - start + 1 > maxLines) lines.push("  …");
  return lines.join("\n");
}

export function detectFile(sf: SourceFile, root: string, opts: DetectorOptions): Candidate[] {
  return new FileDetector(sf, root, opts).run();
}
