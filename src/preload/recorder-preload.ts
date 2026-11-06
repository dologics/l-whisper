// Bridge for the hidden recorder window: main says start/stop, the page sends back audio.
import { contextBridge, ipcRenderer } from 'electron';
import type { RecorderBridge, SoundName } from '../shared/types';

const bridge = {
  onStart: (fn: () => void) => void ipcRenderer.on('recorder:start', () => fn()),
  onStop: (fn: () => void) => void ipcRenderer.on('recorder:stop', () => fn()),
  onPlaySound: (fn: (name: SoundName) => void) =>
    void ipcRenderer.on('recorder:sound', (_e, name: SoundName) => fn(name)),
  started: () => ipcRenderer.send('recorder:started'),
  failed: (message: string) => ipcRenderer.send('recorder:failed', message),
  audio: (wav: ArrayBuffer) => ipcRenderer.send('recorder:audio', wav),
} satisfies RecorderBridge;

contextBridge.exposeInMainWorld('recorder', bridge);
