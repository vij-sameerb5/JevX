import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Candidate, Validation } from "@jevx/core";

export interface CacheEntry {
  validation: Omit<Validation, "cached">;
  inputTokens: number;
  at: string;
}

/**
 * Validation results keyed by file hash + candidate hash + prompt version + model.
 * An unchanged candidate in an unchanged file never costs a second API call.
 * Lives at <root>/.jevx/cache/typesafe.json. Errors are never cached.
 */
export class ValidationCache {
  private entries: Record<string, CacheEntry> = {};
  private dirty = false;
  readonly file: string;

  constructor(root: string, private readonly enabled = true) {
    this.file = path.join(root, ".jevx", "cache", "typesafe.json");
    if (enabled && existsSync(this.file)) {
      try {
        const parsed = JSON.parse(readFileSync(this.file, "utf8")) as { entries?: Record<string, CacheEntry> };
        this.entries = parsed.entries ?? {};
      } catch {
        this.entries = {}; // a corrupt cache is just a cold cache
      }
    }
  }

  static key(c: Candidate, promptVersion: string, model: string): string {
    return createHash("sha256").update([c.fileHash, c.id, promptVersion, model].join("\0")).digest("hex");
  }

  get size(): number {
    return Object.keys(this.entries).length;
  }

  get(key: string): CacheEntry | undefined {
    return this.enabled ? this.entries[key] : undefined;
  }

  set(key: string, entry: CacheEntry): void {
    if (!this.enabled) return;
    this.entries[key] = entry;
    this.dirty = true;
  }

  save(): void {
    if (!this.enabled || !this.dirty) return;
    mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify({ version: 1, entries: this.entries }, null, 2));
    renameSync(tmp, this.file);
    this.dirty = false;
  }
}
