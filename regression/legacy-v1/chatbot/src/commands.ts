// Negatives: slash-commands are a protocol, not natural language.
export function parseCommand(input: string): { cmd: string; args: string[] } | undefined {
  if (!input.startsWith("/")) return undefined;
  const [cmd = "", ...args] = input.slice(1).split(" ");
  return { cmd, args };
}

export function runCommand(cmd: string) {
  switch (cmd) {
    case "/help":
      return "help";
    case "/reset":
      return "reset";
    case "/quit":
      return "quit";
  }
  return "unknown";
}

export function isMention(text: string): boolean {
  return text.startsWith("@");
}
