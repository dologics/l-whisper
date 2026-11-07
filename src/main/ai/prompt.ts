// The instructions sent with a transcript when the user clicks Summarize.
// Kept in one place so they're easy to tune.
// Style (task 32, user-approved): like good meeting minutes — outcome first, decisions and
// owner-first action items as the core, a few short topic paragraphs, about one page, no nested
// bullets. Based on common practice (Zoom, Fellow, Circleback, Fireflies meeting-summary guides).
// (Task 26's first version used "Key points" bullets, which grew to 40+ nested bullets.)
import type { SpeakerLabels } from '../../shared/types';

export const SUMMARY_INSTRUCTIONS = `You are given a transcript of a recorded meeting or audio file. It may be in English, Urdu or a mix, and may contain transcription mistakes. Write a meeting summary in simple, plain English (even if the transcript is in another language).

Write it like good meeting minutes: short, outcome first, easy to scan. Someone who missed the meeting should understand in one minute what happened and what they need to do.

Use these sections, in this order. Leave out any section that would be empty:

## Overview
2–4 sentences of plain prose: what the meeting was about and the main outcome. No bullets.

## Decisions
What was agreed or decided. One bullet per decision, one line each.

## Action items
One bullet per task: "**Owner** — task (by when, if a date was said)". Use the person's name; if the owner is not clear, write "**Unassigned**". Only real commitments, not ideas.

## Discussion
The 2–5 most important topics, one short paragraph each, starting with the topic in bold: "**Topic:** 1–3 sentences." Only what matters for understanding the decisions — skip details, examples, small talk and repetition.

## Open questions
Things left undecided or to follow up. At most 5 bullets.

Rules:
- About one page: 150–400 words (up to 500 for a very long meeting). Shorter is better.
- Never nest bullets. Each bullet is one line. Don't repeat the same point in two sections.
- Write in the third person, past tense, neutral ("They agreed…", "Ali will…"). Use names when known.
- Use **bold** only for owner names in Action items and topic names in Discussion.
- Do not invent anything that is not in the transcript. If it is too short or unclear to summarize, say so in one sentence.
- Reply with the summary only (Markdown), no introduction or closing remarks.`;

/** For a meeting with speaker labels (task 27): who the names in the transcript are. */
export function speakersNote(labels: SpeakerLabels): string {
  return (
    `Each turn starts with the speaker's name. "${labels.mic}" is the person who recorded this meeting (their own microphone). ` +
    `"${labels.system}" is everyone else on the call, coming through the computer — it may be more than one person; ` +
    `if the transcript shows their names, use them.`
  );
}

/** The full text sent to the AI: instructions + the transcript (plain text, no timestamps). */
export function buildSummaryPrompt(transcript: string, title: string, labels?: SpeakerLabels): string {
  const note = labels ? `\n\n${speakersNote(labels)}` : '';
  return `${SUMMARY_INSTRUCTIONS}${note}\n\nTitle: ${title}\n\nTranscript:\n${transcript.trim()}\n`;
}
