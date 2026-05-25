import { describe, expect, it } from "vitest";
import { keywordsToDraft, parseKeywordDraft } from "../src/overlay/keywordInput.js";

describe("keyword input helpers", () => {
  it("parses comma-separated keyword drafts for saving", () => {
    expect(parseKeywordDraft("不对, 不行，重新来")).toEqual(["不对", "不行", "重新来"]);
  });

  it("keeps display text separate from parsed keywords so a trailing comma can be typed", () => {
    const draft = "不对,";

    expect(parseKeywordDraft(draft)).toEqual(["不对"]);
    expect(draft).toBe("不对,");
  });

  it("formats saved keywords into the initial draft text", () => {
    expect(keywordsToDraft(["不对", "重新来"])).toBe("不对, 重新来");
  });
});
