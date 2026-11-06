// What's in the models folder, and which model is active.
//
//   models/ggml-small.bin        downloaded (size matches the catalogue)
//   models/ggml-tiny.bin.part    a download that was cancelled or cut off (can be resumed)
//
// The active model's id is kept in settings.json ("activeModel"). If that file is gone,
// there is no active model (the app then asks the user to choose one).
//
// Plain Node, no Electron — unit-tested in test/model-store.test.ts.
import fs from 'node:fs';
import path from 'node:path';
import { MODEL_CATALOG, type ModelInfo } from './catalog';

/** Preference order when picking an already-downloaded model automatically (migration). */
const MIGRATION_ORDER = ['large-v3-turbo', 'large-v3-turbo-q5_0', 'medium', 'small', 'base', 'tiny'];

export interface ModelStatus extends ModelInfo {
  /** the complete file is in the folder */
  downloaded: boolean;
  /** bytes already on disk (whole file, or the .part of an unfinished download) */
  bytesOnDisk: number;
  active: boolean;
}

export interface ModelStoreOptions {
  /** the models folder */
  dir: string;
  /** read the saved active model id */
  getActive: () => string | undefined;
  /** save the active model id (undefined = none) */
  saveActive: (id: string | undefined) => void;
  catalog?: ModelInfo[];
  log?: (line: string) => void;
}

export class ModelStore {
  readonly dir: string;
  readonly catalog: ModelInfo[];
  private readonly getActive: () => string | undefined;
  private readonly saveActive: (id: string | undefined) => void;
  private readonly log: (line: string) => void;

  constructor({ dir, getActive, saveActive, catalog = MODEL_CATALOG, log = () => {} }: ModelStoreOptions) {
    this.dir = dir;
    this.getActive = getActive;
    this.saveActive = saveActive;
    this.catalog = catalog;
    this.log = log;
  }

  /** Catalogue entry for an id (throws for unknown ids — they come from the window). */
  info(id: string): ModelInfo {
    const model = this.catalog.find((m) => m.id === id);
    if (!model) throw new Error(`Unknown model: ${id}`);
    return model;
  }

  pathOf(id: string): string {
    return path.join(this.dir, this.info(id).file);
  }

  /** The complete file is there (same size as in the catalogue). */
  isDownloaded(id: string): boolean {
    return fileSize(this.pathOf(id)) === this.info(id).sizeBytes;
  }

  /** The active model's id, or null if none is chosen / its file is missing. */
  activeId(): string | null {
    const id = this.getActive();
    if (!id || !this.catalog.some((m) => m.id === id)) return null;
    return this.isDownloaded(id) ? id : null;
  }

  /** Path of the active model's file, or null. */
  activePath(): string | null {
    const id = this.activeId();
    return id ? this.pathOf(id) : null;
  }

  /** Every catalogue model with its state on disk. */
  list(): ModelStatus[] {
    const active = this.activeId();
    return this.catalog.map((m) => {
      const file = path.join(this.dir, m.file);
      const downloaded = fileSize(file) === m.sizeBytes;
      return {
        ...m,
        downloaded,
        bytesOnDisk: downloaded ? m.sizeBytes : fileSize(`${file}.part`),
        active: m.id === active,
      };
    });
  }

  /** Make a downloaded model the active one. */
  setActive(id: string): void {
    if (!this.isDownloaded(id)) throw new Error(`${this.info(id).label} isn't downloaded yet.`);
    this.saveActive(id);
    this.log(`active model → ${id}`);
  }

  /** Delete a downloaded model (and any unfinished download of it). Not the active one. */
  delete(id: string): void {
    if (this.activeId() === id) throw new Error("This model is in use. Choose another model first, then delete it.");
    const file = this.pathOf(id);
    fs.rmSync(file, { force: true });
    fs.rmSync(`${file}.part`, { force: true });
    this.log(`deleted ${this.info(id).file}`);
  }

  /**
   * First start of a version with the model manager: no active model saved yet, but a model
   * file is already in the folder (e.g. large-v3-turbo installed by hand) → make it active,
   * so the app keeps working without asking.
   */
  migrate(): void {
    if (this.getActive()) return;
    const found = MIGRATION_ORDER.find((id) => this.catalog.some((m) => m.id === id) && this.isDownloaded(id));
    if (found) {
      this.saveActive(found);
      this.log(`found ${found} in the models folder — made it the active model`);
    }
  }
}

/** Size of a file in bytes, or 0 if it doesn't exist. */
function fileSize(file: string): number {
  try {
    return fs.statSync(file).size;
  } catch {
    return 0;
  }
}
