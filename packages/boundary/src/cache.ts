// Local cache of validated boundary analyses at <root>/.jevx/cache/boundary.json (in the analyzed
// project, never in the dataset). Keys include the prompt version and provider:model, so a
// different model or prompt never reuses an answer. An entry is reused only while every context
// item it saw is unchanged. Errors and malformed answers are never cached. No keys are stored.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { CallAccounting } from "./schema.js";

export interface BoundaryCacheEntry<T = unknown> {
  value: T;
  context: { rounds: number; chars: number; stoppedBy: string; items: string[] };
  itemHashes: { id: string; hash: string }[];
  usable: boolean;
  accounting: CallAccounting;
  at: string;
}

export const cacheKey = (...parts: (string | number | undefined)[]) => createHash("sha256").update(parts.map((p) => String(p ?? "")).join("\0")).digest("hex");

export class BoundaryCache {
  private entries: Record<string, BoundaryCacheEntry> = {};
  private dirty = false;
  readonly file: string;

  constructor(root: string, private readonly enabled = true) {
    this.file = path.join(root, ".jevx", "cache", "boundary.json");
    if (enabled && existsSync(this.file)) {
      try {
        this.entries = (JSON.parse(readFileSync(this.file, "utf8")) as { entries?: Record<string, BoundaryCacheEntry> }).entries ?? {};
      } catch {
        this.entries = {};
      }
    }
  }

  get size() {
    return Object.keys(this.entries).length;
  }

  get<T>(key: string, hashOf?: (id: string) => string | undefined): BoundaryCacheEntry<T> | undefined {
    if (!this.enabled) return undefined;
    const e = this.entries[key] as BoundaryCacheEntry<T> | undefined;
    if (!e) return undefined;
    if (hashOf && !e.itemHashes.every((h) => !h.hash || hashOf(h.id) === h.hash)) return undefined;
    return e;
  }

  set<T>(key: string, e: BoundaryCacheEntry<T>) {
    if (!this.enabled) return;
    this.entries[key] = e as BoundaryCacheEntry;
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
