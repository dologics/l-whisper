// Transcript formats. A transcript is a list of segments: { start, end, text } (seconds).
//
//   txt   "[00:12] We agreed to launch on Monday."      (readable, one line per segment)
//   srt   SubRip captions: numbered blocks, 00:00:12,000 --> 00:00:15,500
//   vtt   WebVTT captions (web/video players): WEBVTT header, 00:00:12.000 --> 00:00:15.500
//   json  segments + details, so the app can reload a transcript with its timestamps
//
// Meetings (task 27): the .txt has NO timestamps (the other files have them). When segments
// know who spoke (`speaker`: 'mic' | 'system'), lines are labelled with names:
//   txt   "Mohsin: Hi everyone." / "Speaker 2: Yes, loud and clear."  (one paragraph per turn)
//   srt   "Mohsin: Hi everyone."      vtt  "<v Mohsin>Hi everyone."   json  speaker: 'mic'
// The json keeps the raw 'mic'/'system', so the names can be changed later.
//
// Plain Node, no Electron — unit-tested in test/transcript-formats.test.ts.
import type { Segment, SpeakerLabels } from '../shared/types';

export type FormatKind = 'txt' | 'srt' | 'vtt' | 'json';

/** Anything useful to keep in the json file (language, durationSec, source name…). */
export type TranscriptDetails = Record<string, unknown>;

/** How to write the text. Defaults: timestamps in .txt, generic speaker names. */
export interface FormatOptions {
  /** .txt only: "[mm:ss]" before each line (default true; meetings use false) */
  timestamps?: boolean;
  /** names for segments with a `speaker` */
  labels?: SpeakerLabels;
}

/** Your name for the mic side (or "Speaker 1" if you didn't give one), "Speaker 2" for the other side. */
export function speakerLabels(userName: string): SpeakerLabels {
  return { mic: userName.trim() || 'Speaker 1', system: 'Speaker 2' };
}
const DEFAULT_LABELS = speakerLabels('');

/** The name for a segment, or '' when nobody is known. */
function labelOf(s: Segment, labels: SpeakerLabels): string {
  return s.speaker ? labels[s.speaker] : '';
}

/** Segment end: given, else the next segment's start, else start + 3 s. */
function endOf(segments: Segment[], i: number): number {
  const s = segments[i];
  if (typeof s.end === 'number' && s.end > s.start) return s.end;
  const next = segments[i + 1];
  return next ? next.start : s.start + 3;
}

/** 12 → "00:12", 3725 → "1:02:05" (short clock for txt). */
function shortClock(sec: number): string {
  sec = Math.max(0, Math.floor(sec));
  const h = Math.floor(sec / 3600);
  const m = String(Math.floor((sec % 3600) / 60)).padStart(2, '0');
  const s = String(sec % 60).padStart(2, '0');
  return h ? `${h}:${m}:${s}` : `${m}:${s}`;
}

/** 12.5 → "00:00:12" + sep + "500" (caption clock: srt uses ",", vtt uses "."). */
function captionClock(sec: number, sep: ',' | '.'): string {
  const ms = Math.max(0, Math.round(sec * 1000));
  const h = String(Math.floor(ms / 3600000)).padStart(2, '0');
  const m = String(Math.floor((ms % 3600000) / 60000)).padStart(2, '0');
  const s = String(Math.floor((ms % 60000) / 1000)).padStart(2, '0');
  return `${h}:${m}:${s}${sep}${String(ms % 1000).padStart(3, '0')}`;
}

export function toTxt(segments: Segment[], { timestamps = true, labels = DEFAULT_LABELS }: FormatOptions = {}): string {
  const withSpeakers = segments.some((s) => s.speaker);
  // timestamps: one line per segment, "[00:12] Name: text" (no name when unknown)
  if (timestamps) {
    return (
      segments
        .map((s) => {
          const name = labelOf(s, labels);
          return `[${shortClock(s.start)}] ${name ? `${name}: ` : ''}${s.text}`;
        })
        .join('\n') + '\n'
    );
  }
  // no timestamps, no speakers (e.g. an older meeting): plain lines
  if (!withSpeakers) return segments.map((s) => s.text).join('\n') + '\n';
  // no timestamps, speakers: one paragraph per turn, like a conversation. A segment with an
  // unknown speaker (both talking at once) stays with the turn before it.
  const turns: { name: string; texts: string[] }[] = [];
  let current: Segment['speaker'];
  for (const s of segments) {
    const speaker = s.speaker ?? current;
    const last = turns[turns.length - 1];
    if (last && speaker === current) last.texts.push(s.text);
    else turns.push({ name: speaker ? labels[speaker] : '', texts: [s.text] });
    current = speaker;
  }
  return turns.map((t) => (t.name ? `${t.name}: ` : '') + t.texts.join(' ')).join('\n\n') + '\n';
}

export function toSrt(
  segments: Segment[],
  _details?: TranscriptDetails,
  { labels = DEFAULT_LABELS }: FormatOptions = {}
): string {
  return segments
    .map((s, i) => {
      const name = labelOf(s, labels);
      const text = name ? `${name}: ${s.text}` : s.text;
      return `${i + 1}\n${captionClock(s.start, ',')} --> ${captionClock(endOf(segments, i), ',')}\n${text}\n`;
    })
    .join('\n');
}

export function toVtt(
  segments: Segment[],
  _details?: TranscriptDetails,
  { labels = DEFAULT_LABELS }: FormatOptions = {}
): string {
  return (
    'WEBVTT\n\n' +
    segments
      .map((s, i) => {
        // WebVTT voice tag; a name can't contain < > & (they would break the tag)
        const name = labelOf(s, labels).replace(/[<>&]/g, '');
        const text = name ? `<v ${name}>${s.text}` : s.text;
        return `${captionClock(s.start, '.')} --> ${captionClock(endOf(segments, i), '.')}\n${text}\n`;
      })
      .join('\n')
  );
}

export function toJson(segments: Segment[], details: TranscriptDetails = {}): string {
  const clean = segments.map((s, i) => ({
    start: s.start,
    end: endOf(segments, i),
    text: s.text,
    ...(s.speaker && { speaker: s.speaker }), // raw 'mic' / 'system', names are added when written
  }));
  return JSON.stringify({ ...details, segments: clean }, null, 2) + '\n';
}

const FORMATTERS: Record<
  FormatKind,
  (segments: Segment[], details?: TranscriptDetails, opts?: FormatOptions) => string
> = {
  txt: (segments, _details, opts) => toTxt(segments, opts),
  srt: toSrt,
  vtt: toVtt,
  json: toJson,
};

export const FORMATS = Object.keys(FORMATTERS) as FormatKind[];

/** Format by file extension ('txt' | 'srt' | 'vtt' | 'json'). */
export function format(kind: string, segments: Segment[], details?: TranscriptDetails, opts?: FormatOptions): string {
  const fn = FORMATTERS[kind as FormatKind];
  if (!fn) throw new Error(`Unknown transcript format: ${kind}`);
  return fn(segments, details, opts);
}
