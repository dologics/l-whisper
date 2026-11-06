// Transcript formats. A transcript is a list of segments: { start, end, text } (seconds).
//
//   txt   "[00:12] We agreed to launch on Monday."      (readable, one line per segment)
//   srt   SubRip captions: numbered blocks, 00:00:12,000 --> 00:00:15,500
//   vtt   WebVTT captions (web/video players): WEBVTT header, 00:00:12.000 --> 00:00:15.500
//   json  segments + details, so the app can reload a transcript with its timestamps
//
// Plain Node, no Electron — unit-tested in test/transcript-formats.test.ts.
import type { Segment } from '../shared/types';

export type FormatKind = 'txt' | 'srt' | 'vtt' | 'json';

/** Anything useful to keep in the json file (language, durationSec, source name…). */
export type TranscriptDetails = Record<string, unknown>;

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

export function toTxt(segments: Segment[]): string {
  return segments.map((s) => `[${shortClock(s.start)}] ${s.text}`).join('\n') + '\n';
}

export function toSrt(segments: Segment[]): string {
  return segments
    .map((s, i) => `${i + 1}\n${captionClock(s.start, ',')} --> ${captionClock(endOf(segments, i), ',')}\n${s.text}\n`)
    .join('\n');
}

export function toVtt(segments: Segment[]): string {
  return (
    'WEBVTT\n\n' +
    segments
      .map((s, i) => `${captionClock(s.start, '.')} --> ${captionClock(endOf(segments, i), '.')}\n${s.text}\n`)
      .join('\n')
  );
}

export function toJson(segments: Segment[], details: TranscriptDetails = {}): string {
  const clean = segments.map((s, i) => ({ start: s.start, end: endOf(segments, i), text: s.text }));
  return JSON.stringify({ ...details, segments: clean }, null, 2) + '\n';
}

const FORMATTERS: Record<FormatKind, (segments: Segment[], details?: TranscriptDetails) => string> = {
  txt: toTxt,
  srt: toSrt,
  vtt: toVtt,
  json: toJson,
};

export const FORMATS = Object.keys(FORMATTERS) as FormatKind[];

/** Format by file extension ('txt' | 'srt' | 'vtt' | 'json'). */
export function format(kind: string, segments: Segment[], details?: TranscriptDetails): string {
  const fn = FORMATTERS[kind as FormatKind];
  if (!fn) throw new Error(`Unknown transcript format: ${kind}`);
  return fn(segments, details);
}
