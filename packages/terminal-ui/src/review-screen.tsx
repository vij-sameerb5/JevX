import React, { useState } from "react";
import { Box, Text, useApp, useInput } from "ink";
import SelectInput from "ink-select-input";
import { DECISION_CATEGORIES, HARD_NEGATIVE_REASONS, type Label } from "@jevx/core";
import type { DatasetEntry, LabelInput } from "@jevx/dataset";

export interface ReviewScreenProps {
  project: string;
  visibility: string;
  entries: DatasetEntry[];
  /** Source lines for an entry (from the dataset for public projects, or from --root on disk). */
  codeFor: (e: DatasetEntry) => string | undefined;
  /** Persist a label; returns the updated entry, or throws. */
  onLabel: (e: DatasetEntry, input: Omit<LabelInput, "labeller">) => DatasetEntry;
}

type Mode = { kind: "browse" } | { kind: "reason"; label: Label; text: string } | { kind: "detail"; label: Label; reasoning: string } | { kind: "confidence"; label: Label; reasoning: string; extra: string | undefined };

const LABEL_COLOR: Record<Label, string> = { STRONG_JEV: "green", POSSIBLE_JEV: "yellow", NOT_JEV: "gray" };
const MAX_CODE_LINES = 18;

export function ReviewScreen({ project, visibility, entries: initial, codeFor, onLabel }: ReviewScreenProps) {
  const { exit } = useApp();
  const [entries, setEntries] = useState(initial);
  const [i, setI] = useState(0);
  const [mode, setMode] = useState<Mode>({ kind: "browse" });
  const [note, setNote] = useState<string | undefined>();
  const e = entries[i];
  const labelled = entries.filter((x) => x.human && !x.needsRecheck).length;

  const nextUnlabelled = (from: number, list = entries) => {
    for (let k = 1; k <= list.length; k++) {
      const j = (from + k) % list.length;
      if (!list[j]!.human || list[j]!.needsRecheck) return j;
    }
    return Math.min(from + 1, list.length - 1);
  };

  const save = (label: Label, reasoning: string, extra: string | undefined, confidence: "high" | "medium" | "low") => {
    if (!e) return;
    try {
      const updated = onLabel(e, {
        label,
        reasoning,
        confidence,
        ...(label === "NOT_JEV" ? { hardNegativeReason: extra as never } : { category: extra as never })
      });
      const list = entries.map((x, k) => (k === i ? updated : x));
      setEntries(list);
      setNote(`saved ${label} for ${e.unit.name}`);
      setI(nextUnlabelled(i, list));
    } catch (err) {
      setNote(`✗ ${err instanceof Error ? err.message : String(err)}`);
    }
    setMode({ kind: "browse" });
  };

  useInput((input, key) => {
    if (mode.kind === "browse") {
      if (input === "q" || key.escape) return exit();
      if (key.rightArrow || input === "j") setI((x) => Math.min(x + 1, entries.length - 1));
      if (key.leftArrow || input === "k") setI((x) => Math.max(x - 1, 0));
      if (input === "u") setI(nextUnlabelled(i));
      const l = input === "s" ? "STRONG_JEV" : input === "p" ? "POSSIBLE_JEV" : input === "n" ? "NOT_JEV" : undefined;
      if (l && e) {
        setNote(undefined);
        setMode({ kind: "reason", label: l, text: "" });
      }
      return;
    }
    if (mode.kind === "reason") {
      if (key.escape) return setMode({ kind: "browse" });
      if (key.return) {
        if (!mode.text.trim()) return setNote("reasoning is required — why is this (not) a Jev decision?");
        return setMode({ kind: "detail", label: mode.label, reasoning: mode.text.trim() });
      }
      if (key.backspace || key.delete) return setMode({ ...mode, text: mode.text.slice(0, -1) });
      if (input && !key.ctrl && !key.meta) setMode({ ...mode, text: mode.text + input });
    }
    if ((mode.kind === "detail" || mode.kind === "confidence") && key.escape) setMode({ kind: "browse" });
  });

  if (!e) {
    return <Text color="gray">No entries to review in {project}.</Text>;
  }

  const code = codeFor(e);
  const codeLines = code?.split("\n") ?? [];
  const offset = Math.max(0, e.boundary.start - e.unit.start - 2);
  const shown = codeLines.slice(offset, offset + MAX_CODE_LINES);

  return (
    <Box flexDirection="column">
      <Text>
        <Text bold>JevX review · {project}</Text>
        <Text color="gray">
          {" "}
          ({visibility}) · {i + 1}/{entries.length} · {labelled} labelled
        </Text>
      </Text>
      <Box marginTop={1} flexDirection="column">
        <Text>
          <Text bold>
            {e.file}:{e.boundary.start}
          </Text>{" "}
          {e.unit.name} <Text color="gray">{e.id.slice(0, 8)}</Text>
          {e.origin === "missed" ? <Text color="magenta"> · human-added</Text> : null}
          {e.status === "stale" ? <Text color="red"> · stale</Text> : null}
        </Text>
        <Text>{e.decision}</Text>
        <Text color="gray">
          outcomes {e.outputs.kind}: {e.outputs.values.slice(0, 6).join(" | ") || "–"} · suggested {e.suggestedPrimitive}
        </Text>
        <Text color="gray">
          <Text bold>AST</Text> found by {e.generators.map((g) => g.generator).join(", ") || "–"}
          {e.auto.source === "triage" ? ` · filtered NOT_JEV (${e.auto.hardNegativeReason ?? ""})` : ""}
        </Text>
        {!e.gemini && !e.openrouter ? (
          <Text color="gray">
            <Text bold>Code analyst</Text> no analysis (run analyze --gemini or --openrouter)
          </Text>
        ) : null}
        {e.gemini ? <AnalystBlock name="Gemini" g={e.gemini} /> : null}
        {e.openrouter ? <AnalystBlock name="OpenRouter" g={e.openrouter} /> : null}
        {e.auto.answers ? (
          <Text color="magenta">
            <Text bold>Jev</Text> judgment {e.auto.answers.judgment.toFixed(2)} · bounded {e.auto.answers.bounded.toFixed(2)} · exact-is-right{" "}
            {e.auto.answers.deterministicIsCorrect.toFixed(2)} · {e.auto.answers.primitive} · {e.auto.answers.category}
          </Text>
        ) : (
          <Text color="gray">
            <Text bold>Jev</Text> not validated
          </Text>
        )}
        <Text color="gray">
          <Text bold>JevX</Text> {e.auto.label ?? "unclassified"}
          {e.auto.source !== "none" ? ` (${e.auto.source === "typesafe" ? `policy ${e.auto.policyVersion ?? ""}` : "deterministic filter"}: ${e.auto.reason ?? ""})` : ""}
        </Text>
        {e.human ? (
          <Text color={LABEL_COLOR[e.human.label]}>
            human: {e.human.label} ({e.human.confidence}) — {e.human.reasoning}
            {e.needsRecheck ? <Text color="red"> · code changed, recheck</Text> : null}
          </Text>
        ) : null}
      </Box>
      <Box marginTop={1} flexDirection="column" borderStyle="single" borderColor="gray" paddingX={1}>
        {shown.length ? (
          shown.map((l, k) => {
            const line = e.unit.start + offset + k;
            const inBoundary = line >= e.boundary.start && line <= e.boundary.end;
            return (
              <Text key={k} color={inBoundary ? undefined : "gray"}>
                {String(line).padStart(5)} │ {l}
              </Text>
            );
          })
        ) : (
          <Text color="gray">{visibility === "private" ? "code not stored (private) — pass --root <project path> to see it" : "no code available"}</Text>
        )}
      </Box>

      <Box marginTop={1} flexDirection="column">
        {mode.kind === "browse" ? (
          <Text color="gray">s STRONG_JEV · p POSSIBLE_JEV · n NOT_JEV · ←/→ move · u next unlabelled · q quit</Text>
        ) : null}
        {mode.kind === "reason" ? (
          <Text>
            <Text color={LABEL_COLOR[mode.label]}>{mode.label}</Text> — why? <Text>{mode.text}</Text>
            <Text color="cyan">▌</Text>
            <Text color="gray"> (Enter to continue, Esc to cancel)</Text>
          </Text>
        ) : null}
        {mode.kind === "detail" ? (
          <Box flexDirection="column">
            <Text>{mode.label === "NOT_JEV" ? "Why is exact code right? (hard-negative reason)" : "What kind of decision is it? (category)"}</Text>
            <SelectInput
              limit={8}
              items={[
                { key: "skip", label: "skip", value: "" },
                ...Object.keys(mode.label === "NOT_JEV" ? HARD_NEGATIVE_REASONS : DECISION_CATEGORIES).map((k) => ({ key: k, label: k, value: k }))
              ]}
              onSelect={(item) => setMode({ kind: "confidence", label: mode.label, reasoning: mode.reasoning, extra: item.value || undefined })}
            />
          </Box>
        ) : null}
        {mode.kind === "confidence" ? (
          <Box flexDirection="column">
            <Text>How sure are you?</Text>
            <SelectInput
              items={[
                { key: "high", label: "high", value: "high" },
                { key: "medium", label: "medium", value: "medium" },
                { key: "low", label: "low", value: "low" }
              ]}
              initialIndex={1}
              onSelect={(item) => save(mode.label, mode.reasoning, mode.extra, item.value as "high" | "medium" | "low")}
            />
          </Box>
        ) : null}
        {note ? <Text color={note.startsWith("✗") ? "red" : "green"}>{note}</Text> : null}
      </Box>
    </Box>
  );
}

