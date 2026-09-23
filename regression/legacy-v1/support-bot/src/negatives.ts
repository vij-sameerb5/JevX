// NEGATIVES: string matching that is NOT semantic classification.
export function loaderFor(filename: string) {
  if (filename.endsWith(".ts")) return "ts";
  if (filename.endsWith(".json")) return "json";
  if (filename.endsWith(".css")) return "css";
  return "file";
}

export function handle(method: string) {
  switch (method) {
    case "GET":
      return 1;
    case "POST":
      return 2;
    case "DELETE":
      return 3;
  }
  return 0;
}

type Action = { type: "ADD_TODO" | "REMOVE_TODO" | "CLEAR" };
export function reducer(state: string[], action: Action) {
  switch (action.type) {
    case "ADD_TODO":
      return [...state, "x"];
    case "REMOVE_TODO":
      return state.slice(1);
    default:
      return state;
  }
}

export function isSecure(url: string) {
  return url.startsWith("https://");
}

export function hasFlag(args: string[]) {
  return args.includes("--verbose") || args.includes("-v");
}

const ALLOWED_ROLES = ["admin", "editor", "viewer"];
export function canEdit(role: string) {
  return ALLOWED_ROLES.includes(role) && role !== "viewer";
}

export function isEmail(value: string) {
  return /^[^@]+@[^@]+\.[a-z]{2,}$/i.test(value);
}
