const REDACTED = "[redacted]";

export function sanitizeOperationalError(error: unknown, fallback = "Operation failed.") {
  const raw = error instanceof Error ? error.message : typeof error === "string" ? error : fallback;
  return raw
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/https?:\/\/[^\s"'<>]+/gi, "[URL redacted]")
    .replace(/\b(?:bearer)\s+[A-Za-z0-9._~+/=-]+/gi, `Bearer ${REDACTED}`)
    .replace(/\b(authorization|api[_ -]?key|access[_ -]?token|refresh[_ -]?token|password|secret)\b\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^,\s;]+)/gi, `$1=${REDACTED}`)
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[email redacted]")
    .replace(/\+?\d[\d ().-]{8,}\d/g, value => {
      const digits = value.replace(/\D/g, "").length;
      return digits >= 10 && digits <= 15 ? "[phone redacted]" : value;
    })
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300) || fallback;
}
