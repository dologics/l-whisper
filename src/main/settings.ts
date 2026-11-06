// User settings, saved as JSON in the app's data folder
// (~/Library/Application Support/L - Whisper/settings.json).
import fs from 'node:fs';
import path from 'node:path';
import type { SettingsValues } from '../shared/types';

const DEFAULTS: SettingsValues = {
  language: 'auto', // 'auto' or a Whisper language code like 'en'
  sounds: true, // soft beeps when dictation starts / finishes
};

export class Settings {
  private readonly file: string;
  private readonly values: SettingsValues;

  constructor(dir: string) {
    this.file = path.join(dir, 'settings.json');
    this.values = { ...DEFAULTS };
    try {
      Object.assign(this.values, JSON.parse(fs.readFileSync(this.file, 'utf8')));
    } catch {
      // first run or unreadable file → defaults
    }
  }

  get<K extends keyof SettingsValues>(key: K): SettingsValues[K] {
    return this.values[key];
  }

  set<K extends keyof SettingsValues>(key: K, value: SettingsValues[K]): void {
    this.values[key] = value;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(this.values, null, 2));
  }
}
