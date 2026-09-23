import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { CodeAnalystProvider, ContextMode, DecisionCandidate, GeminiAnalysis, GeminiEvidence } from "@jevx/core";
import { GEMINI_PROMPT_VERSION } from "./prompt.js";

export interface GeminiCacheEntry {
  analysis: GeminiAnalysis;
  model: string;
  promptVersion: string;
  context: GeminiEvidence["context"];
  usable: boolean;
  /** Hash of every context item that was shown — any change in related code invalidates the entry. */
  itemHashes: { id: string; hash: string }[];
  inputTokens: number;
  outputTokens: number;
  at: string;
}

/**
 * Validated analyses keyed by code hash + candidate id + prompt version + model + context mode, at
 * <root>/.jevx/cache/<provider>.json (gemini.json, openrouter.json — local to the analyzed project,
 * keep .jevx/ out of git). Providers never share a file, and the key includes the provider and model.
 * Only validated answers are stored: errors and malformed responses never poison the cache.
 * An entry is only reused if every context item it was built from still has the same hash
 * (a changed callee, type or caller forces a fresh analysis). The API key is never stored.
 */
export class GeminiCache {
  private entries: Record<string, GeminiCacheEntry> = {};
  private dirty = false;
  readonly file: string;

  constructor(
    root: string,
    private readonly enabled = true,
    readonly provider: CodeAnalystProvider = "gemini"
  ) {
    this.file = path.join(root, ".jevx", "cache", `${provider}.json`);
    if (enabled && existsSync(this.file)) {
      try {
        this.entries = (JSON.parse(readFileSync(this.file, "utf8")) as { entries?: Record<string, GeminiCacheEntry> }).entries ?? {};
      } catch {
        this.entries = {};
      }
    }
  }

  /**
   * Gemini keys keep their original form (existing caches stay valid); other providers namespace
   * the model as "<provider>:<model>", so the same model id on two providers never collides.
   */
  static key(
    c: Pick<DecisionCandidate, "id" | "hashes">,
    model: string,
    mode: ContextMode = "adaptive",
    promptVersion = GEMINI_PROMPT_VERSION,
    provider: CodeAnalystProvider = "gemini"
  ): string {
    const m = provider === "gemini" ? model : `${provider}:${model}`;
    return createHash("sha256").update([c.hashes.code, c.id, promptVersion, m, mode].join("\0")).digest("hex");
  }

  get size() {
    return Object.keys(this.entries).length;
  }

  get(key: string) {
    return this.enabled ? this.entries[key] : undefined;
  }

  set(key: string, e: GeminiCacheEntry) {
    if (!this.enabled) return;
    this.entries[key] = e;
    this.dirty = true;
  }

  save() {
    if (!this.enabled || !this.dirty) return;
    mkdirSync(path.dirname(this.file), { recursive: true });
    writeFileSync(`${this.file}.tmp`, JSON.stringify({ version: 1, entries: this.entries }, null, 2));
    renameSync(`${this.file}.tmp`, this.file);
    this.dirty = false;
  }
}
