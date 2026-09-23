// "Did you mean …?" over a closed list of CLI command names — deterministic, not semantic.
import leven from "leven";

const COMMANDS = ["build", "serve", "lint", "deploy", "clean"];

export function suggestCommand(input: string): string | undefined {
  let best: string | undefined;
  let bestDistance = 3;
  for (const cmd of COMMANDS) {
    const d = leven(input, cmd);
    if (d < bestDistance) {
      bestDistance = d;
      best = cmd;
    }
  }
  return best;
}
