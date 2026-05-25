export function keywordsToDraft(keywords: string[]): string {
  return keywords.join(", ");
}

export function parseKeywordDraft(value: string): string[] {
  return value.split(/[,，]/).map((keyword) => keyword.trim()).filter(Boolean);
}
