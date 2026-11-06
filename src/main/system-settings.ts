// Opens System Settings at the right place (Privacy panes, Keyboard).
import { shell } from 'electron';
import type { PermissionKind } from '../shared/types';

/** System Settings → Privacy & Security panes, per permission. */
const PRIVACY_PANES: Record<PermissionKind, string> = {
  microphone: 'Privacy_Microphone',
  inputMonitoring: 'Privacy_ListenEvent',
  accessibility: 'Privacy_Accessibility',
};

export function openSystemSettings(kind: PermissionKind | 'keyboard'): Promise<void> {
  if (kind === 'keyboard') return shell.openExternal('x-apple.systempreferences:com.apple.Keyboard-Settings.extension');
  const pane = PRIVACY_PANES[kind];
  return pane
    ? shell.openExternal(`x-apple.systempreferences:com.apple.preference.security?${pane}`)
    : Promise.resolve();
}
