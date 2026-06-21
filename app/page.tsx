"use client";

import { useRef, useState, useEffect } from "react";
import { report } from "@/lib/report";

type Status = "idle" | "connecting" | "live" | "ending" | "error";
type Line = { id: string; role: "coach" | "you"; text: string };

// Per-response brief the coach speaks when the user ends the session.
const RECAP_INSTRUCTIONS =
  "The session is ending. Give the user a warm, brief wrap-up titled '3 things to remember'. " +
  "Say exactly three short takeaways, each one sentence, drawn from what you worked on together " +
  "(filler words and pace). Speak them aloud, encouraging, under 20 seconds total. Do not open a " +
  "new coaching moment or call any tool.";

export default function Home() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const micRef = useRef<MediaStream | null>(null);

  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [recap, setRecap] = useState<string | null>(null);

  // Tracks the end-of-session recap: pending = waiting for it, done = text
  // captured, so we only tear down once the coach has finished speaking it.
  const recapPendingRef = useRef(false);
  const recapDoneRef = useRef(false);
  const recapTimeoutRef = useRef<number | null>(null);
  // Guards the one-time greeting so a re-fired data-channel open can't create
  // a second response.
  const greetedRef = useRef(false);

  const transcriptEndRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [lines]);

  // Revoke the object URL when it changes or on unmount.
  useEffect(() => {
    return () => {
      if (videoUrl) URL.revokeObjectURL(videoUrl);
    };
  }, [videoUrl]);

  // Never stream silently: fully tear down the voice session on page
  // refresh/close and on unmount (the mic + connection must not outlive the page).
  useEffect(() => {
    const onPageHide = () => cleanup();
    window.addEventListener("pagehide", onPageHide);
    return () => {
      window.removeEventListener("pagehide", onPageHide);
      cleanup();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (videoUrl) URL.revokeObjectURL(videoUrl);
    setVideoUrl(URL.createObjectURL(file));
  }

  // The one imperative action the coach can trigger: jump + pause on a frame.
  function seekAndPause(seconds: number) {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = seconds;
    v.pause();
  }

  // ---- transcript helpers ----------------------------------------------------
  function addLine(role: Line["role"], text: string) {
    if (!text.trim()) return;
    setLines((prev) => [...prev, { id: crypto.randomUUID(), role, text }]);
  }

  // Stream the coach's words into a single growing line keyed by item id.
  function appendCoachDelta(itemId: string, delta: string) {
    setLines((prev) => {
      const idx = prev.findIndex((l) => l.id === itemId);
      if (idx === -1) return [...prev, { id: itemId, role: "coach", text: delta }];
      const next = [...prev];
      next[idx] = { ...next[idx], text: next[idx].text + delta };
      return next;
    });
  }

  // Pull the spoken text out of a finished response's output (used for the recap).
  function extractAssistantText(output: any[]): string {
    for (const item of output) {
      if (item.type === "message" && Array.isArray(item.content)) {
        const text = item.content
          .map((c: any) => c.transcript ?? c.text ?? "")
          .join(" ")
          .trim();
        if (text) return text;
      }
    }
    return "";
  }

  // ---- realtime event handling ----------------------------------------------
  function handleEvent(msg: MessageEvent) {
    let evt: any;
    try {
      evt = JSON.parse(msg.data);
    } catch {
      return;
    }

    switch (evt.type) {
      // Coach speech, streamed token-by-token for a live feel.
      // (The event was renamed across API versions — handle both names.)
      case "response.audio_transcript.delta":
      case "response.output_audio_transcript.delta":
        if (evt.item_id) appendCoachDelta(evt.item_id, evt.delta ?? "");
        break;

      // The user's own speech, transcribed after they finish a sentence.
      case "conversation.item.input_audio_transcription.completed":
        addLine("you", evt.transcript ?? "");
        break;

      // A finished response — handle seek_video tool calls + capture the recap.
      case "response.done": {
        const output = evt.response?.output ?? [];
        for (const item of output) {
          if (item.type === "function_call" && item.name === "seek_video") {
            let seconds = 0;
            try {
              seconds = JSON.parse(item.arguments)?.seconds ?? 0;
            } catch {
              /* ignore bad args */
            }
            seekAndPause(seconds);
            // Tell the coach the seek succeeded, then let it keep talking.
            sendEvent({
              type: "conversation.item.create",
              item: {
                type: "function_call_output",
                call_id: item.call_id,
                output: JSON.stringify({ ok: true, now_at: seconds }),
              },
            });
            sendEvent({ type: "response.create" });
          }
        }
        // If this was the closing recap, show it on screen and mark it done so
        // teardown can wait until the audio finishes playing.
        if (recapPendingRef.current) {
          const text = extractAssistantText(output);
          if (text) setRecap(text);
          recapDoneRef.current = true;
        }
        break;
      }

      // The coach finished playing audio. If that was the recap, tear down now.
      case "output_audio_buffer.stopped":
        if (recapPendingRef.current && recapDoneRef.current) finalizeEnd();
        break;

      default:
        // Helpful during the build to discover exact event names if they drift.
        // console.debug("realtime event:", evt.type, evt);
        break;
    }
  }

  function sendEvent(obj: unknown) {
    const dc = dcRef.current;
    if (dc && dc.readyState === "open") dc.send(JSON.stringify(obj));
  }

  // ---- session lifecycle -----------------------------------------------------
  async function startSession() {
    setError(null);
    setRecap(null);
    setLines([]);
    greetedRef.current = false;
    setStatus("connecting");
    try {
      // 1. Mic — echo cancellation on so the coach's own voice coming back
      // through speakers isn't heard as the user talking (which causes loops).
      const mic = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      micRef.current = mic;

      // 2. Ephemeral token from our server route (real key never leaves server).
      const tokenRes = await fetch("/api/realtime-token", { method: "POST" });
      const tokenData = await tokenRes.json();
      if (!tokenRes.ok) throw new Error(tokenData.error || "Could not start session.");
      const ephemeralKey: string = tokenData.value;

      // 3. Peer connection + mic track + remote audio.
      const pc = new RTCPeerConnection();
      pcRef.current = pc;

      pc.ontrack = (e) => {
        if (audioRef.current) audioRef.current.srcObject = e.streams[0];
      };
      const micTrack = mic.getAudioTracks()[0];
      if (!micTrack) throw new Error("No microphone audio track was available.");
      pc.addTrack(micTrack, mic);

      // 4. Data channel for events + tool calls.
      const dc = pc.createDataChannel("oai-events");
      dcRef.current = dc;
      dc.onopen = () => {
        setStatus("live");
        // Nudge the coach to greet first — exactly once. After this, server VAD
        // owns turn-taking and creates each subsequent response on user-stop.
        if (!greetedRef.current) {
          greetedRef.current = true;
          sendEvent({ type: "response.create" });
        }
      };
      dc.onmessage = handleEvent;

      // 5. SDP offer -> OpenAI -> answer.
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      console.log(
        "[coach] offer has audio section:",
        /\r?\nm=audio/.test(offer.sdp || ""),
      );

      const sdpRes = await fetch("https://api.openai.com/v1/realtime/calls", {
        method: "POST",
        body: offer.sdp,
        headers: {
          Authorization: `Bearer ${ephemeralKey}`,
          "Content-Type": "application/sdp",
        },
      });
      if (!sdpRes.ok) {
        const detail = (await sdpRes.text()).slice(0, 400);
        throw new Error(`OpenAI rejected the offer (HTTP ${sdpRes.status}). ${detail}`);
      }
      const answerSdp = await sdpRes.text();
      await pc.setRemoteDescription({ type: "answer", sdp: answerSdp });
    } catch (err: any) {
      console.error(err);
      setError(err?.message || "Something went wrong starting the session.");
      setStatus("error");
      cleanup();
    }
  }

  function cleanup() {
    if (recapTimeoutRef.current) {
      clearTimeout(recapTimeoutRef.current);
      recapTimeoutRef.current = null;
    }
    dcRef.current?.close();
    pcRef.current?.close();
    micRef.current?.getTracks().forEach((t) => t.stop());
    dcRef.current = null;
    pcRef.current = null;
    micRef.current = null;
  }

  // Tear down for real and reset to idle.
  function finalizeEnd() {
    if (recapTimeoutRef.current) {
      clearTimeout(recapTimeoutRef.current);
      recapTimeoutRef.current = null;
    }
    recapPendingRef.current = false;
    recapDoneRef.current = false;
    cleanup();
    setStatus("idle");
  }

  function endSession() {
    // Mid-connection: ask the coach for a short recap, let it speak, THEN close.
    if (dcRef.current?.readyState === "open" && status === "live") {
      recapPendingRef.current = true;
      recapDoneRef.current = false;
      setStatus("ending");
      // Stop any in-progress turn first, then request the closing recap.
      sendEvent({ type: "response.cancel" });
      sendEvent({ type: "response.create", response: { instructions: RECAP_INSTRUCTIONS } });
      // Safety net: never hang waiting for a recap that doesn't arrive.
      recapTimeoutRef.current = window.setTimeout(finalizeEnd, 20000);
    } else {
      // Not fully live yet (e.g. still connecting) — just close.
      finalizeEnd();
    }
  }

  // ---- UI ---------------------------------------------------------------------
  const statusLabel: Record<Status, string> = {
    idle: "Not connected",
    connecting: "Connecting…",
    live: "Coach is listening",
    ending: "Wrapping up — recap…",
    error: "Error",
  };

  return (
    <main className="mx-auto max-w-2xl px-6 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">Communication Coach</h1>
      <p className="mt-1 text-sm text-stone-500">
        Practice privately. No one watches but the coach.
      </p>

      {/* Video */}
      <section className="mt-6">
        <label className="block text-sm font-medium text-stone-600">
          Your practice video
        </label>
        <input
          type="file"
          accept="video/*"
          onChange={onPickFile}
          className="mt-2 block w-full text-sm text-stone-600 file:mr-3 file:rounded-md file:border-0 file:bg-stone-800 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-white hover:file:bg-stone-700"
        />
        <div className="mt-3 overflow-hidden rounded-lg bg-black">
          <video
            ref={videoRef}
            controls
            src={videoUrl ?? undefined}
            className="aspect-video w-full"
          />
        </div>
      </section>

      {/* Session focus (the ONLY thing surfaced from the report) */}
      <section className="mt-6 rounded-lg border border-stone-200 bg-white p-4">
        <div className="text-xs font-medium uppercase tracking-wide text-stone-400">
          Today&apos;s focus
        </div>
        <div className="mt-1 text-lg font-medium">{report.session_focus.label}</div>
        <p className="mt-1 text-sm leading-relaxed text-stone-600">
          {report.session_focus.coach_framing}
        </p>
      </section>

      {/* Talk controls */}
      <section className="mt-6 flex items-center gap-3">
        {status === "idle" || status === "error" ? (
          <button
            onClick={startSession}
            className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500"
          >
            🎙 Talk to coach
          </button>
        ) : status === "ending" ? (
          <button
            disabled
            className="cursor-not-allowed rounded-md bg-stone-400 px-4 py-2 text-sm font-medium text-white"
          >
            Wrapping up…
          </button>
        ) : (
          <button
            onClick={endSession}
            className="rounded-md bg-stone-800 px-4 py-2 text-sm font-medium text-white hover:bg-stone-700"
          >
            End session
          </button>
        )}
        <span className="flex items-center gap-2 text-sm text-stone-500">
          <span
            className={
              "inline-block h-2 w-2 rounded-full " +
              (status === "live"
                ? "bg-emerald-500"
                : status === "connecting"
                  ? "bg-amber-400"
                  : status === "error"
                    ? "bg-red-500"
                    : "bg-stone-300")
            }
          />
          {statusLabel[status]}
        </span>
      </section>

      <p className="mt-2 text-xs text-stone-400">
        Tip: use headphones. On speakers the coach can hear itself and talk over you.
      </p>

      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}

      {/* End-of-session recap (also spoken aloud by the coach) */}
      {recap && (
        <section className="mt-6 rounded-lg border border-emerald-200 bg-emerald-50 p-4">
          <div className="text-xs font-medium uppercase tracking-wide text-emerald-600">
            3 things to remember
          </div>
          <p className="mt-1 whitespace-pre-line text-sm leading-relaxed text-emerald-900">
            {recap}
          </p>
        </section>
      )}

      {/* Live transcript */}
      <section className="mt-6">
        <div className="text-xs font-medium uppercase tracking-wide text-stone-400">
          Conversation
        </div>
        <div className="mt-2 h-56 space-y-3 overflow-y-auto rounded-lg border border-stone-200 bg-white p-4">
          {lines.length === 0 ? (
            <p className="text-sm text-stone-400">
              Your spoken conversation with the coach will appear here.
            </p>
          ) : (
            lines.map((l) => (
              <div key={l.id} className="text-sm leading-relaxed">
                <span
                  className={
                    "font-medium " +
                    (l.role === "coach" ? "text-emerald-700" : "text-stone-900")
                  }
                >
                  {l.role === "coach" ? "Coach" : "You"}:
                </span>{" "}
                <span className="text-stone-700">{l.text}</span>
              </div>
            ))
          )}
          <div ref={transcriptEndRef} />
        </div>
      </section>

      {/* Hidden — plays the coach's voice. */}
      <audio ref={audioRef} autoPlay className="hidden" />
    </main>
  );
}
