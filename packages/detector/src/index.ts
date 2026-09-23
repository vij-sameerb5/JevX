import type { SourceFile } from "ts-morph";
import { mergeDetectorOptions, summarize, type Candidate, type DetectionResult, type DetectorOptions } from "@jevx/core";
import { detectFile } from "./detect.js";

export { detectFile } from "./detect.js";

export function detect(
  files: SourceFile[],
  root: string,
  partial: Partial<DetectorOptions> = {},
  onProgress?: (done: number, total: number) => void
): DetectionResult {
  const started = performance.now();
  const opts = mergeDetectorOptions(partial);
  const raw: Candidate[] = [];
  files.forEach((sf, i) => {
    try {
      raw.push(...detectFile(sf, root, opts));
    } catch {
      // A single unparseable file must never sink the whole scan.
    }
    onProgress?.(i + 1, files.length);
  });
  return summarizeFrom(raw, files.length, started);
}

/** Same as detect(), but yields to the event loop so a terminal UI can keep rendering. */
export async function detectAsync(
  files: SourceFile[],
  root: string,
  partial: Partial<DetectorOptions> = {},
  onProgress?: (done: number, total: number) => void
): Promise<DetectionResult> {
  const started = performance.now();
  const opts = mergeDetectorOptions(partial);
  const raw: Candidate[] = [];
  for (let i = 0; i < files.length; i++) {
    try {
      raw.push(...detectFile(files[i]!, root, opts));
    } catch {
      // skip unparseable file
    }
    if (i % 10 === 9 || i === files.length - 1) {
      onProgress?.(i + 1, files.length);
      await new Promise((r) => setImmediate(r));
    }
  }
  return summarizeFrom(raw, files.length, started);
}

function summarizeFrom(raw: Candidate[], filesAnalyzed: number, started: number): DetectionResult {
  return summarize(raw, filesAnalyzed, performance.now() - started);
}
