import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

/** What a file is for. Only `source` files are analyzed for decisions. */
export type FileRole = "source" | "test" | "story" | "config" | "script" | "generated" | "types";

export function fileRole(rel: string): FileRole {
  const p = rel.split(path.sep).join("/");
  const base = p.split("/").pop() ?? p;
  if (/\.d\.[cm]?ts$/.test(base)) return "types";
  if (/\.(test|spec)\.[cm]?[jt]sx?$/.test(base) || /(^|\/)(__tests__|__mocks__|test|tests|e2e|cypress)\//.test(p)) return "test";
  if (/\.stories\.[cm]?[jt]sx?$/.test(base)) return "story";
  if (/(^|\/)(generated|__generated__|\.next|\.nuxt|\.svelte-kit|out|coverage)\//.test(p) || /\.gen(erated)?\.[cm]?[jt]sx?$/.test(base))
    return "generated";
  if (/\.config\.[cm]?[jt]s$/.test(base) || /^\.?[\w-]+rc\.[cm]?[jt]s$/.test(base)) return "config";
  if (/(^|\/)(scripts|bin)\//.test(p)) return "script";
  return "source";
}

/**
 * Frameworks come from declared dependencies (package.json), never from guessing at code.
 * The list only names the framework in reports and dataset metadata; it drives no detection.
 */
const FRAMEWORKS: Record<string, string> = {
  next: "next",
  react: "react",
  "react-native": "react-native",
  vue: "vue",
  nuxt: "nuxt",
  svelte: "svelte",
  "@sveltejs/kit": "sveltekit",
  "@angular/core": "angular",
  express: "express",
  fastify: "fastify",
  koa: "koa",
  hono: "hono",
  "@nestjs/core": "nestjs",
  electron: "electron",
  expo: "expo",
  "discord.js": "discord.js",
  telegraf: "telegraf",
  langchain: "langchain",
  ai: "vercel-ai",
  openai: "openai",
  "@anthropic-ai/sdk": "anthropic",
  "@typesafe-ai/sdk": "typesafe"
};

export interface PackageInfo {
  name: string;
  frameworks: string[];
}

export function readPackageInfo(root: string): PackageInfo {
  const file = path.join(root, "package.json");
  const fallback = { name: path.basename(root), frameworks: [] };
  if (!existsSync(file)) return fallback;
  try {
    const pkg = JSON.parse(readFileSync(file, "utf8")) as {
      name?: string;
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
    };
    const deps = { ...pkg.peerDependencies, ...pkg.devDependencies, ...pkg.dependencies };
    const frameworks = [...new Set(Object.keys(deps).flatMap((d) => (FRAMEWORKS[d] ? [FRAMEWORKS[d]] : [])))].sort();
    return { name: pkg.name || fallback.name, frameworks };
  } catch {
    return fallback;
  }
}

export function languageOf(file: string): "typescript" | "javascript" {
  return /\.[cm]?tsx?$/.test(file) ? "typescript" : "javascript";
}
