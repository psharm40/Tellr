"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createSttSession, type SocketLike, type SttDeps, type SttSession } from "./cartesiaStt";
import { startMicCapture } from "./micCapture";

export type SpeechRequest = { id: string; text: string };
export type VoiceStatus = "idle" | "listening" | "processing" | "speaking" | "error";
export type MicPermission = "unknown" | "granted" | "denied";

async function readError(res: Response, fallback: string): Promise<string> {
  const body: unknown = await res.json().catch(() => null);
  if (body && typeof body === "object" && "error" in body && typeof body.error === "string") return body.error;
  return fallback;
}

const browserDeps: SttDeps = {
  async fetchToken(signal) {
    const res = await fetch("/api/voice/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
      signal,
    });
    if (!res.ok) throw new Error(await readError(res, "Voice input is unavailable right now."));
    const body: unknown = await res.json();
    if (!body || typeof body !== "object" || !("token" in body) || typeof body.token !== "string") {
      throw new Error("Voice input is unavailable right now.");
    }
    return body.token;
  },
  openSocket: (url) => new WebSocket(url) as unknown as SocketLike,
  startCapture: startMicCapture,
  setTimer: (fn, ms) => window.setTimeout(fn, ms),
  clearTimer: (id) => window.clearTimeout(id as number),
};

// "read responses aloud" preference, remembered per browser; falls back to memory if storage is blocked
const AUTO_SPEAK_KEY = "tellr.voice.autoSpeak";
const prefListeners = new Set<() => void>();
let memoryAutoSpeak: boolean | null = null;

function readAutoSpeak(): boolean {
  if (memoryAutoSpeak !== null) return memoryAutoSpeak;
  try {
    return window.localStorage.getItem(AUTO_SPEAK_KEY) !== "off";
  } catch {
    return true;
  }
}

