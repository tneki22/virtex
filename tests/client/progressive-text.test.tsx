import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProgressiveText } from "../../client/src/components/ProgressiveText.js";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("ProgressiveText", () => {
  it("reveals text progressively and can finish immediately", () => {
    vi.useFakeTimers();
    render(<ProgressiveText text="Первый фрагмент. Второй фрагмент." durationMs={400} />);

    expect(screen.queryByText(/Второй фрагмент/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /показать сразу/i }));
    expect(screen.getByText(/Второй фрагмент/)).toBeInTheDocument();
  });

  it("renders immediately when reduced motion is requested", () => {
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));

    render(<ProgressiveText text="Полный ответ без анимации." durationMs={400} />);
    expect(screen.getByText("Полный ответ без анимации.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /показать сразу/i })).not.toBeInTheDocument();
  });
});
