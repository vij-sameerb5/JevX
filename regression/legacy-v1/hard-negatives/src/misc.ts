// Deterministic string logic over closed vocabularies.

export function parseFlag(value: string | undefined): boolean {
  return value === "true" || value === "1" || value === "yes";
}

export function monthIndex(name: string): number {
  const months = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
  return months.indexOf(name.toLowerCase());
}

export function onKey(event: { key: string }) {
  if (event.key === "Enter") return "submit";
  if (event.key === "Escape") return "cancel";
  if (event.key === "Tab") return "next";
  return "none";
}

export function browserName(userAgent: string): string {
  if (userAgent.includes("Firefox")) return "firefox";
  if (userAgent.includes("Edg")) return "edge";
  if (userAgent.includes("Chrome")) return "chrome";
  if (userAgent.includes("Safari")) return "safari";
  return "other";
}

export function toKm(value: number, unit: string): number {
  switch (unit) {
    case "km":
      return value;
    case "miles":
      return value * 1.609;
    case "meters":
      return value / 1000;
  }
  return NaN;
}

export function t(key: string, lang: string): string {
  const dict: Record<string, Record<string, string>> = {
    en: { hello: "Hello", bye: "Goodbye" },
    de: { hello: "Hallo", bye: "Tschüss" }
  };
  return dict[lang]?.[key] ?? key;
}

export function isEnabled(flags: string[], name: string): boolean {
  return flags.includes(name);
}

export function buttonClass(variant: string): string {
  return variant === "primary" ? "btn btn-primary" : "btn";
}