/** Code analyst (Gemini / OpenRouter) = model-generated evidence. Shown apart from the label, never used as one. */
function AnalystBlock({ name, g }: { name: string; g: NonNullable<DatasetEntry["gemini"]> }) {
  const f = g.facts;
  const flags = `exact rule ${f.deterministic_logic ? "yes" : "no"} · judgment ${f.approximates_judgment ? "yes" : "no"} · ${f.decision_type} · ${f.plausible_primitive} · uncertainty ${f.uncertainty}`;
  const ctx =
    f.context_rounds !== undefined
      ? `context: ${f.context_rounds} round(s), ${f.context_items} item(s), understood ${f.understanding_confidence} — ${f.usable === false ? "INSUFFICIENT, weak evidence" : "sufficient"}`
      : undefined;
  return (
    <Box flexDirection="column">
      <Text color="blue">
        <Text bold>{name}</Text> <Text color="gray">({g.model} · evidence, not a label)</Text> {g.analysis ? g.analysis.summary : "private project: facts only"}
      </Text>
      {g.analysis ? <Text color="gray">       {g.analysis.decision_boundary} · {flags}</Text> : <Text color="gray">       {flags}</Text>}
      {ctx ? <Text color={f.usable === false ? "yellow" : "gray"}>       {ctx}</Text> : null}
      {g.analysis?.reasoning ? <Text color="gray">       why: {g.analysis.reasoning}</Text> : null}
    </Box>
  );
}
