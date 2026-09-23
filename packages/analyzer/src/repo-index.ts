// Whole-repository index for adaptive context. Deterministic and offline: it only reads the
// ts-morph project JevX already loaded. Per candidate it builds a CATALOG of related context
// (callees, callers, types, constants, importers, the file, the folder, the repo overview)
// and hands out the text of an item only when asked. Secrets are scrubbed from every item;
// files that look like they hold credentials are never offered at all.
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { Node, SyntaxKind, type SourceFile } from "ts-morph";
import { scrubSecrets, type ContextAnchor, type ContextItem, type ContextKind, type ContextProvider, type ContextRef } from "@jevx/core";
import { isFunctionLike, type FunctionLike } from "./facts.js";
import { fileRole, readPackageInfo } from "./project.js";

export interface RepoIndexOptions {
  /** Files up to this size go to Gemini whole in the first round; larger ones as outline + unit. */
  maxWholeFileChars?: number;
  /** Cap on catalog entries per relation (keeps the catalog readable; items stay reachable by search). */
  maxPerRelation?: number;
}

const SENSITIVE_PATH = /(^|\/)(\.env[^/]*|[^/]*(secret|credential|private[-_]?key|password)[^/]*)$/i;
const IDENT = /[A-Za-z_$][\w$]{2,}/g;
const FILE_TOKEN = /[\w./@-]+\.(?:[cm]?[jt]sx?)\b/g;

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const numbered = (text: string, start: number) =>
  text
    .split("\n")
    .map((l, i) => `${String(start + i).padStart(5)} | ${l}`)
    .join("\n");

type Loc = { file: string; line: number; name: string };

function parseId(id: string): { kind: ContextKind; rest: string } | undefined {
  const i = id.indexOf(":");
  if (i < 0) return undefined;
  return { kind: id.slice(0, i) as ContextKind, rest: id.slice(i + 1) };
}

