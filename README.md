# Communication Coach — Thin Prototype

A private speaking-practice page. You load a video of yourself talking, then have a
spoken back-and-forth with an AI coach that has "watched" it. The coach can jump your
video to specific moments while you talk. No one but the AI ever sees your footage.

This is a deliberately tiny prototype. It does **not** analyze your speech — the coaching
notes are hand-written (see "Edit the report" below). It exists to test one thing: whether
talking to a voice coach that drives your own footage feels like real coaching.

---

## 1. Add your OpenAI key

1. Make a copy of `.env.local.example` and name the copy `.env.local`.
2. Open `.env.local` and paste your key after `OPENAI_API_KEY=`, like:

   ```
   OPENAI_API_KEY=sk-...your-key...
   ```

Your key stays on the server and is never sent to the browser. The `.env.local` file is
git-ignored, so it won't be committed.

> Your OpenAI account needs access to the Realtime API and the `gpt-realtime-2` model.
> If that model isn't available to you, add a line to `.env.local`:
> `REALTIME_MODEL=gpt-realtime` (or whichever realtime model you have).

## 2. Install and run

```bash
npm install
npm run dev
```

Open <http://localhost:3000>. Click **Talk to coach** and allow microphone access when asked.
Use headphones to avoid echo.

## 3. Swap in a different video

Just click the file picker on the page and choose any local video file. Nothing is uploaded —
the video plays straight from your computer.

> For the coaching to feel real, the moments the coach talks about must line up with what's
> actually in your video. The shipped notes match a fictional "practice standup," so with a
> different video the timestamps won't match until you edit the report (next step).

## 4. Edit the coaching notes (the "report")

All the moments the coach talks about live in **one file**: [`lib/report.ts`](lib/report.ts).

Open it and change:

- `session_focus` — the one thing this session is about (this text is shown on the page).
- `moments` — each entry has a `timestamp_seconds`, what you `user_said` there, and the
  coach's `observation`. Make these match real moments in your own video.

Save the file; the running app picks up the change automatically (refresh the page, then
start a new session).

---

## How it works (one-paragraph tour)

- The page (`app/page.tsx`) is the whole UI plus the voice connection (WebRTC).
- `app/api/realtime-token/route.ts` runs on the server, holds your real key, and hands the
  browser a short-lived token.
- The coach is briefed with the report (`lib/coachInstructions.ts`) and given one tool,
  `seek_video`, which the browser handles by jumping + pausing the `<video>` element.

Built with Next.js (App Router), TypeScript, and Tailwind CSS.
