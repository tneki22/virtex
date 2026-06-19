import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("UI interaction styles", () => {
  it("anchors the exam exit button in the top-left corner", () => {
    const css = readFileSync("client/src/styles.css", "utf8");
    const rule = css.match(/\.exam-exit-button\s*\{([^}]*)\}/)?.[1] ?? "";

    expect(rule).toMatch(/top:\s*8px/);
    expect(rule).toMatch(/left:\s*18px/);
    expect(rule).not.toMatch(/right:\s*18px/);
  });

  it("centralizes motion timing and keeps a reduced-motion override", () => {
    const css = readFileSync("client/src/styles.css", "utf8");

    expect(css).toContain("--motion-fast: 120ms");
    expect(css).toContain("--motion-base: 180ms");
    expect(css).toContain("--motion-slow: 320ms");
    expect(css).toContain("--motion-ease: cubic-bezier(0.2, 0.8, 0.2, 1)");
    expect(css).toContain("--focus-ring: 0 0 0 3px");
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*transition-duration: 0\.01ms !important/);
  });

  it("separates hover-capable input and provides pressed feedback", () => {
    const css = readFileSync("client/src/styles.css", "utf8");

    expect(css).toContain("@media (hover: hover) and (pointer: fine)");
    expect(css).toMatch(/\.primary-button:active:not\(:disabled\)/);
    expect(css).toMatch(/\.icon-button:active:not\(:disabled\)/);
  });

  it("keeps prompt disclosure icons pinned and rotated by state", () => {
    const css = readFileSync("client/src/styles.css", "utf8");

    expect(css).toMatch(/\.prompt-profile-disclosure\s*>\s*\.animated-disclosure-trigger\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s*auto/s);
    expect(css).toMatch(/\.animated-disclosure-trigger\s*\.animated-disclosure-icon\s*\{[^}]*transition:\s*transform var\(--ease\)/s);
    expect(css).toMatch(/\.animated-disclosure\.is-open\s*>\s*\.animated-disclosure-trigger\s*\.animated-disclosure-icon\s*\{[^}]*transform:\s*rotate\(180deg\)/s);
  });

  it("adds hover feedback to prompt editor rows", () => {
    const css = readFileSync("client/src/styles.css", "utf8");

    expect(css).toMatch(/@media \(hover: hover\) and \(pointer: fine\)[\s\S]*\.prompt-profile-disclosure\s*>\s*\.animated-disclosure-trigger:hover/s);
    expect(css).toMatch(/@media \(hover: hover\) and \(pointer: fine\)[\s\S]*\.quick-prompt-editor:hover/s);
  });

  it("uses larger prompt save status text", () => {
    const css = readFileSync("client/src/styles.css", "utf8");
    const rule = css.match(/\.prompt-settings-success\s*\{([^}]*)\}/)?.[1] ?? "";

    expect(rule).toMatch(/font-size:\s*13px/);
  });

  it("halves the desktop chat panel side padding", () => {
    const css = readFileSync("client/src/styles.css", "utf8");
    const rule = css.match(/\.answer-panel\s*\{([^}]*)\}/)?.[1] ?? "";

    expect(rule).toMatch(/padding:\s*52px clamp\(16px,\s*2\.5vw,\s*38px\) 80px/);
  });

  it("keeps history hover feedback out of layout properties", () => {
    const css = readFileSync("client/src/styles.css", "utf8");

    expect(css).not.toMatch(/\.history-item\s*\{[^}]*transition:[^;}]*padding/s);
    expect(css).not.toMatch(/\.exam-history-result summary\s*\{[^}]*transition:[^;}]*padding/s);
  });
});
