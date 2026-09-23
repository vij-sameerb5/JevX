// Negatives: protocol and enum logic that only looks like text matching.

type Status = "open" | "pending" | "closed";

export function statusColor(status: Status): string {
  switch (status) {
    case "open":
      return "green";
    case "pending":
      return "yellow";
    case "closed":
      return "gray";
  }
}

export function isApiRoute(url: string): boolean {
  return url.startsWith("/api/") || url.startsWith("/v1/");
}

export function isJson(contentType: string): boolean {
  return contentType.includes("application/json");
}

export function isImage(mime: string): boolean {
  return mime.startsWith("image/");
}

export function logLevel(level: string): number {
  switch (level) {
    case "debug":
      return 10;
    case "info":
      return 20;
    case "warn":
      return 30;
    case "error":
      return 40;
    default:
      return 20;
  }
}

export function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}
