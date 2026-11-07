// The user's name (task 28), typed in Settings → General or in first-run setup.
// Meeting transcripts use it to label the mic side ("Mohsin: Hello", task 27).
// Optional: an empty name means "no name" and a generic label is used instead.

/** Longest name we keep, in characters. */
export const USER_NAME_MAX = 40;

/**
 * Make a typed name safe to store and to use as a transcript label:
 * one line, no control characters, no ":" (it would confuse "Name: text" lines),
 * single spaces, trimmed, at most USER_NAME_MAX characters. Anything else → ''.
 */
export function cleanUserName(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw
    .replace(/\p{Cc}/gu, ' ') // control characters (new lines, tabs, invisible ones) → space
    .replace(/:/g, '') // ":" separates the label from the text in transcripts
    .replace(/\s+/g, ' ') // runs of spaces → one space
    .trim()
    .slice(0, USER_NAME_MAX)
    .trim(); // in case the cut left a space at the end
}
