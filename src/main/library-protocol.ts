// library://audio/<item id> — lets the window's audio player read a Library item's audio
// (and nothing else), with byte-range support so seeking works.
//   meeting → its own .m4a in the item folder
//   file    → the original file, only the exact path saved in that item's item.json
import { protocol } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import type { Library } from './library';
import { errorMessage } from './util';

/** Content types the player understands (anything else is still sent; the player may refuse it). */
const TYPES: Record<string, string> = {
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  flac: 'audio/flac',
  ogg: 'audio/ogg',
  opus: 'audio/ogg',
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
};

/** Must run before the app is ready. */
export function declareLibraryScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: 'library', privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true } },
  ]);
}

/** A file (or part of it) as a web stream for a Response body. */
function streamOf(file: string, range?: { start: number; end: number }): ReadableStream {
  return Readable.toWeb(fs.createReadStream(file, range)) as WebReadableStream as ReadableStream;
}

/** Serve library://audio/<id> (after the app is ready). */
export function registerLibraryProtocol(library: Library): void {
  protocol.handle('library', async (request) => {
    try {
      const id = decodeURIComponent(new URL(request.url).pathname.slice(1));
      const file = library.audioPath(id); // refuses ids outside the library; a file item → only its original
      const size = fs.statSync(file).size;
      const type = TYPES[path.extname(file).slice(1).toLowerCase()] ?? 'application/octet-stream';
      const headers = { 'Content-Type': type, 'Accept-Ranges': 'bytes' };
      const range = /bytes=(\d*)-(\d*)/.exec(request.headers.get('range') || '');
      if (!range) {
        return new Response(streamOf(file), {
          status: 200,
          headers: { ...headers, 'Content-Length': String(size) },
        });
      }
      let start = range[1] ? Number(range[1]) : size - Number(range[2]);
      let end = range[1] && range[2] ? Number(range[2]) : size - 1;
      start = Math.max(0, start);
      end = Math.min(end, size - 1);
      return new Response(streamOf(file, { start, end }), {
        status: 206,
        headers: {
          ...headers,
          'Content-Range': `bytes ${start}-${end}/${size}`,
          'Content-Length': String(end - start + 1),
        },
      });
    } catch (err) {
      return new Response(errorMessage(err), { status: 404 });
    }
  });
}
