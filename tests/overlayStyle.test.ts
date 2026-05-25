import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("overlay settings style", () => {
  it("lets the settings view grow taller than the window so it can scroll", async () => {
    const css = await readFile("src/overlay/style.css", "utf8");

    expect(css).toContain("body.settings-mode,\nbody.settings-mode #root");
    expect(css).toMatch(/body\.settings-mode,\s*body\.settings-mode #root\s*\{[^}]*height:\s*auto;/s);
    expect(css).toMatch(/body\.settings-mode,\s*body\.settings-mode #root\s*\{[^}]*overflow:\s*visible;/s);
  });

  it("does not make the rule list a nested scroll container", async () => {
    const css = await readFile("src/overlay/style.css", "utf8");
    const rulesListBlock = css.match(/\.rules-list\s*\{(?<body>[^}]*)\}/)?.groups?.body ?? "";

    expect(rulesListBlock).not.toMatch(/max-height\s*:/);
    expect(rulesListBlock).not.toMatch(/overflow\s*:/);
  });

  it("uses a compact single-column settings layout on normal editor windows", async () => {
    const css = await readFile("src/overlay/style.css", "utf8");

    expect(css).toMatch(/\s*\(max-width:\s*1120px\)\s*\{[\s\S]*\.settings-grid\s*\{[\s\S]*grid-template-columns:\s*1fr;/);
    expect(css).toMatch(/\.form-row\s*\{[^}]*flex-wrap:\s*wrap;/s);
    expect(css).toMatch(/\.form-row\s*>\s*label\s*\{[^}]*min-width:\s*160px;/s);
    expect(css).toMatch(/input,\s*select\s*\{[^}]*width:\s*100%;/s);
  });

  it("prevents native media dragging inside the layout canvas", async () => {
    const css = await readFile("src/overlay/style.css", "utf8");
    const mediaBlock = css.match(/\.layout-media\s*\{(?<body>[^}]*)\}/s)?.groups?.body ?? "";

    expect(mediaBlock).toMatch(/pointer-events:\s*none;/);
    expect(mediaBlock).toMatch(/user-select:\s*none;/);
    expect(mediaBlock).toMatch(/-webkit-user-drag:\s*none;/);
  });
});
