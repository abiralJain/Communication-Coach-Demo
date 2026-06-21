import { NextResponse } from "next/server";
import { report } from "@/lib/report";
import {
  buildInstructions,
  seekVideoTool,
  setPracticeLineTool,
} from "@/lib/coachInstructions";

// Mints a short-lived ephemeral token server-side. The real OPENAI_API_KEY
// stays here and is NEVER sent to the browser — the browser only receives the
// ephemeral "value" returned below.
export async function POST() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "OPENAI_API_KEY is missing. Add it to .env.local and restart the dev server." },
      { status: 500 },
    );
  }

  const model = process.env.REALTIME_MODEL || "gpt-realtime-mini-2025-10-06";
  const voice = process.env.REALTIME_VOICE || "marin";

  const sessionConfig = {
    session: {
      type: "realtime",
      model,
      instructions: buildInstructions(report),
      audio: {
        output: { voice },
        input: {
          // Enables transcription of the USER's speech so the page can show it.
          transcription: { model: "whisper-1" },
          // Server-side voice activity detection owns turn-taking: the coach
          // makes ONE response when the user stops, then waits. Tuned to be less
          // twitchy so background noise / faint echo doesn't trigger a new turn.
          turn_detection: {
            type: "server_vad",
            // 0.5 is the API default. Higher (0.6) was missing quiet user speech,
            // so no user turn committed -> no user transcript. Echo cancellation
            // (set in the browser getUserMedia) handles the self-hearing loop.
            threshold: 0.5,
            prefix_padding_ms: 300,
            silence_duration_ms: 600,
            create_response: true,
            interrupt_response: true,
          },
        },
      },
      tools: [seekVideoTool, setPracticeLineTool],
      tool_choice: "auto",
    },
  };

  try {
    const res = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "OpenAI-Safety-Identifier": "communication-coach-prototype",
      },
      body: JSON.stringify(sessionConfig),
    });

    const data = await res.json();

    if (!res.ok) {
      console.error("client_secrets error:", data);
      return NextResponse.json(
        { error: data?.error?.message || "Failed to mint realtime token." },
        { status: res.status },
      );
    }

    // Return only the ephemeral value (+ model, handy for the SDP step).
    return NextResponse.json({ value: data.value, model });
  } catch (err) {
    console.error("realtime-token route failed:", err);
    return NextResponse.json({ error: "Network error minting token." }, { status: 500 });
  }
}
