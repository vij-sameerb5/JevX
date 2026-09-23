// pnpm eval             — AST detector precision/recall over regression/legacy-v1/
// pnpm eval --validate  — + TypeSafe (API; every labelled case, negatives included; cached)
// pnpm eval --replay    — same report from the cache only (no API calls) + a policy sweep
import { createClient, DEFAULT_POLICY, type Policy, type SystemOneClient } from "@jevx/typesafe";
import { evaluate, formatReport } from "../tests/harness.js";

const argv = process.argv.slice(2);
const replay = argv.includes("--replay");
const validate = replay || argv.includes("--validate");

if (!validate) {
  console.log(formatReport(await evaluate()));
  process.exit(0);
}

let client: SystemOneClient;
if (replay) {
  client = {
    defaultModel: process.env.TYPESAFE_DEFAULT_MODEL?.trim() || "jev-latest",
    systemOne: () => {
      throw new Error("offline replay never calls the API");
    }
  };
  console.log("Replaying cached TypeSafe answers (.jevx/cache/typesafe.json) — no API calls\n");
} else {
  const made = createClient();
  if (!made.client) {
    console.error(`✗ --validate needs TypeSafe: ${made.error}`);
    process.exit(1);
  }
  client = made.client;
  console.log(`Validating with TypeSafe (${made.client.defaultModel}) — every labelled case, cached in .jevx/cache/typesafe.json\n`);
}

const report = await evaluate({}, { validate: { client, offline: replay } });
console.log(formatReport(report));

if (replay) {
  console.log("\nPolicy sweep (pipeline = production, TypeSafe = validator alone on all labelled cases)");
  console.log("semanticMin  kindAssist   pipeline P / R     TypeSafe P / R");
  const pct = (x: number) => `${Math.round(x * 100)}%`.padStart(4);
  for (const semanticMin of [0.4, 0.45, 0.5, 0.55, 0.6]) {
    for (const kindAssist of [true, false]) {
      const policy: Policy = { ...DEFAULT_POLICY, semanticMin, kindAssistMin: kindAssist ? DEFAULT_POLICY.kindAssistMin : 2 };
      const r = await evaluate({}, { validate: { client, offline: true, policy } });
      const cur = semanticMin === DEFAULT_POLICY.semanticMin && kindAssist ? "  ← current" : "";
      console.log(
        `${semanticMin.toFixed(2).padStart(11)}  ${(kindAssist ? "on" : "off").padStart(10)}   ${pct(r.pipeline!.precision)} / ${pct(r.pipeline!.recall)}     ${pct(r.typesafe!.precision)} / ${pct(r.typesafe!.recall)}${cur}`
      );
    }
  }
}
