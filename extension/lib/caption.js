// live caption of tellr's speech: words appear at an even pace across the audio's length.
// cartesia's mp3 has no word timings, so this is an estimate, not exact sync.
// content.js can't import modules, so it keeps a copy of captionAt.

// the words due by elapsedMs, showing only the last maxWords so a long answer stays readable
export function captionAt(text, elapsedMs, durationMs, maxWords = 40) {
  const words = String(text || "").split(/\s+/).filter(Boolean);
  const share = durationMs > 0 ? Math.min(1, Math.max(0, elapsedMs / durationMs)) : 1;
  const shown = Math.max(1, Math.ceil(words.length * share));
  const start = Math.max(0, shown - maxWords);
  return (start > 0 ? "… " : "") + words.slice(start, shown).join(" ");
}

// runs onText on every frame until the caption is done or replaced; returns a stop function
export function playCaption(text, durationMs, onText) {
  const started = performance.now();
  let frame = 0;
  const tick = () => {
    const elapsed = performance.now() - started;
    onText(captionAt(text, elapsed, durationMs));
    if (elapsed < durationMs) frame = requestAnimationFrame(tick);
  };
  tick();
  return () => cancelAnimationFrame(frame);
}
