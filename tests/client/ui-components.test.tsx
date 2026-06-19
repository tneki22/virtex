import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AnimatedDisclosure } from "../../client/src/components/ui/AnimatedDisclosure.js";
import { SegmentedTabs } from "../../client/src/components/ui/SegmentedTabs.js";

describe("UI primitives", () => {
  it("renders a controlled animated disclosure with accessible expanded state", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(
      <AnimatedDisclosure
        title="Официальная формулировка"
        open={false}
        onOpenChange={onOpenChange}
      >
        <p>Полный текст вопроса</p>
      </AnimatedDisclosure>,
    );

    const button = screen.getByRole("button", { name: /официальная формулировка/i });
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Полный текст вопроса")).not.toBeInTheDocument();

    await user.click(button);

    expect(onOpenChange).toHaveBeenCalledWith(true);
  });

  it("marks the disclosure icon separately from the title for stateful styling", () => {
    render(
      <AnimatedDisclosure title="Profile">
        <p>Profile body</p>
      </AnimatedDisclosure>,
    );

    const button = screen.getByRole("button", { name: "Profile" });
    expect(button.querySelector(".animated-disclosure-title")).toHaveTextContent("Profile");
    expect(button.querySelector(".animated-disclosure-icon")).toHaveAttribute("aria-hidden", "true");
  });

  it("supports keyboard navigation between segmented tabs", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <SegmentedTabs
        label="Материалы вопроса"
        value="answer"
        onChange={onChange}
        tabs={[
          { value: "answer", label: "Эталон" },
          { value: "sources", label: "Материалы" },
          { value: "notes", label: "Заметки" },
        ]}
      />,
    );

    const answerTab = screen.getByRole("tab", { name: "Эталон" });
    answerTab.focus();
    await user.keyboard("{ArrowRight}");

    expect(onChange).toHaveBeenCalledWith("sources");
  });
});
