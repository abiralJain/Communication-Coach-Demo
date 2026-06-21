// ============================================================================
// THE FINDINGS REPORT  —  edit THIS file to match your own video.
// ----------------------------------------------------------------------------
// This is hand-written, NOT produced by any analysis. It stands in for what a
// real speech-analysis pipeline would eventually generate. The coach reads it
// to know which moments to talk about and where they happen in the video.
//
// To make the coaching feel real for YOUR footage:
//   1. Load your video in the app and note the timestamps (in seconds) of a few
//      moments worth coaching.
//   2. Edit `duration_seconds`, `session_focus`, and the `moments` below so the
//      timestamps + quotes line up with what actually happens in your clip.
// Only the `session_focus` text is shown on screen. The `moments` are private
// context for the coach.
// ============================================================================

export type MomentType = "filler" | "pace" | "phrasing";

export interface Moment {
  id: string;
  timestamp_seconds: number;
  type: MomentType;
  user_said: string;
  observation: string;
  /** Only present on phrasing moments — teaches a pattern, not a script. */
  reword_pattern?: string;
}

export interface FindingsReport {
  video_meta: {
    title: string;
    duration_seconds: number;
  };
  session_focus: {
    label: string;
    coach_framing: string;
  };
  moments: Moment[];
}

export const report: FindingsReport = {
  video_meta: {
    title: "Practice standup — Tuesday",
    duration_seconds: 142,
  },
  session_focus: {
    label: "Filler words and pace",
    coach_framing:
      "Today let's just look at the moments where 'um' creeps in and where you speed up under pressure. Nothing else — one thing at a time.",
  },
  moments: [
    {
      id: "m1",
      timestamp_seconds: 8,
      type: "filler",
      user_said: "Um, so basically the deploy went to the staging cluster.",
      observation:
        "Three fillers stack in the first sentence — 'um', 'so', 'basically'. They cluster right at the open, when nerves are highest.",
    },
    {
      id: "m2",
      timestamp_seconds: 41,
      type: "pace",
      user_said: "and-then-we-restarted-the-service-and-it-came-back-up",
      observation:
        "Pace jumps here — the words run together right after you got challenged. The important part gets rushed past.",
    },
    {
      id: "m3",
      timestamp_seconds: 73,
      type: "phrasing",
      user_said: "This is basically a thing that lets you roll back fast.",
      observation:
        "Vague framing — 'a thing that lets you'. There's a crisper way to say this.",
      reword_pattern:
        "Name the capability directly, lead with the verb: 'This rolls back a bad deploy in one command.' Pattern: cut 'a thing that' → state what it does.",
    },
  ],
};
