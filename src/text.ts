export function textFromUnknown(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    const parts = value.map(textFromUnknown).filter((part): part is string => Boolean(part));
    return parts.join("").trim() || undefined;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (typeof record.text === "string") return record.text;
    if (typeof record.content === "string") return record.content;
    if (Array.isArray(record.content)) return textFromUnknown(record.content);
    if (typeof record.message === "string") return record.message;
    if (record.message) return textFromUnknown(record.message);
  }
  return undefined;
}

export function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    const text = textFromUnknown(value);
    if (text && text.trim()) return text.trim();
  }
  return undefined;
}

export function safeJsonParse(line: string): unknown | undefined {
  try {
    return JSON.parse(line);
  } catch {
    return undefined;
  }
}