function parseLoc(rest: string): Loc | undefined {
  const m = rest.match(/^(.+)#(.+)@(\d+)$/);
  return m ? { file: m[1]!, name: m[2]!, line: Number(m[3]) } : undefined;
}

function nameOf(n: Node): string {
  if (Node.isFunctionDeclaration(n) || Node.isClassDeclaration(n)) return n.getName() ?? "default";
  if (Node.isMethodDeclaration(n) || Node.isGetAccessorDeclaration(n)) {
    const cls = n.getFirstAncestorByKind(SyntaxKind.ClassDeclaration);
    return cls?.getName() ? `${cls.getName()}.${n.getName()}` : n.getName();
  }
  const holder = n.getParent();
  if (holder && Node.isVariableDeclaration(holder)) return holder.getName();
  if (holder && Node.isPropertyAssignment(holder)) return holder.getName();
  if (Node.isInterfaceDeclaration(n) || Node.isTypeAliasDeclaration(n) || Node.isEnumDeclaration(n)) return n.getName();
  if (Node.isVariableDeclaration(n)) return n.getName();
  return `<anonymous>`;
}

export class RepoIndex implements ContextProvider {
  readonly root: string;
  private readonly files = new Map<string, SourceFile>();
  private readonly items = new Map<string, ContextItem>();
  private importersCache?: Map<string, string[]>;
  private symbolsCache?: ContextRef[];
  private readonly maxWhole: number;
  private readonly maxPer: number;

  constructor(root: string, files: SourceFile[], opts: RepoIndexOptions = {}) {
    this.root = path.resolve(root);
    for (const sf of files) {
      const rel = path.relative(this.root, sf.getFilePath()).split(path.sep).join("/");
      if (SENSITIVE_PATH.test(rel)) continue;
      this.files.set(rel, sf);
    }
    this.maxWhole = opts.maxWholeFileChars ?? 60_000;
    this.maxPer = opts.maxPerRelation ?? 25;
  }

  get fileCount() {
    return this.files.size;
  }

  private rel(sf: SourceFile): string | undefined {
    const rel = path.relative(this.root, sf.getFilePath()).split(path.sep).join("/");
    return this.files.has(rel) ? rel : undefined;
  }

  // ─── items ─────────────────────────────────────────────────────────────

  private make(id: string, kind: ContextKind, title: string, rawText: string, file?: string, lines?: [number, number]): ContextItem {
    const cached = this.items.get(id);
    if (cached) return cached;
    const text = scrubSecrets(rawText).text;
    const item: ContextItem = { id, kind, title, file, lines, text, chars: text.length, hash: sha(text) };
    this.items.set(id, item);
    return item;
  }

  private ref(item: ContextItem): ContextRef {
    const { text: _t, hash: _h, ...ref } = item;
    void _t;
    void _h;
    return ref;
  }

  private fileItem(rel: string): ContextItem | undefined {
    const sf = this.files.get(rel);
    if (!sf) return undefined;
    const text = sf.getFullText();
    return this.make(`file:${rel}`, "file", `whole file ${rel} (${text.split("\n").length} lines)`, numbered(text, 1), rel, [1, sf.getEndLineNumber()]);
  }

  /** Imports, exports and signatures of a file, line-numbered. */
  private outlineItem(rel: string, kind: ContextKind = "file_outline"): ContextItem | undefined {
    const sf = this.files.get(rel);
    if (!sf) return undefined;
    const lines: string[] = [];
    const sig = (n: Node) => {
      const t = n.getText();
      const brace = t.indexOf("{");
      const head = (brace > 0 && brace < 400 ? t.slice(0, brace) : t.split("\n")[0]!).replace(/\s+/g, " ").trim();
      return head.length > 200 ? head.slice(0, 199) + "…" : head;
    };
    for (const s of sf.getStatements()) {
      const line = s.getStartLineNumber();
      if (Node.isImportDeclaration(s)) lines.push(`${String(line).padStart(5)} | ${s.getText().replace(/\s+/g, " ").slice(0, 200)}`);
      else if (Node.isFunctionDeclaration(s) || Node.isClassDeclaration(s) || Node.isVariableStatement(s) || Node.isExportAssignment(s)) {
        lines.push(`${String(line).padStart(5)} | ${sig(s)}`);
        if (Node.isClassDeclaration(s))
          for (const m of s.getMethods()) lines.push(`${String(m.getStartLineNumber()).padStart(5)} |   ${sig(m)}`);
      } else if (Node.isInterfaceDeclaration(s) || Node.isTypeAliasDeclaration(s) || Node.isEnumDeclaration(s)) {
        const t = s.getText();
        lines.push(t.split("\n").length <= 15 ? numbered(t, line) : `${String(line).padStart(5)} | ${sig(s)} …`);
      }
    }
    const title = kind === "importer" ? `outline of ${rel} (imports the candidate's file)` : `outline of ${rel}`;
    return this.make(`${kind === "importer" ? "importer" : "outline"}:${rel}`, kind, title, lines.join("\n"), rel);
  }

  private findFunction(loc: Loc): FunctionLike | undefined {
    const sf = this.files.get(loc.file);
    if (!sf) return undefined;
    let found: FunctionLike | undefined;
    sf.forEachDescendant((n, t) => {
      if (found) return t.stop();
      if (isFunctionLike(n) && n.getStartLineNumber() === loc.line && (n as FunctionLike).getBody()) found = n as FunctionLike;
    });
    return found;
  }

  private functionItem(fn: FunctionLike, kind: ContextKind): ContextItem | undefined {
    const rel = this.rel(fn.getSourceFile());
    if (!rel) return undefined;
    // include the declaring statement for arrows (`const x = (…) => …`)
    const holder = fn.getParent() && Node.isVariableDeclaration(fn.getParent()!) ? fn.getFirstAncestorByKind(SyntaxKind.VariableStatement) ?? fn : fn;
    const start = holder.getStartLineNumber();
    const name = nameOf(fn);
    const id = `${kind}:${rel}#${name}@${fn.getStartLineNumber()}`;
    const label = kind === "callee" ? "called by the candidate" : kind === "caller" ? "calls the candidate" : "function";
    return this.make(id, kind, `${name} in ${rel} (${label})`, numbered(holder.getText(), start), rel, [start, holder.getEndLineNumber()]);
  }

  private declItem(decl: Node, kind: "type" | "constant"): ContextItem | undefined {
    const rel = this.rel(decl.getSourceFile());
    if (!rel) return undefined;
    const stmt = Node.isVariableDeclaration(decl) ? (decl.getFirstAncestorByKind(SyntaxKind.VariableStatement) ?? decl) : decl;
    const name = nameOf(decl);
    const id = `${kind}:${rel}#${name}@${stmt.getStartLineNumber()}`;
    return this.make(id, kind, `${kind} ${name} in ${rel}`, numbered(stmt.getText(), stmt.getStartLineNumber()), rel, [stmt.getStartLineNumber(), stmt.getEndLineNumber()]);
  }

  private moduleItem(dir: string): ContextItem {
    const files = [...this.files.keys()].filter((f) => path.posix.dirname(f) === dir).sort();
    const parts = files.map((f) => `── ${f}\n${this.outlineItem(f)?.text ?? ""}`);
    return this.make(`module:${dir}`, "module", `folder ${dir}/ (${files.length} files, outlines)`, parts.join("\n\n"), undefined);
  }

  private repoItem(): ContextItem {
    const pkg = readPackageInfo(this.root);
    const lines: string[] = [`package: ${pkg.name}`, `frameworks: ${pkg.frameworks.join(", ") || "none detected"}`];
    const pj = path.join(this.root, "package.json");
    if (existsSync(pj)) {
      try {
        const p = JSON.parse(readFileSync(pj, "utf8")) as { description?: string; dependencies?: Record<string, string> };
        if (p.description) lines.push(`description: ${p.description}`);
        if (p.dependencies) lines.push(`dependencies: ${Object.keys(p.dependencies).slice(0, 60).join(", ")}`);
      } catch {
        /* ignore */
      }
    }
    const readme = ["README.md", "readme.md", "Readme.md"].map((f) => path.join(this.root, f)).find((f) => existsSync(f));
    if (readme) lines.push("", "README (first 60 lines):", ...readFileSync(readme, "utf8").split("\n").slice(0, 60));
    const dirs = new Map<string, number>();
    for (const f of this.files.keys()) dirs.set(path.posix.dirname(f), (dirs.get(path.posix.dirname(f)) ?? 0) + 1);
    lines.push("", `source tree (${this.files.size} files):`, ...[...dirs].sort().slice(0, 150).map(([d, n]) => `  ${d}/  ${n} file(s)`));
    lines.push("", "files and their exports:");
    for (const [f, sf] of [...this.files].sort().slice(0, 400)) {
      const exp = [...sf.getExportedDeclarations().keys()].slice(0, 12);
      lines.push(`  ${f}${fileRole(f) !== "source" ? ` [${fileRole(f)}]` : ""}${exp.length ? `: ${exp.join(", ")}` : ""}`);
    }
    return this.make("repo:overview", "repo", "repository overview (package, README head, tree, exports)", lines.join("\n"));
  }

  // ─── relations ─────────────────────────────────────────────────────────

  private declarationsOf(n: Node): Node[] {
    const sym = n.getSymbol();
    if (!sym) return [];
    const target = sym.isAlias() ? (sym.getAliasedSymbol() ?? sym) : sym;
    return target.getDeclarations().filter((d) => this.rel(d.getSourceFile()));
  }

  private relations(fn: FunctionLike): { callees: ContextItem[]; types: ContextItem[]; constants: ContextItem[] } {
    const callees = new Map<string, ContextItem>();
    const types = new Map<string, ContextItem>();
    const constants = new Map<string, ContextItem>();
    const self = fn;
    const add = (m: Map<string, ContextItem>, it: ContextItem | undefined) => {
      if (it && m.size < this.maxPer) m.set(it.id, it);
    };
    const asFunction = (d: Node): FunctionLike | undefined => {
      if (isFunctionLike(d)) return d as FunctionLike;
      if (Node.isVariableDeclaration(d)) {
        const init = d.getInitializer();
        if (init && isFunctionLike(init)) return init as FunctionLike;
      }
      return undefined;
    };
    fn.forEachDescendant((n) => {
      try {
        if (Node.isCallExpression(n) || Node.isNewExpression(n)) {
          const callee = n.getExpression();
          const target = Node.isPropertyAccessExpression(callee) ? callee.getNameNode() : callee;
          for (const d of this.declarationsOf(target)) {
            const f = asFunction(d);
            if (f && f !== self) add(callees, this.functionItem(f, "callee"));
            else if (Node.isClassDeclaration(d)) add(types, this.declItem(d, "type"));
          }
        } else if (Node.isTypeReference(n)) {
          for (const d of this.declarationsOf(n.getTypeName()))
            if (Node.isInterfaceDeclaration(d) || Node.isTypeAliasDeclaration(d) || Node.isEnumDeclaration(d) || Node.isClassDeclaration(d)) add(types, this.declItem(d, "type"));
        } else if (Node.isIdentifier(n)) {
          const parent = n.getParent();
          if (parent && (Node.isPropertyAccessExpression(parent) && parent.getNameNode() === n)) return;
          for (const d of this.declarationsOf(n)) {
            if (Node.isEnumDeclaration(d) || Node.isEnumMember(d)) add(types, this.declItem(Node.isEnumMember(d) ? d.getParent() : d, "type"));
            else if (Node.isVariableDeclaration(d) && !asFunction(d)) {
              const stmt = d.getFirstAncestorByKind(SyntaxKind.VariableStatement);
              if (stmt && Node.isSourceFile(stmt.getParent())) add(constants, this.declItem(d, "constant"));
            }
          }
        }
      } catch {
        /* unresolved symbol: skip */
      }
    });
    // parameter types that are only inferred / imported
    if (Node.isFunctionDeclaration(fn) || Node.isMethodDeclaration(fn) || Node.isArrowFunction(fn) || Node.isFunctionExpression(fn)) {
      for (const p of fn.getParameters()) {
        try {
          for (const d of p.getType().getSymbol()?.getDeclarations() ?? [])
            if (this.rel(d.getSourceFile()) && (Node.isInterfaceDeclaration(d) || Node.isTypeAliasDeclaration(d) || Node.isClassDeclaration(d) || Node.isEnumDeclaration(d)))
              add(types, this.declItem(d, "type"));
        } catch {
          /* ignore */
        }
      }
    }
    return { callees: [...callees.values()], types: [...types.values()], constants: [...constants.values()] };
  }

  private callers(fn: FunctionLike): ContextItem[] {
    const nameNode = Node.isFunctionDeclaration(fn) || Node.isMethodDeclaration(fn) ? fn.getNameNode() : fn.getParent() && Node.isVariableDeclaration(fn.getParent()!) ? (fn.getParent() as import("ts-morph").VariableDeclaration).getNameNode() : undefined;
    if (!nameNode || !Node.isIdentifier(nameNode)) return [];
    const out = new Map<string, ContextItem>();
    try {
      for (const ref of nameNode.findReferencesAsNodes()) {
        if (out.size >= this.maxPer) break;
        if (!this.rel(ref.getSourceFile())) continue;
        const enclosing = ref.getFirstAncestor((a) => isFunctionLike(a)) as FunctionLike | undefined;
        if (enclosing && enclosing !== fn && enclosing.getBody()) {
          const it = this.functionItem(enclosing, "caller");
          if (it) out.set(it.id, it);
        }
      }
    } catch {
      /* language service failure: no callers */
    }
    return [...out.values()];
  }

  private importersOf(rel: string): string[] {
    if (!this.importersCache) {
      this.importersCache = new Map();
      for (const [f, sf] of this.files) {
        for (const imp of sf.getImportDeclarations()) {
          try {
            const target = imp.getModuleSpecifierSourceFile();
            const t = target && this.rel(target);
            if (t && t !== f) this.importersCache.set(t, [...(this.importersCache.get(t) ?? []), f]);
          } catch {
            /* ignore */
          }
        }
      }
    }
    return (this.importersCache.get(rel) ?? []).slice(0, this.maxPer);
  }

  // ─── ContextProvider ───────────────────────────────────────────────────

  initial(c: ContextAnchor): { items: ContextItem[]; catalog: ContextRef[] } {
    const items: ContextItem[] = [];
    const catalog: ContextRef[] = [];
    const file = this.fileItem(c.file);
    if (!file) return { items, catalog };
    const fn = this.findFunction({ file: c.file, line: c.unit.start, name: c.unit.name });
    if (file.chars <= this.maxWhole) items.push(file);
    else {
      const outline = this.outlineItem(c.file);
      if (outline) items.push(outline);
      const unit = fn && this.functionItem(fn, "unit");
      if (unit) items.push(unit);
      catalog.push(this.ref(file));
    }
    if (fn) {
      const r = this.relations(fn);
      for (const it of [...r.callees, ...r.types, ...r.constants, ...this.callers(fn)]) if (it.file !== c.file || file.chars > this.maxWhole) catalog.push(this.ref(it));
    }
    for (const imp of this.importersOf(c.file)) {
      const it = this.outlineItem(imp, "importer");
      if (it) catalog.push(this.ref(it));
    }
    catalog.push(this.ref(this.moduleItem(path.posix.dirname(c.file))));
    catalog.push(this.ref(this.repoItem()));
    const seen = new Set(items.map((i) => i.id));
    return { items, catalog: catalog.filter((r) => !seen.has(r.id) && (seen.add(r.id), true)) };
  }

  resolve(id: string): ContextItem | undefined {
    const hit = this.items.get(id);
    if (hit) return hit;
    const p = parseId(id);
    if (!p) return undefined;
    switch (p.kind) {
      case "file":
        return this.fileItem(p.rest);
      case "file_outline":
        return this.outlineItem(p.rest);
      case "importer":
        return this.outlineItem(p.rest, "importer");
      case "module":
        return this.moduleItem(p.rest);
      case "repo":
        return this.repoItem();
      case "unit":
      case "callee":
      case "caller": {
        const loc = parseLoc(p.rest);
        const fn = loc && this.findFunction(loc);
        return fn ? this.functionItem(fn, p.kind) : undefined;
      }
      default:
        // outline:<file> ids use the "outline" prefix
        if ((p.kind as string) === "outline") return this.outlineItem(p.rest);
        return undefined; // type / constant items are only reachable once offered
    }
  }

  neighbors(id: string): ContextRef[] {
    const p = parseId(id);
    if (!p || !["unit", "callee", "caller"].includes(p.kind)) return [];
    const loc = parseLoc(p.rest);
    const fn = loc && this.findFunction(loc);
    if (!fn) return [];
    const r = this.relations(fn);
    const extra = p.kind === "caller" ? this.callers(fn) : [];
    return [...r.callees, ...r.types, ...r.constants, ...extra].map((i) => this.ref(i));
  }

  private symbols(): ContextRef[] {
    if (this.symbolsCache) return this.symbolsCache;
    const out: ContextRef[] = [];
    for (const [, sf] of this.files) {
      for (const f of sf.getFunctions()) if (f.getBody()) out.push(this.ref(this.functionItem(f, "unit")!));
      for (const cls of sf.getClasses()) {
        const it = this.declItem(cls, "type");
        if (it) out.push(this.ref(it));
        for (const m of cls.getMethods()) if (m.getBody()) out.push(this.ref(this.functionItem(m, "unit")!));
      }
      for (const d of [...sf.getInterfaces(), ...sf.getTypeAliases(), ...sf.getEnums()]) {
        const it = this.declItem(d, "type");
        if (it) out.push(this.ref(it));
      }
      for (const vs of sf.getVariableStatements())
        for (const d of vs.getDeclarations()) {
          const init = d.getInitializer();
          const it = init && isFunctionLike(init) ? this.functionItem(init as FunctionLike, "unit") : this.declItem(d, "constant");
          if (it) out.push(this.ref(it));
        }
    }
    this.symbolsCache = out;
    return out;
  }

  search(request: string, limit = 3): ContextRef[] {
    const scored = new Map<string, { ref: ContextRef; score: number }>();
    const bump = (ref: ContextRef, score: number) => {
      const prev = scored.get(ref.id);
      if (!prev || prev.score < score) scored.set(ref.id, { ref, score });
    };
    for (const tok of request.match(FILE_TOKEN) ?? []) {
      const t = tok.replace(/^\.?\//, "");
      for (const f of this.files.keys()) if (f === t || f.endsWith("/" + t) || f.endsWith(t)) bump(this.ref(this.fileItem(f)!), f === t ? 10 : 8);
    }
    // Code-looking tokens (camelCase, snake_case, digits, `quoted`, called()) weigh more than plain words.
    const codeLike = new Set<string>();
    for (const m of request.matchAll(/`([^`]+)`|([A-Za-z_$][\w$]*)\s*\(/g)) for (const w of (m[1] ?? m[2] ?? "").match(IDENT) ?? []) codeLike.add(w);
    const idents = new Set((request.match(IDENT) ?? []).filter((w) => codeLike.has(w) || /[a-z][A-Z]|_|\d|^[A-Z]/.test(w) || w.length >= 5));
    for (const w of idents) if (/[a-z][A-Z]|_|\d/.test(w)) codeLike.add(w);
    if (idents.size) {
      for (const ref of this.symbols()) {
        const short = ref.title.split(" ")[ref.kind === "type" || ref.kind === "constant" ? 1 : 0] ?? "";
        const last = short.split(".").pop() ?? short;
        for (const w of idents) {
          const strong = codeLike.has(w);
          if (short === w || last === w) bump(ref, strong ? 7 : 5);
          else if (last.toLowerCase() === w.toLowerCase()) bump(ref, strong ? 4 : 2);
        }
      }
      for (const f of this.files.keys()) {
        const base = path.posix.basename(f).replace(/\.[^.]+$/, "");
        if (idents.has(base)) bump(this.ref(this.outlineItem(f)!), 3);
      }
    }
    return [...scored.values()]
      .sort((a, b) => b.score - a.score || a.ref.id.localeCompare(b.ref.id))
      .slice(0, limit)
      .map((s) => s.ref);
  }

  hashOf(id: string): string | undefined {
    return this.resolve(id)?.hash;
  }
}
