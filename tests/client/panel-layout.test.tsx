import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { PanelResizeHandle } from "../../client/src/components/PanelResizeHandle.js";
import {
  clampPanelLayout,
  DEFAULT_PANEL_LAYOUT,
  parseStoredPanelLayout,
} from "../../client/src/hooks/usePanelLayout.js";

describe("panel layout", () => {
  it("clamps stored widths while preserving a readable center", () => {
    expect(clampPanelLayout({ left: 100, right: 900 }, 1440)).toEqual({
      left: 220,
      right: 648,
    });
    expect(clampPanelLayout({ left: 300, right: 360 }, 1440)).toEqual({
      left: 300,
      right: 360,
    });
  });

  it("parses valid persisted values and rejects broken data", () => {
    expect(parseStoredPanelLayout('{"left":320,"right":420}', 1440)).toEqual({
      left: 320,
      right: 420,
    });
    expect(parseStoredPanelLayout("broken", 1440)).toEqual(DEFAULT_PANEL_LAYOUT);
  });

  it("exposes an accessible keyboard-operated separator", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <PanelResizeHandle
        label="Изменить ширину списка вопросов"
        value={280}
        min={220}
        max={500}
        onChange={onChange}
        onPointerStart={vi.fn()}
        onReset={vi.fn()}
      />,
    );

    const separator = screen.getByRole("separator", {
      name: "Изменить ширину списка вопросов",
    });
    expect(separator).toHaveAttribute("aria-orientation", "vertical");
    expect(separator).toHaveAttribute("aria-valuemin", "220");
    expect(separator).toHaveAttribute("aria-valuemax", "500");
    expect(separator).toHaveAttribute("aria-valuenow", "280");

    await user.click(separator);
    await user.keyboard("{ArrowRight}");
    expect(onChange).toHaveBeenCalledWith(292);
  });
});
