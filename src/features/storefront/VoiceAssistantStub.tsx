"use client";

// DEVELOPMENT STUB for the voice component. it has no microphone and no speech.
// delete this file when feat/voice merges (see voice.ts).
import { useId, useState, type ReactElement } from "react";

export type SpeechRequest = { id: string; text: string };

export interface VoiceAssistantProps {
  onTranscript: (text: string) => void | Promise<void>;
  speechRequest: SpeechRequest | null;
  disabled?: boolean;
}

export function VoiceAssistant({ onTranscript, speechRequest, disabled = false }: VoiceAssistantProps): ReactElement {
  const [text, setText] = useState("");
  const inputId = useId();
  return (
    <section aria-label="Voice (development stub)" className="tellr-card border-dashed">
      <p className="tellr-badge-fixture">DEVELOPMENT STUB: voice is not connected</p>
      <p className="tellr-hint mt-2">
        The real Cartesia voice component replaces this box after the voice branch merges. Typing a sentence here
        sends it the same way a spoken transcript would.
      </p>
      <form
        className="mt-3 flex flex-wrap items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (!text.trim()) return;
          void onTranscript(text.trim());
          setText("");
        }}
      >
        <div className="min-w-60 flex-1">
          <label htmlFor={inputId} className="tellr-label">
            Pretend transcript
          </label>
          <input id={inputId} className="tellr-input mt-1" value={text} onChange={(event) => setText(event.target.value)} />
        </div>
        <button type="submit" className="tellr-btn" disabled={disabled || !text.trim()}>
          Send as transcript
        </button>
      </form>
      {speechRequest && (
        <p className="tellr-hint mt-3">
          <span className="font-semibold">Would be spoken:</span> {speechRequest.text}
        </p>
      )}
    </section>
  );
}
