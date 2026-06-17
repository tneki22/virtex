import { ProgressiveMarkdown } from "./ProgressiveMarkdown.js";

interface ProgressiveTextProps {
  text: string;
  durationMs?: number;
}

export function ProgressiveText({ text, durationMs = 520 }: ProgressiveTextProps) {
  return <ProgressiveMarkdown text={text} durationMs={durationMs} />;
}
