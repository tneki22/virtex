import { useEffect, useState } from "react";

interface ProgressiveTextProps {
  text: string;
  durationMs?: number;
}

export function ProgressiveText({ text, durationMs = 520 }: ProgressiveTextProps) {
  const reducedMotion = typeof window.matchMedia === "function"
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const [visibleLength, setVisibleLength] = useState(reducedMotion ? text.length : 0);

  useEffect(() => {
    if (reducedMotion) {
      setVisibleLength(text.length);
      return;
    }

    setVisibleLength(0);
    const startedAt = performance.now();
    const timer = window.setInterval(() => {
      const elapsed = performance.now() - startedAt;
      const progress = Math.min(1, elapsed / Math.max(1, durationMs));
      setVisibleLength(Math.max(1, Math.ceil(text.length * progress)));
      if (progress >= 1) window.clearInterval(timer);
    }, 24);
    return () => window.clearInterval(timer);
  }, [durationMs, reducedMotion, text]);

  const complete = visibleLength >= text.length;
  return (
    <div className="progressive-text">
      <span>{text.slice(0, visibleLength)}</span>
      {!complete && (
        <button type="button" onClick={() => setVisibleLength(text.length)}>
          Показать сразу
        </button>
      )}
    </div>
  );
}
