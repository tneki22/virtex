import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProgressiveMarkdown } from "../../client/src/components/ProgressiveMarkdown.js";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("ProgressiveMarkdown", () => {
  it("reveals markdown progressively and can finish immediately", () => {
    vi.useFakeTimers();
    render(<ProgressiveMarkdown text={"**Первый фрагмент.**\n\n- Второй фрагмент."} durationMs={400} />);

    expect(screen.queryByText(/Второй фрагмент/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /показать сразу/i }));
    expect(screen.getByText("Первый фрагмент.").tagName).toBe("STRONG");
    expect(screen.getByText("Второй фрагмент.").tagName).toBe("LI");
  });

  it("renders immediately when reduced motion is requested", () => {
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));

    render(<ProgressiveMarkdown text="Полный ответ без анимации." durationMs={400} />);
    expect(screen.getByText("Полный ответ без анимации.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /показать сразу/i })).not.toBeInTheDocument();
  });
});