function subscribeAutoSpeak(listener: () => void) {
  prefListeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    prefListeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

function writeAutoSpeak(value: boolean) {
  memoryAutoSpeak = value;
  try {
    window.localStorage.setItem(AUTO_SPEAK_KEY, value ? "on" : "off");
  } catch {
    // storage blocked; the in-memory value still applies for this page
  }
  prefListeners.forEach((listener) => listener());
}

interface Options {
  onTranscript: (text: string) => void | Promise<void>;
  speechRequest: SpeechRequest | null;
  disabled?: boolean;
}

export function useVoiceAssistant({ onTranscript, speechRequest, disabled = false }: Options) {
  const [status, setStatus] = useState<VoiceStatus>("idle");
  const [statusMessage, setStatusMessage] = useState("Voice is ready. Press Start listening, or type instead.");
  const [micPermission, setMicPermission] = useState<MicPermission>("unknown");
  const [partialTranscript, setPartialTranscript] = useState("");
  const [finalTranscript, setFinalTranscript] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [playBlocked, setPlayBlocked] = useState(false);
  const autoSpeak = useSyncExternalStore(subscribeAutoSpeak, readAutoSpeak, () => true);

  const onTranscriptRef = useRef(onTranscript);
  const sessionRef = useRef<SttSession | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlRef = useRef<string | null>(null);
  const speakAbortRef = useRef<AbortController | null>(null);
  const handledSpeechIdRef = useRef<string | null>(null);
  const pendingSpeechRef = useRef<SpeechRequest | null>(null);

  useEffect(() => {
    onTranscriptRef.current = onTranscript;
  });

  const releaseAudio = useCallback(() => {
    speakAbortRef.current?.abort();
    speakAbortRef.current = null;
    const audio = audioRef.current;
    if (audio) {
      audio.onended = audio.onerror = null;
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    }
    audioRef.current = null;
    if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
    audioUrlRef.current = null;
  }, []);

  const speak = useCallback(
    async (text: string) => {
      releaseAudio();
      const controller = new AbortController();
      speakAbortRef.current = controller;
      setPlayBlocked(false);
      setError(null);
      setStatus("speaking");
      setStatusMessage("Preparing the spoken response…");
      try {
        const res = await fetch("/api/voice/speak", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text }),
          signal: controller.signal,
        });
        if (!res.ok) throw new Error(await readError(res, "Speech is unavailable right now."));
        const blob = await res.blob();
        if (controller.signal.aborted) return;
        const url = URL.createObjectURL(blob);
        audioUrlRef.current = url;
        const audio = new Audio(url);
        audioRef.current = audio;
        audio.onended = () => {
          if (audioRef.current !== audio) return;
          releaseAudio();
          setStatus("idle");
          setStatusMessage("Finished speaking.");
        };
        audio.onerror = () => {
          if (audioRef.current !== audio) return;
          releaseAudio();
          setStatus("error");
          setError("The spoken response couldn't be played. The text is shown below.");
        };
        try {
          await audio.play();
          if (audioRef.current === audio) setStatusMessage("Speaking. Press Stop speaking to silence it.");
        } catch (playErr) {
          if (audioRef.current !== audio) return;
          if (playErr instanceof DOMException && playErr.name === "NotAllowedError") {
            // keep the loaded audio so the play button can start it inside a user gesture
            setPlayBlocked(true);
            setStatus("idle");
            setStatusMessage("Your browser blocked automatic audio. Press Play spoken response to hear it.");
          } else {
            throw playErr;
          }
        }
      } catch (err) {
        if (controller.signal.aborted) return;
        releaseAudio();
        const message = err instanceof Error && err.message ? err.message : "Speech is unavailable right now.";
        setStatus("error");
        setError(`${message} The text is shown below.`);
        setStatusMessage("Couldn't play the spoken response.");
      }
    },
    [releaseAudio],
  );

  const stopSpeaking = useCallback(() => {
    pendingSpeechRef.current = null;
    releaseAudio();
    setPlayBlocked(false);
    setStatus((s) => (s === "speaking" ? "idle" : s));
    setStatusMessage("Speech stopped.");
  }, [releaseAudio]);

  // explicit "play" button: resumes blocked audio in the click handler, otherwise fetches fresh audio
  const playSpeech = useCallback(
    (text: string) => {
      const audio = audioRef.current;
      if (playBlocked && audio) {
        setPlayBlocked(false);
        setStatus("speaking");
        setStatusMessage("Speaking. Press Stop speaking to silence it.");
        audio.play().catch(() => {
          releaseAudio();
          setStatus("error");
          setError("The spoken response couldn't be played. The text is shown below.");
        });
        return;
      }
      void speak(text);
    },
    [playBlocked, releaseAudio, speak],
  );

  const playPendingSpeech = useCallback(() => {
    const pending = pendingSpeechRef.current;
    pendingSpeechRef.current = null;
    if (pending) void speak(pending.text);
  }, [speak]);

  const startListening = useCallback(() => {
    if (disabled || sessionRef.current) return;
    // never record while tts is playing, to avoid the mic hearing the speaker
    releaseAudio();
    setPlayBlocked(false);
    setError(null);
    setPartialTranscript("");
    setStatus("listening");
    setStatusMessage("Starting the microphone…");

    const session: SttSession = createSttSession(browserDeps, (event) => {
      if (sessionRef.current !== session) return;
      switch (event.type) {
        case "mic_granted":
          setMicPermission("granted");
          setStatusMessage("Connecting to Cartesia speech recognition…");
          break;
        case "listening":
          setStatusMessage("Listening. Press Stop listening when you're done.");
          break;
        case "partial":
          setPartialTranscript(event.text);
          break;
        case "processing":
          setStatus("processing");
          setStatusMessage("Microphone off. Finishing the transcript…");
          break;
        case "final":
          sessionRef.current = null;
          setPartialTranscript("");
          setFinalTranscript(event.text);
          setStatus("idle");
          setStatusMessage(`Heard: ${event.text}`);
          // exactly one callback per final utterance; parent errors are logged, not swallowed silently
          Promise.resolve()
            .then(() => onTranscriptRef.current(event.text))
            .catch((err) => console.error("onTranscript handler failed", err));
          playPendingSpeech();
          break;
        case "empty":
          sessionRef.current = null;
          setPartialTranscript("");
          setStatus("idle");
          setStatusMessage("I didn't catch anything. Try again, or type your request.");
          playPendingSpeech();
          break;
        case "error":
          sessionRef.current = null;
          if (event.kind === "mic_denied") setMicPermission("denied");
          setPartialTranscript("");
          setStatus("error");
          // full message goes to the alert only, so screen readers don't hear it twice
          setError(event.message);
          setStatusMessage("Voice input stopped.");
          break;
      }
    });
    sessionRef.current = session;
  }, [disabled, playPendingSpeech, releaseAudio]);

  const stopListening = useCallback(() => {
    sessionRef.current?.stop();
  }, []);

  const cancelListening = useCallback(() => {
    if (!sessionRef.current) return;
    sessionRef.current.cancel();
    sessionRef.current = null;
    setPartialTranscript("");
    setStatus("idle");
    setStatusMessage("Voice input is paused.");
  }, []);

  // a new speechRequest.id means a new playback, even when the text repeats
  useEffect(() => {
    if (!speechRequest || speechRequest.id === handledSpeechIdRef.current) return;
    handledSpeechIdRef.current = speechRequest.id;
    if (!autoSpeak) return;
    if (sessionRef.current) {
      // wait until the mic is closed so playback isn't recorded
      pendingSpeechRef.current = speechRequest;
      return;
    }
    void speak(speechRequest.text);
  }, [speechRequest, autoSpeak, speak]);

  // the parent disabling voice cancels any in-flight recording without emitting a transcript
  useEffect(() => {
    if (disabled) cancelListening();
  }, [disabled, cancelListening]);

  useEffect(() => {
    return () => {
      sessionRef.current?.cancel();
      sessionRef.current = null;
      releaseAudio();
    };
  }, [releaseAudio]);

  return {
    status,
    statusMessage,
    micPermission,
    partialTranscript,
    finalTranscript,
    error,
    playBlocked,
    autoSpeak,
    setAutoSpeak: writeAutoSpeak,
    startListening,
    stopListening,
    stopSpeaking,
    playSpeech,
  };
}
