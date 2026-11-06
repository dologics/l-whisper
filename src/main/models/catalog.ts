// The Whisper models the app offers. None of them ship with the app — the user picks one
// and the app downloads it (see model-downloader.ts) into the models folder.
//
// Files come from the official whisper.cpp model repository on Hugging Face. Sizes and
// SHA-256 checksums are copied from that repository, so a damaged or tampered download is
// detected. All models are multilingual (English, Urdu, …) — the ".en" English-only
// variants are left out on purpose.
//
// Plain data, no Electron — used by the main process and the unit tests.

/** Where the files are downloaded from (+ file name). */
export const MODEL_BASE_URL = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/';

export interface ModelInfo {
  /** short id saved in settings.json ("activeModel") */
  id: string;
  /** name shown in the app */
  label: string;
  /** file name in the models folder (and on Hugging Face) */
  file: string;
  /** exact size in bytes */
  sizeBytes: number;
  /** SHA-256 of the file (lower-case hex) */
  sha256: string;
  /** one line about speed / quality */
  note: string;
}

export const MODEL_CATALOG: ModelInfo[] = [
  {
    id: 'tiny',
    label: 'Tiny',
    file: 'ggml-tiny.bin',
    sizeBytes: 77_691_713,
    sha256: 'be07e048e1e599ad46341c8d2a135645097a538221678b7acdd1b1919c6e1b21',
    note: 'Fastest, lowest quality — weak on accents and Urdu',
  },
  {
    id: 'base',
    label: 'Base',
    file: 'ggml-base.bin',
    sizeBytes: 147_951_465,
    sha256: '60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe',
    note: 'Very fast, basic quality',
  },
  {
    id: 'small',
    label: 'Small',
    file: 'ggml-small.bin',
    sizeBytes: 487_601_967,
    sha256: '1be3a9b2063867b937e64e2ec7483364a79917e157fa98c5d94b5c1fffea987b',
    note: 'Fast, good all-rounder',
  },
  {
    id: 'medium',
    label: 'Medium',
    file: 'ggml-medium.bin',
    sizeBytes: 1_533_763_059,
    sha256: '6c14d5adee5f86394037b4e4e8b59f1673b6cee10e3cf0b11bbdbee79c156208',
    note: 'Slow — Large v3 Turbo is better and faster',
  },
  {
    id: 'large-v3-turbo-q5_0',
    label: 'Large v3 Turbo (compact)',
    file: 'ggml-large-v3-turbo-q5_0.bin',
    sizeBytes: 574_041_195,
    sha256: '394221709cd5ad1f40c46e6031ca61bce88931e6e088c188294c6d5a55ffa7e2',
    note: 'Near-best quality at a third of the size',
  },
  {
    id: 'large-v3-turbo',
    label: 'Large v3 Turbo',
    file: 'ggml-large-v3-turbo.bin',
    sizeBytes: 1_624_555_275,
    sha256: '1fc70f774d38eb169993ac391eea357ef47c88757ef72ee5943879b7e8e2bc69',
    note: 'Best quality',
  },
];

/**
 * The model to suggest for this Mac: the compact Large v3 Turbo on Apple Silicon; Small on Intel
 * Macs (no GPU acceleration there — bigger models are very slow) and on Macs with little memory.
 */
export function recommendedModelId(totalMemoryBytes: number, arch: string = process.arch): string {
  if (arch !== 'arm64' || totalMemoryBytes < 8 * 1024 ** 3) return 'small';
  return 'large-v3-turbo-q5_0';
}
