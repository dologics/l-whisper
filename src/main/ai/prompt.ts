// The instructions sent with a transcript when the user clicks Summarize.
// Kept in one place so they're easy to tune. Style agreed with the user (task 26):
// simple English, third person, concise, what matters + who needs to do what, bullets for lists.
import type { SpeakerLabels } from '../../shared/types';

export const SUMMARY_INSTRUCTIONS = `You are given a transcript of a recorded meeting or audio file. It may be in English, Urdu or a mix, and it may contain transcription mistakes. Write a summary in simple, plain English (even if the transcript is in another language).

Rules:
- Write in the third person ("They discussed…", "Ali needs to…").
- Be concise. Keep only what matters; skip small talk, greetings and repetition.
- Use these sections, in this order, and leave out a section if there is nothing for it:
  ## Summary — 2 to 5 sentences: what this was about and the outcome.
  ## Key points — bullet points of the important things discussed or decided.
  ## Action items — bullet points: who needs to do what (and by when, if it was said). Write "Someone needs to…" if the person isn't clear.
  ## Open questions — bullet points of things left undecided.
- Use "- " bullet points wherever there is a list. Use **bold** only for names or deadlines, sparingly.
- Do not invent anything that is not in the transcript. If the transcript is too short or unclear to summarize, say so in one sentence.
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
