// Who said each word in a meeting (task 27, second version).
//
// A meeting's .m4a has a hidden "Speakers" track: left = your mic, right = the system audio
// (everyone else). Whisper transcribes the normal mix once (best words, full context) and, with
// DTW word timing, says WHEN each word was spoken. Here we look at both sides at that moment:
// the side that is talking owns the word. Then each whisper segment is split wherever the
// speaker changes — so one segment can't mix two people any more.
//
// Why not whisper's own --diarize: it gives ONE label per segment, and whisper's segments often
// hold several turns of both people (seen in a real call: 2 segments for 45 s of back-and-forth).
//
// Plain Node, no Electron — unit-tested in test/speakers.test.ts.
import path from 'node:path';
import type { Segment, Speaker } from '../shared/types';

/** Loudness is measured in 30 ms steps. */
const FRAME_SEC = 0.03;
/** Quieter than this (dBFS) is silence, whatever the side. */
const SILENCE_DB = -55;
/** A side counts as talking when it is within this many dB of its own normal speech level. */
const ACTIVE_BELOW_SPEECH_DB = 25;
/** Both sides start together (e.g. laptop-speaker echo): the louder one wins by at least this. */
const WINS_BY_DB = 6;
/** Both sides active but one was already talking: it keeps the turn unless the other is this much louder. */
const TAKES_OVER_DB = 20;
/** A pause shorter than this doesn't end someone's turn (seconds). */
const TURN_GAP_SEC = 0.3;

/** Who is talking in each 30 ms step. */
type FrameOwner = Speaker | 'both' | null;

export interface ChannelLevels {
  frameSec: number;
  owners: FrameOwner[];
}

/** One piece of whisper text (a token: a word or part of one) and when it was spoken (seconds). */
export interface TimedPiece {
  text: string;
  time: number;
}

/** A whisper segment with its pieces' times. */
export interface TimedSegment {
  start: number;
  end: number;
  text: string;
  words: TimedPiece[];
}

/**
 * Who is talking when, from the Speakers track as 16-bit stereo PCM (left = mic, right = system).
 * Each side is compared with its OWN usual speech level, so a quiet mic or a loud call both work,
 * and the faint echo of the other side on a laptop mic doesn't count as you.
 */
export function channelLevels(pcm: Int16Array, rate: number): ChannelLevels {
  const frame = Math.max(1, Math.round(rate * FRAME_SEC));
  const frames = Math.floor(pcm.length / 2 / frame);
  const db: Float64Array[] = [new Float64Array(frames), new Float64Array(frames)];
  for (let f = 0; f < frames; f++) {
    for (let side = 0; side < 2; side++) {
      let sum = 0;
      for (let i = 0; i < frame; i++) {
        const v = pcm[(f * frame + i) * 2 + side];
        sum += v * v;
      }
      const rms = Math.sqrt(sum / frame);
      db[side][f] = rms > 0 ? 20 * Math.log10(rms / 32768) : -120;
    }
  }
  // each side's normal speech level: the loud end (95th percentile) of its non-silent steps
  const speech = db.map((d) => {
    const loud = [...d].filter((v) => v > SILENCE_DB).sort((a, b) => a - b);
    return loud.length ? loud[Math.floor(loud.length * 0.95)] : 0;
  });
  const on = [0, 1].map((side) =>
    Array.from(
      { length: frames },
      (_, f) => db[side][f] > SILENCE_DB && db[side][f] - speech[side] > -ACTIVE_BELOW_SPEECH_DB
    )
  );
  // when each side's current turn began (short pauses don't count), to know who was talking first
  const gap = Math.round(TURN_GAP_SEC / FRAME_SEC);
  const since = [0, 1].map((side) => {
    const start = new Array<number>(frames).fill(-1);
    let runStart = -1;
    let lastOn = -Infinity;
    for (let f = 0; f < frames; f++) {
      if (on[side][f]) {
        if (f - lastOn > gap) runStart = f;
        lastOn = f;
        start[f] = runStart;
      }
    }
    return start;
  });
  const owners: FrameOwner[] = [];
  for (let f = 0; f < frames; f++) {
    if (!on[0][f] || !on[1][f]) {
      owners.push(on[0][f] ? 'mic' : on[1][f] ? 'system' : null);
      continue;
    }
    // both sides active at once
    const lead = db[0][f] - speech[0] - (db[1][f] - speech[1]); // > 0: mic louder (each vs its own level)
    const first = since[1][f] - since[0][f]; // > 0: mic's turn began first
    if (Math.abs(lead) >= TAKES_OVER_DB) owners.push(lead > 0 ? 'mic' : 'system');
    else if (Math.abs(first) * FRAME_SEC > 0.1)
      owners.push(first > 0 ? 'mic' : 'system'); // who was talking keeps it
    else if (Math.abs(lead) >= WINS_BY_DB)
      owners.push(lead > 0 ? 'mic' : 'system'); // started together: louder
    else owners.push('both');
  }
  return { frameSec: FRAME_SEC, owners };
}

