import { createHmac } from "node:crypto";

export function pseudonymizeUid(uid: string, secret: string): string {
  return createHmac("sha256", secret).update(uid).digest("hex").slice(0, 20);
}

export function sanitizedError(error: unknown): { code: string; message: string } {
  if (!(error instanceof Error)) {
    return { code: "UNKNOWN", message: "Operation failed" };
  }
  const candidate = error as Error & { code?: unknown };
  const code = typeof candidate.code === "string" ? candidate.code.slice(0, 80) : error.name;
  return { code, message: "Operation failed" };
}
