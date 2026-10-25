// captures mono mic audio in the browser and hands 16 kHz pcm_s16le chunks to the stt session
import { createPcmChunker, type MicCapture } from "./cartesiaStt";

// tiny audioworklet that copies each input frame to the main thread; outputs stay silent
const TAP_PROCESSOR = `
class TellrPcmTap extends AudioWorkletProcessor {
  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (channel) this.port.postMessage(channel.slice(0));
    return true;
  }
}
registerProcessor("tellr-pcm-tap", TellrPcmTap);
`;

export async function startMicCapture(onChunk: (pcm: ArrayBuffer) => void): Promise<MicCapture> {
  if (typeof window === "undefined" || !navigator.mediaDevices?.getUserMedia || !window.AudioWorkletNode) {
    throw new DOMException("audio capture is not supported", "NotSupportedError");
  }
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  });
  const stopTracks = () => stream.getTracks().forEach((track) => track.stop());

  let ctx: AudioContext | null = null;
  try {
    ctx = new AudioContext();
    const moduleUrl = URL.createObjectURL(new Blob([TAP_PROCESSOR], { type: "application/javascript" }));
    try {
      await ctx.audioWorklet.addModule(moduleUrl);
    } finally {
      URL.revokeObjectURL(moduleUrl);
    }
    const source = ctx.createMediaStreamSource(stream);
    const tap = new AudioWorkletNode(ctx, "tellr-pcm-tap");
    const chunker = createPcmChunker(ctx.sampleRate, onChunk);
    tap.port.onmessage = (ev: MessageEvent<Float32Array>) => chunker.push(ev.data);
    source.connect(tap);
    // some browsers only pull audio through nodes connected to the destination
    tap.connect(ctx.destination);
    if (ctx.state === "suspended") await ctx.resume();

    const activeCtx = ctx;
    let stopped = false;
    return {
      stop() {
        if (stopped) return;
        stopped = true;
        tap.port.onmessage = null;
        chunker.flush();
        source.disconnect();
        tap.disconnect();
        stopTracks();
        void activeCtx.close();
      },
    };
  } catch (err) {
    stopTracks();
    void ctx?.close();
    throw err;
  }
}
