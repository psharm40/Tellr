"use client";

import { useId, type ReactElement } from "react";
import { useVoiceAssistant, type SpeechRequest } from "./useVoiceAssistant";

export type { SpeechRequest };

export interface VoiceAssistantProps {
  onTranscript: (text: string) => void | Promise<void>;
  speechRequest: SpeechRequest | null;
  disabled?: boolean;
}

const buttonClass =
  "min-h-11 rounded-md border-2 border-zinc-900 px-4 py-2 font-semibold text-zinc-950 bg-white " +
  "hover:bg-zinc-100 focus-visible:outline focus-visible:outline-4 focus-visible:outline-offset-2 " +
  "focus-visible:outline-blue-700 disabled:cursor-not-allowed disabled:border-zinc-400 disabled:text-zinc-500 " +
  "dark:border-zinc-100 dark:bg-zinc-900 dark:text-zinc-50 dark:hover:bg-zinc-800 " +
  "dark:disabled:border-zinc-600 dark:disabled:text-zinc-500";

const primaryButtonClass =
  "min-h-11 rounded-md border-2 border-blue-800 bg-blue-800 px-4 py-2 font-semibold text-white " +
  "hover:bg-blue-900 focus-visible:outline focus-visible:outline-4 focus-visible:outline-offset-2 " +
  "focus-visible:outline-blue-700 disabled:cursor-not-allowed disabled:border-zinc-400 disabled:bg-zinc-300 " +
  "disabled:text-zinc-600";

const STATUS_LABEL: Record<string, string> = {
  idle: "Ready",
  listening: "Listening",
  processing: "Transcribing",
  speaking: "Speaking",
  error: "Needs attention",
};

const MIC_LABEL = {
  unknown: "Microphone not used yet. Your browser will ask for permission when you start listening.",
  granted: "Microphone allowed. It is only on while you are listening.",
  denied: "Microphone blocked. Typing works without it.",
} as const;

// push-to-talk voice controls: cartesia ink transcribes, cartesia sonic speaks.
// this component only emits transcripts and plays text; it never touches cart, inspection, or checkout.
export function VoiceAssistant({ onTranscript, speechRequest, disabled = false }: VoiceAssistantProps): ReactElement {
  const voice = useVoiceAssistant({ onTranscript, speechRequest, disabled });
  const headingId = useId();
  const autoSpeakHintId = useId();
  const busy = voice.status === "listening" || voice.status === "processing";
  const transcript = voice.partialTranscript || voice.finalTranscript;

  return (
    <section
      aria-labelledby={headingId}
      className="flex flex-col gap-4 rounded-lg border-2 border-zinc-900 bg-white p-4 text-zinc-950 dark:border-zinc-100 dark:bg-zinc-950 dark:text-zinc-50"
    >
      <div>
        <h2 id={headingId} className="text-lg font-bold">
          Voice
        </h2>
        <p className="text-sm text-zinc-700 dark:text-zinc-300">
          Speech is transcribed by Cartesia Ink and read aloud by Cartesia Sonic. You can always type instead.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={primaryButtonClass}
          onClick={voice.startListening}
          disabled={disabled || busy}
        >
          Start listening
        </button>
        <button
          type="button"
          className={buttonClass}
          onClick={voice.stopListening}
          disabled={voice.status !== "listening"}
        >
          Stop listening
        </button>
        <button
          type="button"
          className={buttonClass}
          onClick={voice.stopSpeaking}
          disabled={voice.status !== "speaking" && !voice.playBlocked}
        >
          Stop speaking
        </button>
      </div>

      <div className="flex flex-col gap-1">
        <label className="flex items-center gap-2 font-medium">
          <input
            type="checkbox"
            className="h-5 w-5 accent-blue-800 focus-visible:outline focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-blue-700"
            checked={voice.autoSpeak}
            onChange={(e) => {
              voice.setAutoSpeak(e.target.checked);
              if (!e.target.checked) voice.stopSpeaking();
            }}
            aria-describedby={autoSpeakHintId}
          />
          Read responses aloud automatically
        </label>
        <p id={autoSpeakHintId} className="text-sm text-zinc-700 dark:text-zinc-300">
          Turn this off if you use a screen reader so the two voices don&apos;t overlap. Responses stay on screen and
          you can still press Play.
        </p>
      </div>

      <div className="flex flex-col gap-1 text-sm">
        <p>
          <span className="font-semibold">Status: {STATUS_LABEL[voice.status]}.</span>{" "}
          <span role="status" aria-live="polite">
            {disabled ? "Voice input is paused." : voice.statusMessage}
          </span>
        </p>
        <p>{MIC_LABEL[voice.micPermission]}</p>
      </div>

      {voice.error && (
        <p
          role="alert"
          className="rounded-md border-2 border-red-800 bg-red-50 p-3 font-medium text-red-900 dark:border-red-400 dark:bg-red-950 dark:text-red-100"
        >
          {voice.error}
        </p>
      )}

      <div>
        <h3 className="font-semibold">What you said</h3>
        <p className="min-h-6 whitespace-pre-wrap">
          {transcript || <span className="text-zinc-600 dark:text-zinc-400">Nothing yet.</span>}
          {voice.partialTranscript && (
            <span className="text-zinc-600 dark:text-zinc-400"> (still transcribing)</span>
          )}
        </p>
      </div>

      <div>
        <h3 className="font-semibold">Tellr&apos;s response</h3>
        {/* announce text to screen readers only when it won't also be spoken aloud */}
        <p className="min-h-6 whitespace-pre-wrap" aria-live={voice.autoSpeak ? "off" : "polite"}>
          {speechRequest?.text || <span className="text-zinc-600 dark:text-zinc-400">No response yet.</span>}
        </p>
        <button
          type="button"
          className={`${buttonClass} mt-2`}
          onClick={() => speechRequest && voice.playSpeech(speechRequest.text)}
          disabled={!speechRequest?.text || busy || voice.status === "speaking"}
        >
          Play spoken response
        </button>
      </div>
    </section>
  );
}
