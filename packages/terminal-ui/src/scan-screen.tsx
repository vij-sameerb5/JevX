import React, { useEffect, useMemo, useState } from "react";
import { Box, Text, useApp, useInput } from "ink";
import type { Candidate, DetectionResult } from "@jevx/core";
import { BAND_COLOR, Banner, CandidateDetail, Check, ScoreBar, Spinner, location } from "./components.js";

export interface ScanProgress {
  phase: "finding" | "parsing" | "detecting" | "validating";
  done?: number;
  total?: number;
}

export interface ScanScreenProps {
  run: (onProgress: (p: ScanProgress) => void) => Promise<DetectionResult>;
  /** Printed under the results; given the result so it can describe validation. */
  notice?: (result: DetectionResult) => string;
  onExit?: (result: DetectionResult | undefined) => void;
}

const WINDOW = 12;

export function ScanScreen({ run, notice, onExit }: ScanScreenProps) {
  const { exit } = useApp();
  const [progress, setProgress] = useState<ScanProgress>({ phase: "finding" });
  const [result, setResult] = useState<DetectionResult>();
  const [error, setError] = useState<string>();
  const [cursor, setCursor] = useState(0);
  const [showPossible, setShowPossible] = useState(false);
  const [inspecting, setInspecting] = useState<Candidate>();

  useEffect(() => {
    run(setProgress).then(setResult, (e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  const shown = useMemo(() => {
    if (!result) return [];
    return result.candidates.filter((c) => showPossible || c.band !== "possible");
  }, [result, showPossible]);
  const possibleCount = result?.counts.possible ?? 0;
  const strongCount = (result?.counts.strong ?? 0) + (result?.counts.veryStrong ?? 0);
  const validated = Boolean(result?.validation && !result.validation.skipped && result.validation.confirmed + result.validation.rejected > 0);

  const quit = () => {
    onExit?.(result);
    exit();
  };

  useInput((input, key) => {
    if (error) return quit();
    if (!result) {
      if (input === "q" || (key.ctrl && input === "c")) quit();
      return;
    }
    if (inspecting) {
      if (key.escape || key.backspace || key.leftArrow || input === "b") setInspecting(undefined);
      if (input === "q") quit();
      return;
    }
    if (key.upArrow || input === "k") setCursor((c) => Math.max(0, c - 1));
    if (key.downArrow || input === "j") setCursor((c) => Math.min(Math.max(0, shown.length - 1), c + 1));
    if (key.return && shown[cursor]) setInspecting(shown[cursor]);
    if (input === "p") {
      setShowPossible((s) => !s);
      setCursor(0);
    }
    if (input === "q" || key.escape) quit();
  });

  if (error) {
    return (
      <Box flexDirection="column">
        <Text color="red">✗ Scan failed: {error}</Text>
      </Box>
    );
  }

  if (inspecting) {
    return (
      <Box flexDirection="column">
        <CandidateDetail candidate={inspecting} />
        <Box marginTop={1}>
          <Text color="gray">Esc / ← Back   Q Quit</Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Banner title="Welcome to JevX Scan" />

      {!result ? (
        <Spinner
          label={
            progress.phase === "finding"
              ? "Scanning your codebase..."
              : progress.phase === "parsing"
                ? `Parsing ${progress.total ?? 0} files...`
                : progress.phase === "validating"
                  ? `Validating with TypeSafe... ${progress.done ?? 0}/${progress.total ?? 0}`
                  : `Detecting semantic decisions... ${progress.done ?? 0}/${progress.total ?? 0}`
          }
        />
      ) : (
        <Box flexDirection="column">
          <Check>{result.filesAnalyzed.toLocaleString()} files analyzed</Check>
          <Check>{result.candidates.length.toLocaleString()} semantic decision{result.candidates.length === 1 ? "" : "s"} detected</Check>

          <Box marginTop={1}>
            <Text bold color="yellowBright">
              ⚡ {strongCount} strong Jev candidate{strongCount === 1 ? "" : "s"}
            </Text>
            <Text color="gray">
              {validated ? "  (final confidence — validated by TypeSafe)" : "  (preliminary AST scores — not validated)"}
            </Text>
          </Box>

          <CandidateList items={shown} cursor={cursor} />

          {possibleCount > 0 && !showPossible ? (
            <Text color="gray">  + {possibleCount} possible (50–74) hidden — press P to show</Text>
          ) : null}
          {shown.length === 0 && possibleCount === 0 ? (
            <Text color="gray">  Nothing above the threshold. Your branches look like real logic.</Text>
          ) : null}
          {notice ? (
            <Box marginTop={1}>
              <Text color="gray">{notice(result)}</Text>
            </Box>
          ) : null}

          <Box marginTop={1}>
            <Text color="gray">↑/↓ Select   Enter Inspect   P {showPossible ? "Hide" : "Show"} possible   Q Quit</Text>
          </Box>
        </Box>
      )}
    </Box>
  );
}

function CandidateList({ items, cursor }: { items: Candidate[]; cursor: number }) {
  if (items.length === 0) return null;
  const start = Math.max(0, Math.min(cursor - Math.floor(WINDOW / 2), items.length - WINDOW));
  const visible = items.slice(start, start + WINDOW);
  const locWidth = Math.min(48, Math.max(...items.map((c) => location(c).length)) + 2);
  return (
    <Box flexDirection="column" marginTop={1}>
      {start > 0 ? <Text color="gray">    ↑ {start} more</Text> : null}
      {visible.map((c, i) => {
        const idx = start + i;
        const selected = idx === cursor;
        const loc = location(c);
        return (
          <Box key={c.id + idx}>
            <Text color={selected ? "cyan" : undefined}>{selected ? "❯ " : "  "}</Text>
            <Text bold={selected || c.band === "veryStrong"} color={selected ? "cyan" : undefined}>
              {(loc.length > locWidth ? "…" + loc.slice(-(locWidth - 1)) : loc).padEnd(locWidth)}
            </Text>
            <Text color={BAND_COLOR[c.band]} bold={c.band === "veryStrong"}>
              {String(c.confidence ?? c.score).padStart(3)}%
            </Text>
            <Text> </Text>
            <ScoreBar score={c.confidence ?? c.score} band={c.band} />
            {c.context ? <Text color="gray">  {c.context}()</Text> : null}
            {c.validation?.status === "confirmed" ? <Text color="gray">  AST {c.score}</Text> : null}
            {c.validation?.status === "error" ? <Text color="red">  ! not validated</Text> : null}
          </Box>
        );
      })}
      {start + WINDOW < items.length ? <Text color="gray">    ↓ {items.length - start - WINDOW} more</Text> : null}
    </Box>
  );
}
