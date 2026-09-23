import React from "react";
import { Box, Text } from "ink";
import InkSpinner from "ink-spinner";
import figlet from "figlet";
import { SIGNAL_LABELS, type Band, type Candidate } from "@jevx/core";

const FALLBACK_LOGO = [
  "  JJJJJ  EEEEE  V   V  X   X",
  "    J    E       V V    X X ",
  "    J    EEEE     V      X  ",
  "J   J    E       V V    X X ",
  " JJJ     EEEEE  V   V  X   X"
];

/** figlet "ANSI Shadow" logo, with a plain-ASCII fallback if the font can't load. */
export const LOGO: string[] = (() => {
  try {
    return figlet
      .textSync("JEVX", { font: "ANSI Shadow" })
      .split("\n")
      .filter((l) => l.trim().length > 0);
  } catch {
    return FALLBACK_LOGO;
  }
})();

export const BAND_COLOR: Record<Band, string> = {
  veryStrong: "magentaBright",
  strong: "greenBright",
  possible: "yellow",
  ignore: "gray"
};

export const BAND_LABEL: Record<Band, string> = {
  veryStrong: "very strong",
  strong: "strong",
  possible: "possible",
  ignore: "ignore"
};

export function Banner({ title = "Welcome to JevX" }: { title?: string }) {
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box borderStyle="round" borderColor="cyan" paddingX={2} width={40} justifyContent="center">
        <Text bold>{title}</Text>
      </Box>
      <Box flexDirection="column" marginTop={1}>
        {LOGO.map((l, i) => (
          <Text key={i} color="cyan">
            {l}
          </Text>
        ))}
      </Box>
    </Box>
  );
}

export function Spinner({ label }: { label: string }) {
  return (
    <Text>
      <Text color="cyan">
        <InkSpinner type="dots" />
      </Text>{" "}
      {label}
    </Text>
  );
}

export function Check({ children }: { children: React.ReactNode }) {
  return (
    <Text>
      <Text color="green">✓</Text> {children}
    </Text>
  );
}

export function ScoreBar({ score, band }: { score: number; band: Band }) {
  const filled = Math.round(score / 10);
  return (
    <Text color={BAND_COLOR[band]}>
      {"█".repeat(filled)}
      <Text color="gray">{"░".repeat(10 - filled)}</Text>
    </Text>
  );
}

export function location(c: Candidate): string {
  return `${c.file}:${c.line}`;
}

export function CandidateDetail({ candidate }: { candidate: Candidate }) {
  const c = candidate;
  const lines = c.snippet.split("\n");
  const width = String(c.line + lines.length).length;
  return (
    <Box flexDirection="column">
      <Box>
        <Text bold>{location(c)}</Text>
        {c.context ? <Text color="gray">  in {c.context}()</Text> : null}
        <Text color="gray">  · {c.kind}</Text>
      </Box>
      <ScoreLine candidate={c} />
      <ValidationBlock candidate={c} />

      <Box flexDirection="column" marginTop={1}>
        <Text bold>Why this looks like a frozen judgement call</Text>
        {c.signals.map((s) => (
          <Box key={s.id} flexDirection="column" marginTop={0}>
            <Text>
              <Text color={s.weight < 0 ? "red" : "cyan"}>{`${s.weight > 0 ? "+" : ""}${s.weight}`.padStart(3)}</Text> {SIGNAL_LABELS[s.id]}
            </Text>
            {s.evidence.slice(0, 3).map((e, i) => (
              <Text key={i} color="gray">
                {"      "}
                {e}
              </Text>
            ))}
          </Box>
        ))}
      </Box>

      <Box flexDirection="column" marginTop={1} borderStyle="single" borderColor="gray" paddingX={1}>
        {lines.map((l, i) => (
          <Text key={i}>
            <Text color="gray">{String(c.line + i).padStart(width)} │ </Text>
            {l}
          </Text>
        ))}
      </Box>
    </Box>
  );
}

function ScoreLine({ candidate: c }: { candidate: Candidate }) {
  if (c.confidence !== undefined) {
    return (
      <Box marginTop={1}>
        <Text>Final confidence </Text>
        <Text bold color={BAND_COLOR[c.band]}>
          {c.confidence}
        </Text>
        <Text color="gray"> / 100 · {BAND_LABEL[c.band]} · AST score {c.score}</Text>
      </Box>
    );
  }
  return (
    <Box marginTop={1}>
      <Text>Preliminary score </Text>
      <Text bold color={BAND_COLOR[c.band]}>
        {c.score}
      </Text>
      <Text color="gray"> / 100 · {BAND_LABEL[c.band]} · not validated by TypeSafe</Text>
    </Box>
  );
}

const pct = (x: number | undefined) => (x === undefined ? "–" : `${Math.round(x * 100)}%`);

function ValidationBlock({ candidate: c }: { candidate: Candidate }) {
  const v = c.validation;
  if (!v) return null;
  if (v.status === "error") {
    return (
      <Box marginTop={1}>
        <Text color="red">TypeSafe validation failed: {v.error}</Text>
      </Box>
    );
  }
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text bold>
        TypeSafe says{" "}
        <Text color={v.status === "confirmed" ? "green" : "yellow"}>
          {v.status === "confirmed" ? "semantic decision ✓" : "not a semantic decision ✗"}
        </Text>
        <Text color="gray">
          {"  "}
          {v.model}
          {v.cached ? " · cached" : ""}
        </Text>
      </Text>
      <Text color="gray">
        {"  "}meaning-based decision {pct(v.semantic)} · human-written text {pct(v.humanText)} · kind {v.kind ?? "–"} (
        {pct(v.kindConfidence)})
      </Text>
      {v.reason ? <Text color="gray">  decided by: {v.reason}</Text> : null}
      {(v.advisories ?? []).map((a, i) => (
        <Text key={i} color="yellow">
          {"  "}note: {a}
        </Text>
      ))}
    </Box>
  );
}