/** Who owns most of the time between from and to (seconds), or undefined if nobody clearly. */
function ownerBetween(levels: ChannelLevels, from: number, to: number): Speaker | undefined {
  let mic = 0;
  let system = 0;
  const first = Math.max(0, Math.floor(from / levels.frameSec));
  const last = Math.min(levels.owners.length - 1, Math.ceil(to / levels.frameSec));
  for (let f = first; f <= last; f++) {
    const o = levels.owners[f];
    if (o === 'mic' || o === 'both') mic++;
    if (o === 'system' || o === 'both') system++;
  }
  if (mic === system) return undefined; // nobody, or both equally
  return mic > system ? 'mic' : 'system';
}

/** Whisper pieces → words: a new word starts at a piece beginning with a space. */
function toWords(pieces: TimedPiece[]): TimedPiece[] {
  const words: TimedPiece[] = [];
  for (const p of pieces) {
    const last = words[words.length - 1];
    if (last && !/^\s/.test(p.text))
      last.text += p.text; // "illa" after " D", or "."
    else words.push({ text: p.text, time: p.time });
  }
  return words;
}

/**
 * Give each word the side that was talking when it was said, then split segments where the
 * speaker changes. Words nobody clearly owns (both at once, or silence) go with the word before
 * them (or after, at the start). A segment with no clear words stays unlabelled.
 */
export function assignSpeakers(segments: TimedSegment[], levels: ChannelLevels): Segment[] {
  const out: Segment[] = [];
  for (const seg of segments) {
    const words = toWords(seg.words);
    // a word's moment: whisper's DTW time lands near the END of the word (measured on real calls),
    // so look from a bit before it to just after it
    const who: (Speaker | undefined)[] = words.map((w) => ownerBetween(levels, w.time - 0.45, w.time + 0.15));
    for (let i = 1; i < who.length; i++) who[i] ??= who[i - 1]; // unknown → the speaker before
    for (let i = who.length - 2; i >= 0; i--) who[i] ??= who[i + 1]; // leading unknowns → the one after

    const text = seg.text.trim();
    if (!words.length || who.every((s) => s === who[0])) {
      out.push({ start: seg.start, end: seg.end, text, ...(who[0] && { speaker: who[0] }) });
      continue;
    }
    // Split. Use the segment's own words when they match the pieces one to one (safest for
    // non-Latin text), else the pieces' text.
    const textWords = text.split(/\s+/);
    const wordText = (i: number) => (textWords.length === words.length ? textWords[i] : words[i].text.trim());
    const parts: { speaker: Speaker | undefined; first: number; texts: string[] }[] = [];
    words.forEach((_, i) => {
      const last = parts[parts.length - 1];
      if (last && last.speaker === who[i]) last.texts.push(wordText(i));
      else parts.push({ speaker: who[i], first: i, texts: [wordText(i)] });
    });
    let start = seg.start;
    parts.forEach((p, n) => {
      const next = parts[n + 1];
      const end = next ? Math.min(seg.end, Math.max(start, words[next.first].time - 0.2)) : seg.end;
      out.push({ start, end, text: p.texts.join(' '), ...(p.speaker && { speaker: p.speaker }) });
      start = end;
    });
  }
  return out;
}

/** whisper.cpp's DTW preset for a model file (word timing), or null if we don't know it. */
export function dtwPreset(modelPath: string): string | null {
  const name = path.basename(modelPath);
  if (/^ggml-large-v3-turbo/.test(name)) return 'large.v3.turbo';
  const large = name.match(/^ggml-large-(v[123])/);
  if (large) return `large.${large[1]}`;
  const m = name.match(/^ggml-(tiny|base|small|medium)(\.en)?[-.]/);
  return m ? m[1] + (m[2] ?? '') : null;
}
