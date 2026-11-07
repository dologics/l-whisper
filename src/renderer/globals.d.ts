// Types for the main window's script (declarations only, no code).

// The API from src/preload/preload.ts.
interface Window {
  whisperApp: import('../shared/types').WhisperAppApi;
}

// Shared shapes used by renderer.ts (from src/shared/types.ts).
type AppState = import('../shared/types').AppState;
type PermissionKind = import('../shared/types').PermissionKind;
type Progress = import('../shared/types').Progress;
type Segment = import('../shared/types').Segment;
type RecentFile = import('../shared/types').RecentFile;
type TranscribeResult = import('../shared/types').TranscribeResult;
type TranscriptInfo = import('../shared/types').TranscriptInfo;
type LibraryItemDetail = import('../shared/types').LibraryItemDetail;
type SavedFile = import('../shared/types').SavedFile;
type SavedFileInfo = import('../shared/types').SavedFileInfo;
type SavedFileKind = import('../shared/types').SavedFileKind;
type LibraryListItem = import('../shared/types').LibraryListItem;
type Hotkey = import('../shared/types').Hotkey;
type Modifier = import('../shared/types').Modifier;
type ModelEntry = import('../shared/types').ModelEntry;
type ModelProgress = import('../shared/types').ModelProgress;
type AiStatus = import('../shared/types').AiStatus;
