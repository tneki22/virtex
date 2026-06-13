import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ExamApi } from "../../client/src/api.js";
import { useVoiceInput } from "../../client/src/hooks/useVoiceInput.js";

class FakeMediaRecorder {
  static isTypeSupported() { return true; }
  state = "inactive";
  mimeType = "audio/webm";
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;

  start() { this.state = "recording"; }
  stop() {
    this.state = "inactive";
    this.ondataavailable?.({ data: new Blob(["audio"], { type: this.mimeType }) });
    this.onstop?.();
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
});

function Harness({ api, onTranscript }: { api: ExamApi; onTranscript: (text: string) => void }) {
  const voice = useVoiceInput({ api, questionId: "q-1", onTranscript });
  return (
    <div>
      <output aria-label="status">{voice.status}</output>
      <button onClick={() => void voice.toggle()}>{voice.status === "recording" ? "Стоп" : "Диктовать"}</button>
    </div>
  );
}

describe("useVoiceInput", () => {
  it("records, transcribes, and releases the microphone", async () => {
    const user = userEvent.setup();
    const stop = vi.fn();
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [{ stop }] }) },
    });
    vi.stubGlobal("MediaRecorder", FakeMediaRecorder);
    const api = {
      transcribe: vi.fn().mockResolvedValue({ text: "Распознанный ответ", model: "whisper" }),
    } as unknown as ExamApi;
    const onTranscript = vi.fn();
    render(<Harness api={api} onTranscript={onTranscript} />);

    await user.click(screen.getByRole("button", { name: "Диктовать" }));
    expect(screen.getByLabelText("status")).toHaveTextContent("recording");
    await user.click(screen.getByRole("button", { name: "Стоп" }));

    await waitFor(() => expect(onTranscript).toHaveBeenCalledWith("Распознанный ответ"));
    expect(api.transcribe).toHaveBeenCalledWith(expect.any(Blob), "q-1");
    expect(stop).toHaveBeenCalled();
    expect(screen.getByLabelText("status")).toHaveTextContent("idle");
  });
});
