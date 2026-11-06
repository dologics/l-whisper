// Renderer: the window's page. It has no Node.js access — only window.whisperApp (preload).
//
// A plain browser script (no imports), compiled by src/renderer/tsconfig.json. Its functions
// stay global on purpose: scripts/ui-check.ts calls them (showPage, startFile, openItem…).
const api = window.whisperApp;
let currentAppLanguage = 'auto'; // app-wide language (default for a Library item's transcription)

/** The element matching `sel` (throws if it's missing — that's a bug in index.html). */
function $<T extends Element = HTMLElement>(sel: string, el: ParentNode = document): T {
  const found = el.querySelector<T>(sel);
  if (!found) throw new Error(`Element not found: ${sel}`);
  return found;
}
/** All elements matching `sel`, as an array. */
function $$<T extends Element = HTMLElement>(sel: string, el: ParentNode = document): T[] {
  return [...el.querySelectorAll<T>(sel)];
}

// ================= sidebar navigation =================
function showPage(name: string): void {
  $$('.nav a').forEach((a) => a.classList.toggle('on', a.dataset.page === name));
  $$('.page').forEach((p) => p.classList.toggle('on', p.dataset.page === name));
  if (name === 'library') void showLibraryList();
  else audio.pause(); // don't keep playing on another page
}
$$('.nav a').forEach((a) => a.addEventListener('click', () => showPage(a.dataset.page ?? '')));

// ================= Transcribe File =================
let lastResult: TranscribeResult | null = null; // used by Copy/Save
let lastName = ''; // file name of the transcript on screen (for the Save suggestion)

function setState(name: string): void {
  $$('.state').forEach((s) => s.classList.toggle('on', s.dataset.state === name));
  $('#newBtn').hidden = name !== 'done';
}

function showError(message: string): void {
  setState('empty');
  $('#fileError').textContent = message;
  $('#fileError').hidden = false;
}

async function startFile(filePath: string): Promise<void> {
  $('#fileError').hidden = true;
  const info = await api.fileInfo(filePath);
  if (!info.ok) return showError(info.error);

  bindFile(info);
  $$('[data-bind="meta"]').forEach(
    (el) => (el.textContent = `${formatClock(info.durationSec)} · ${formatSize(info.size)}`)
  );
  updateProgress({ percent: 0, etaSec: 0 });
  setState('working');

  const result = await api.transcribeFile(filePath);
  if (!result.ok) {
    if (result.cancelled) return setState('empty');
    return showError(`Couldn't transcribe “${info.name}”: ${result.error}`);
  }

  lastResult = result;
  lastName = info.name;
  renderTranscript(result);
  showLibraryNote(result.libraryId);
  setState('done');
}

let lastLibraryId: string | null = null; // Library item made from the file on screen
/** "✓ Saved to Library — Open" under a fresh transcript (hidden if saving failed / an old Recent item). */
function showLibraryNote(id: string | null): void {
  lastLibraryId = id;
  $('#libraryNote').hidden = id === null;
}
$('#openLibraryItem').addEventListener('click', () => {
  if (lastLibraryId === null) return;
  showPage('library');
  void openItem(lastLibraryId);
});

// Copy / Save include timestamps; Save lets you pick txt, srt or vtt.
$('#copyBtn').addEventListener('click', async () => {
  if (!lastResult) return;
  await api.copyTranscript(lastResult.segments);
  flash($('#copyBtn'), 'Copied');
});

$('#saveBtn').addEventListener('click', async () => {
  if (!lastResult) return;
  const res = await api.saveTranscript(lastResult.segments, lastName);
  if (res.ok) {
    flash($('#saveBtn'), 'Saved');
    showSaved(res.path);
  } else if (!res.cancelled) showSaveError(res.error ?? 'unknown error');
});

let savedPath: string | null = null;
/** Lasting "✓ Saved to …  Show in Finder" note under the transcript. */
function showSaved(filePath: string): void {
  savedPath = filePath;
  const parts = filePath.split('/');
  $('#savedPath').textContent = parts.slice(-2).join('/'); // e.g. "Documents/name.txt"
  $('#savedPath').title = filePath;
  $('#savedNote').hidden = false;
}
$('#revealBtn').addEventListener('click', () => savedPath && api.revealFile(savedPath));

function showSaveError(message: string): void {
  $('#doneMeta').textContent = `Couldn't save: ${message}`;
}

function bindFile({ ext, name }: { ext: string; name: string }): void {
  $$('[data-bind="ext"]').forEach((el) => (el.textContent = ext));
  $$('[data-bind="name"]').forEach((el) => (el.textContent = name));
}

/** Show a finished transcript again (from the Recent list). */
function openRecent(item: RecentFile): void {
  $('#fileError').hidden = true;
  bindFile(item);
  lastResult = item;
  lastName = item.name;
  renderTranscript(item);
  showLibraryNote(null);
  setState('done');
}

function renderRecent(items: RecentFile[]): void {
  $('#recent').hidden = items.length === 0;
  $('#recentList').replaceChildren(
    ...items.map((item) => {
      const row = document.createElement('div');
      row.className = 'row';
      row.innerHTML =
        '<div class="ft"></div><div><div class="name"></div><div class="meta"></div></div><div class="when"></div>';
      $('.ft', row).textContent = item.ext;
      $('.name', row).textContent = item.name;
      $('.meta', row).textContent =
        `${formatClock(item.durationSec)} · ${item.language === 'auto' ? 'Auto' : item.language.toUpperCase()}`;
      $('.when', row).textContent = new Date(item.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      row.addEventListener('click', () => openRecent(item));
      return row;
    })
  );
}

function updateProgress({ percent, etaSec }: Progress): void {
  $('#progressBar').style.width = `${percent}%`;
  $('#progressText').textContent = percent > 0 ? `Transcribing… ${percent}%` : 'Preparing…';
  $('#etaText').textContent = etaSec > 0 ? `about ${formatDuration(etaSec)} left` : '';
}
api.onProgress(updateProgress);

function renderTranscript({ segments, durationSec, elapsedMs }: TranscribeResult): void {
  $('#doneMeta').textContent =
    `${formatClock(durationSec)} · transcribed in ${formatDuration(Math.round(elapsedMs / 1000))}`;
  $('#savedNote').hidden = true; // a different transcript → old "Saved" note no longer applies
  const box = $('#transcript');
  box.replaceChildren(
    ...segments.map(({ start, text }) => {
      const p = document.createElement('p');
      const ts = document.createElement('span');
      ts.className = 'ts';
      ts.textContent = formatClock(start);
      p.append(ts, text); // text node — never inserted as HTML
      return p;
    })
  );
  box.scrollTop = 0;
}

$('#chooseBtn').addEventListener('click', async () => {
  const filePath = await api.pickFile();
  if (filePath) void startFile(filePath);
});
$('#cancelBtn').addEventListener('click', () => api.cancelTranscription());
$('#newBtn').addEventListener('click', () => {
  lastResult = null;
  setState('empty');
});

// drag and drop
const drop = $('#dropZone');
// Stop the window from navigating to a file dropped anywhere else.
['dragover', 'drop'].forEach((t) => document.addEventListener(t, (e) => e.preventDefault()));
drop.addEventListener('dragenter', () => drop.classList.add('over'));
drop.addEventListener('dragover', (e) => {
  e.preventDefault();
  drop.classList.add('over');
});
drop.addEventListener('dragleave', (e) => {
  if (!drop.contains(e.relatedTarget as Node | null)) drop.classList.remove('over');
});
drop.addEventListener('drop', (e) => {
  e.preventDefault();
  drop.classList.remove('over');
  const file = e.dataTransfer?.files[0];
  if (file) void startFile(api.getPathForFile(file));
});

// ================= app state: sidebar footer, Dictation, Settings =================
function render(state: AppState): void {
  currentAppLanguage = state.language;
  // sidebar footer
  const lang = state.languages.find((l) => l.code === state.language);
  const langName = state.language === 'auto' ? 'Auto' : lang ? lang.label.replace(/\s*\(.*\)/, '') : state.language;
  const dot = $('#statusDot');
  dot.className = `status-dot ${state.engine.state}`;
  const footer: Record<AppState['engine']['state'], string> = {
    ready: `Whisper ready · ${langName}`,
    error: 'Whisper error — see Settings',
    loading: 'Loading model…',
    'no-model': 'No model — see Settings',
  };
  $('#statusText').textContent = footer[state.engine.state];
  dot.title = state.engine.error || '';

  renderRecent(state.recentFiles);
  renderAiProvider(state.aiProvider);

  // Dictation page
  const list = $('#dictationList');
  list.replaceChildren(
    ...state.dictations.map(({ time, text }) => {
      const row = document.createElement('div');
      row.className = 'row';
      const ts = document.createElement('span');
      ts.className = 'ts';
      ts.textContent = new Date(time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const t = document.createElement('span');
      t.className = 'text';
      t.textContent = text;
      t.title = text;
      const btn = document.createElement('button');
      btn.className = 'btn';
      btn.textContent = 'Copy';
      btn.addEventListener('click', async () => {
        await api.copyText(text);
        flash(btn, 'Copied');
      });
      row.append(ts, t, btn);
      return row;
    })
  );
  $('#dictationEmpty').hidden = state.dictations.length > 0;

  // Settings page
  const select = $<HTMLSelectElement>('#languageSelect');
  if (select.options.length !== state.languages.length) {
    select.replaceChildren(...state.languages.map(({ code, label }) => new Option(label, code)));
  }
  select.value = state.language;
  $('#modelName').textContent = state.model ?? 'None';
  $$('.hotkey-label').forEach((el) => (el.textContent = state.hotkeyLabel));
  renderHotkey(state);
  renderSetup(state);
  $('#aboutVersion').textContent = `version ${state.about.version}`;
  $('#aboutCompany').textContent = state.about.company;
  $('#aboutLicense').textContent = state.about.license;
  $('#aboutRepo').textContent = state.about.repoUrl;
  $('#aboutBuiltBy').textContent = state.about.builtBy;
  renderModels(state.models, state.download);
  $('#loginRow').hidden = !state.isPackaged; // only meaningful for the installed app
  $<HTMLInputElement>('#loginToggle').checked = state.openAtLogin;
  $<HTMLInputElement>('#soundsToggle').checked = state.sounds;
  $$('[data-perm]').forEach((row) => {
    const kind = row.dataset.perm as PermissionKind;
    const allowed = state.permissions[kind];
    const cell = $('.perm', row);
    if (allowed === null || allowed === undefined) {
      cell.innerHTML = '<span class="muted">Checking…</span>';
    } else if (allowed) {
      cell.innerHTML = '<span class="ok">✓ Allowed</span>';
    } else {
      cell.innerHTML = '<span class="no">Not allowed</span>';
      const open = document.createElement('button');
      open.className = 'btn';
      open.textContent = 'Open Settings';
      open.addEventListener('click', () => api.openPrivacySettings(kind));
      cell.append(open);
    }
  });
}

$<HTMLSelectElement>('#languageSelect').addEventListener('change', (e) =>
  api.setLanguage((e.target as HTMLSelectElement).value)
);
$<HTMLInputElement>('#loginToggle').addEventListener('change', (e) =>
  api.setOpenAtLogin((e.target as HTMLInputElement).checked)
);
$<HTMLInputElement>('#soundsToggle').addEventListener('change', (e) =>
  api.setSounds((e.target as HTMLInputElement).checked)
);
api.onState(render);
void api.getState().then(render);
api.onShowPage(showPage); // e.g. main opens Settings when you dictate without a model

// ================= first-run setup =================
// One overlay with 5 pages. The Dictation key and Whisper models cards from Settings are moved
// into it while it's open (same controls, same code) and put back afterwards.
const SETUP_LAST = 4; // pages 0 (welcome) … 4 (done)
const hotkeyHome = document.createComment('hotkey card lives here');
const modelsHome = document.createComment('models card lives here');
$('#hotkeyCard').before(hotkeyHome);
$('#modelsCard').before(modelsHome);
let setupShown = -1; // page on screen (-1 = setup closed)
let permissionPoll: ReturnType<typeof setInterval> | undefined;

function renderSetup(state: AppState): void {
  if (!state.setup.needed) {
    if (setupShown !== -1) closeSetup();
    return;
  }
  $('#setup').hidden = false;
  const step = Math.min(Math.max(state.setup.step, 0), SETUP_LAST);
  if (step !== setupShown) showSetupStep(step);

  // live parts of the pages
  $$('[data-setup-perm]').forEach((row) => {
    const kind = row.dataset.setupPerm as PermissionKind;
    const allowed = state.permissions[kind];
    const cell = $('.perm', row);
    if (allowed) {
      cell.innerHTML = '<span class="ok">✓ Allowed</span>';
    } else {
      cell.replaceChildren(button('Allow', () => void api.setup.grant(kind), true));
    }
  });
  $<HTMLButtonElement>('#setupNext').disabled = step === 3 && !state.model; // a model is needed
  $('#setupLoginRow').hidden = !state.isPackaged;
  $<HTMLInputElement>('#setupLogin').checked = state.openAtLogin;
}

function showSetupStep(step: number): void {
  setupShown = step;
  $$('.setup-step').forEach((s) => (s.hidden = Number(s.dataset.step) !== step));
  if (step === 2) $('#setupKeySlot').append($('#hotkeyCard'));
  if (step === 3) $('#setupModelSlot').append($('#modelsCard'));
  $('#setupBack').hidden = step === 0;
  $('#setupNext').textContent = step === 0 ? 'Get started' : step === SETUP_LAST ? 'Finish' : 'Next';
  $('#setupProgress').textContent = step === 0 ? '' : `Step ${Math.min(step, SETUP_LAST - 1)} of ${SETUP_LAST - 1}`;
  if (step === SETUP_LAST) $('#setupProgress').textContent = 'Done';

  // Permissions page: re-check every second, so ✓ appears right after you allow it.
  clearInterval(permissionPoll);
  if (step === 1) permissionPoll = setInterval(() => void api.setup.refreshPermissions(), 1000);
  if (step === SETUP_LAST) $('#tryIt').focus();
}

function closeSetup(): void {
  setupShown = -1;
  clearInterval(permissionPoll);
  $('#setup').hidden = true;
  hotkeyHome.after($('#hotkeyCard')); // cards back into Settings
  modelsHome.after($('#modelsCard'));
}

$('#setupNext').addEventListener('click', () => {
  if (setupShown >= SETUP_LAST) void api.setup.finish();
  else void api.setup.goTo(setupShown + 1);
});
$('#setupBack').addEventListener('click', () => void api.setup.goTo(Math.max(0, setupShown - 1)));
$('#setupLogin').addEventListener('change', (e) => api.setOpenAtLogin((e.target as HTMLInputElement).checked));
$('#runSetup').addEventListener('click', () => void api.setup.restart());

// ================= Settings → Dictation key =================
const COMBO_KEYS: [Modifier, string][] = [
  ['control', '⌃ Control'],
  ['option', '⌥ Option'],
  ['shift', '⇧ Shift'],
  ['command', '⌘ Command'],
];
for (const id of ['#hotkeyA', '#hotkeyB']) {
  $<HTMLSelectElement>(id).replaceChildren(...COMBO_KEYS.map(([key, label]) => new Option(label, key)));
}

/** Show the saved key in the controls (+ the 🌐 hint / shortcut note). */
function renderHotkey(state: AppState): void {
  const combo = state.hotkey.kind === 'combo';
  $<HTMLSelectElement>('#hotkeyKind').value = state.hotkey.kind;
  ['#hotkeyA', '#hotkeyPlus', '#hotkeyB'].forEach((s) => ($(s).hidden = !combo));
  if (state.hotkey.kind === 'combo') {
    $<HTMLSelectElement>('#hotkeyA').value = state.hotkey.keys[0];
    $<HTMLSelectElement>('#hotkeyB').value = state.hotkey.keys[1];
  }
  $('#fnConflict').hidden = !state.fnKeyConflict;
  const keys: Modifier[] = state.hotkey.kind === 'combo' ? state.hotkey.keys : [];
  const note = $('#hotkeyNote');
  note.hidden = !(keys.includes('command') && keys.includes('shift'));
  note.textContent = '⌘⇧ also starts screenshots (⌘⇧3 / 4 / 5). Those keep working — they just cancel the dictation.';
}

/** Save the key from the controls. */
async function saveHotkey(): Promise<void> {
  const kind = $<HTMLSelectElement>('#hotkeyKind').value;
  const a = $<HTMLSelectElement>('#hotkeyA').value as Modifier;
  const b = $<HTMLSelectElement>('#hotkeyB').value as Modifier;
  const error = $('#hotkeyError');
  if (kind === 'combo' && a === b) {
    error.textContent = 'Choose two different keys.';
    error.hidden = false;
    return;
  }
  error.hidden = true;
  const hotkey: Hotkey = kind === 'combo' ? { kind: 'combo', keys: [a, b] } : { kind: 'fn' };
  const res = await api.setHotkey(hotkey);
  if (!res.ok) {
    error.textContent = res.error ?? '';
    error.hidden = false;
  }
}
$('#hotkeyKind').addEventListener('change', () => {
  // switching to "Two keys": start with ⌃ Control + ⌥ Option
  if ($<HTMLSelectElement>('#hotkeyKind').value === 'combo') {
    $<HTMLSelectElement>('#hotkeyA').value = 'control';
    $<HTMLSelectElement>('#hotkeyB').value = 'option';
  }
  void saveHotkey();
});
$('#hotkeyA').addEventListener('change', () => void saveHotkey());
$('#hotkeyB').addEventListener('change', () => void saveHotkey());
$('#openKeyboard').addEventListener('click', () => api.openPrivacySettings('keyboard'));

// Test: while on, holding the key only lights the lamp (main doesn't start a dictation).
let hotkeyTesting = false;
function setHotkeyTesting(on: boolean): void {
  hotkeyTesting = on;
  $('#hotkeyTestBtn').textContent = on ? 'Stop' : 'Test';
  $('#hotkeyLamp').className = 'lamp';
  $('#hotkeyLampText').textContent = on ? 'Hold your key now…' : 'Not testing';
}
$('#hotkeyTestBtn').addEventListener('click', () => void api.setHotkeyTest(!hotkeyTesting));
api.onHotkeyTesting(setHotkeyTesting);
api.onHotkeyEvent((event) => {
  if (!hotkeyTesting) return;
  const texts = { down: '✓ Held — that works', up: 'Released', combo: 'Another key → would cancel' };
  $('#hotkeyLamp').className = `lamp ${event === 'down' ? 'on' : event === 'combo' ? 'combo' : ''}`.trim();
  $('#hotkeyLampText').textContent = texts[event];
});

// ================= Settings → Whisper models =================
/** Errors from Use / Delete (download errors come from main in the state). */
const modelErrors = new Map<string, string>();

function renderModels(models: ModelEntry[], download: ModelProgress | null): void {
  const busyId = download?.id ?? null;
  $('#modelList').replaceChildren(
    ...models.map((m) => {
      const row = document.createElement('div');
      row.className = 'setting model-row';
      row.dataset.model = m.id;

      // left: name + tags, size + note, progress / error
      const info = document.createElement('div');
      const name = document.createElement('div');
      name.className = 'model-name';
      name.append(m.label);
      if (m.recommended) name.append(tag('Recommended'));
      const hint = document.createElement('div');
      hint.className = 'hint';
      hint.textContent = `${formatSize(m.sizeBytes)} · ${m.note}`;
      info.append(name, hint);
      if (m.id === busyId) {
        const progress = document.createElement('div');
        progress.className = 'model-progress';
        progress.innerHTML = '<div class="progress"><div></div></div><span class="hint"></span>';
        info.append(progress);
      }
      const error = m.error ?? modelErrors.get(m.id);
      if (error) {
        const p = document.createElement('p');
        p.className = 'error';
        p.textContent = error;
        info.append(p);
      }

      // right: what you can do with it
      const actions = document.createElement('div');
      actions.className = 'model-actions';
      if (m.id === busyId) {
        actions.append(button('Cancel', () => api.models.cancelDownload()));
      } else if (m.downloaded) {
        if (m.active) {
          const ok = document.createElement('span');
          ok.className = 'ok-text';
          ok.textContent = '✓ Active';
          actions.append(ok);
        } else {
          actions.append(
            button('Delete', () => modelAction(m.id, api.models.delete(m.id))),
            button('Use', () => modelAction(m.id, api.models.setActive(m.id)), true)
          );
        }
      } else {
        const label = m.bytesOnDisk > 0 ? `Resume (${Math.floor((m.bytesOnDisk / m.sizeBytes) * 100)}%)` : 'Download';
        const btn = button(label, () => void api.models.download(m.id), true);
        btn.disabled = busyId !== null; // one download at a time
        actions.append(btn);
      }

      row.append(info, actions);
      return row;
    })
  );
  if (download) updateModelProgress(download);
}

/** Live progress of the download (only the bar + text, not the whole list). */
function updateModelProgress(p: ModelProgress): void {
  const row = document.querySelector<HTMLElement>(`[data-model="${p.id}"] .model-progress`);
  if (!row) return;
  const percent = Math.floor((p.received / p.total) * 100);
  $('.progress > div', row).style.width = `${percent}%`;
  $('.hint', row).textContent =
    p.phase === 'verifying'
      ? 'Checking the file…'
      : p.received === 0
        ? 'Connecting…'
        : `${percent}% · ${formatSize(p.received)} of ${formatSize(p.total)}` +
          (p.bytesPerSec > 0 ? ` · ${formatSize(p.bytesPerSec)}/s` : '');
}
api.models.onProgress(updateModelProgress);

/** Run Use / Delete; show its error under the model if it fails (main pushes the new state). */
async function modelAction(id: string, action: Promise<{ ok: boolean; error?: string }>): Promise<void> {
  modelErrors.delete(id);
  const res = await action;
  if (!res.ok && res.error) {
    modelErrors.set(id, res.error);
    render(await api.getState());
  }
}

function tag(text: string, kind = ''): HTMLElement {
  const span = document.createElement('span');
  span.className = `tag ${kind}`.trim();
  span.textContent = text;
  return span;
}

function button(text: string, onClick: () => void, primary = false): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.className = primary ? 'btn primary' : 'btn';
  btn.textContent = text;
  btn.addEventListener('click', onClick);
  return btn;
}

// ================= Library (meetings + transcribed files) =================
const audio = $<HTMLAudioElement>('#mAudio');
const LANG_NAMES: Record<string, string> = { auto: 'Auto', en: 'English', ur: 'Urdu' };
let itemId: string | null = null; // item open in the detail view
let itemSegments: Segment[] = []; // its transcript
const itemProgress = new Map<string, number>(); // id → percent while transcribing
let libraryFilter: 'all' | 'meeting' | 'file' = 'all'; // list filter chips

function setLibraryView(view: 'list' | 'detail'): void {
  $$('[data-mstate]').forEach((el) => el.classList.toggle('on', el.dataset.mstate === view));
  $('#mBack').hidden = view !== 'detail';
  $('#libraryHeading').textContent = view === 'detail' ? '' : 'Library';
  $('#libraryFilter').hidden = view === 'detail';
}

$$<HTMLButtonElement>('#libraryFilter button').forEach((b) =>
  b.addEventListener('click', () => {
    libraryFilter = (b.dataset.filter as typeof libraryFilter) ?? 'all';
    $$('#libraryFilter button').forEach((x) => x.classList.toggle('on', x === b));
    void showLibraryList();
  })
);

/** "Wed 5 Nov, 10:30" */
function formatWhen(ms: number): string {
  return new Date(ms).toLocaleString([], {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function transcriptLabel(t: TranscriptInfo | null): string {
  if (!t) return '';
  return t.translate ? `${LANG_NAMES[t.language] || t.language} → English` : LANG_NAMES[t.language] || t.language;
}

async function showLibraryList(): Promise<void> {
  audio.pause();
  itemId = null;
  setLibraryView('list');
  const all = await api.library.list();
  const items = all.filter((m) => libraryFilter === 'all' || m.kind === libraryFilter);
  const empty = $('#libraryEmpty');
  empty.hidden = items.length > 0;
  if (all.length === 0) empty.replaceChildren(...emptyLibraryHint());
  else empty.textContent = libraryFilter === 'file' ? 'No transcribed files yet.' : 'No meetings yet.';
  $('#libraryList').replaceChildren(
    ...items.map((m) => {
      const row = document.createElement('div');
      row.className = 'row' + (m.recording ? ' recording' : '');
      row.innerHTML =
        '<div class="ft"></div><div><div class="when"></div><div class="meta"></div></div><span class="badge"></span>';
      $('.when', row).textContent = m.title;
      const badge = $('.badge', row);
      if (m.recording) {
        $('.ft', row).textContent = 'M4A';
        $('.meta', row).textContent = `Meeting · ${formatWhen(m.created)}`;
        badge.textContent = '● Recording…';
        badge.classList.add('live');
      } else {
        $('.ft', row).textContent = m.ext;
        const kind = m.kind === 'file' ? 'File' : 'Meeting';
        const size = m.size ? ` · ${formatSize(m.size)}` : '';
        $('.meta', row).textContent = `${kind} · ${formatWhen(m.created)} · ${formatClock(m.durationSec)}${size}`;
        if (m.hasSummary) $('.when', row).append(tag('Summary'));
        if (itemProgress.has(m.id)) badge.textContent = `Transcribing… ${itemProgress.get(m.id)}%`;
        else if (m.transcript) {
          badge.textContent = `✓ Transcribed · ${transcriptLabel(m.transcript)}`;
          badge.classList.add('done');
        } else badge.textContent = 'Not transcribed';
        row.addEventListener('click', () => void openItem(m.id));
      }
      return row;
    })
  );
}

/** The "nothing here yet" text (built as DOM, no HTML strings). */
function emptyLibraryHint(): Node[] {
  const b = (text: string) => Object.assign(document.createElement('b'), { textContent: text });
  return [
    'Nothing here yet. Record a meeting (',
    b('Start Meeting Recording'),
    ' in the menu bar) or transcribe a file on the ',
    b('Transcribe File'),
    ' page — it shows up here.',
  ].map((x) => (typeof x === 'string' ? document.createTextNode(x) : x));
}

async function openItem(id: string): Promise<void> {
  const m = await api.library.get(id);
  itemId = m.id;
  setLibraryView('detail');
  cancelRename();
  $('#mTitle').textContent = m.title;
  $('#mExt').textContent = m.ext;
  const kind = m.kind === 'file' ? 'File' : 'Meeting';
  const size = m.size ? ` · ${formatSize(m.size)}` : '';
  $('#mMeta').textContent = `${kind} · ${formatWhen(m.created)} · ${formatClock(m.durationSec)}${size}`;
  $('#mError').hidden = true;

  // file items: where the original is (never copied); missing → no player, no re-transcribe
  const missing = m.kind === 'file' && Boolean(m.sourceMissing);
  $('#mSource').hidden = m.kind !== 'file';
  $('#mSourceText').textContent = m.source ? `From: ${shortPath(m.source)}` : '';
  $('#mSourceText').title = m.source ?? '';
  $('#mShowOriginal').hidden = missing;
  $('#mMissing').hidden = !missing;
  $('#mPlayer').hidden = missing;
  $('#pNote').hidden = true;
  openSource = m.source ?? null;

  // player
  audio.pause();
  if (missing) audio.removeAttribute('src');
  else audio.src = `library://audio/${encodeURIComponent(m.id)}`;
  updatePlayer();

  // transcribe controls: start from the last choice for this item, else the app language
  $<HTMLSelectElement>('#mLang').value =
    m.transcript?.language || (['auto', 'en', 'ur'].includes(currentAppLanguage) ? currentAppLanguage : 'auto');
  $<HTMLInputElement>('#mTranslate').checked = Boolean(m.transcript?.translate);
  showItemProgress(itemProgress.get(m.id));
  $<HTMLButtonElement>('#mTranscribe').disabled = missing || itemProgress.has(m.id);
  renderItemTranscript(m);
}

/** "/Users/name/Downloads/x.mp4" → "~/Downloads/x.mp4" */
function shortPath(p: string): string {
  const parts = p.split('/');
  return parts[1] === 'Users' && parts.length > 3 ? ['~', ...parts.slice(3)].join('/') : p;
}

let openSource: string | null = null; // original file of the open file item
$('#mShowOriginal').addEventListener('click', () => openSource && api.revealFile(openSource));
// A format Chromium can't play (e.g. .mkv, .avi, .wma): say so instead of a dead player.
audio.addEventListener('error', () => {
  if (itemId !== null && audio.getAttribute('src')) $('#pNote').hidden = false;
});

function renderItemTranscript(m: LibraryItemDetail): void {
  renderSummary(m.summary, m.segments.length > 0);
  itemSegments = m.segments || [];
  $('#mTranscriptCard').hidden = itemSegments.length === 0;
  $('#mTranscribe').textContent = itemSegments.length ? 'Transcribe again' : 'Transcribe';
  $('#mTranscriptMeta').textContent = m.transcript ? transcriptLabel(m.transcript) : '';
  const box = $('#mTranscript');
  box.classList.toggle('rtl', m.transcript?.language === 'ur' && !m.transcript?.translate); // Urdu reads right-to-left
  box.replaceChildren(
    ...itemSegments.map((seg, i) => {
      const p = document.createElement('p');
      p.className = 'line';
      p.dataset.index = String(i);
      const ts = document.createElement('span');
      ts.className = 'ts';
      ts.textContent = formatClock(seg.start);
      p.append(ts, seg.text); // text, never HTML
      p.addEventListener('click', () => {
        audio.currentTime = seg.start;
        void audio.play();
      });
      return p;
    })
  );
}

// ----- player -----
let seeking = false;

function updatePlayer(): void {
  const d = Number.isFinite(audio.duration) ? audio.duration : 0;
  $('#pTime').textContent = `${formatClock(audio.currentTime)} / ${formatClock(d)}`;
  if (!seeking) $<HTMLInputElement>('#pSeek').value = String(d ? Math.round((audio.currentTime / d) * 1000) : 0);
  $('#pPlay').textContent = audio.paused ? '▶' : '❚❚';
  highlightLine();
}

let lastHighlighted = -1;
function highlightLine(): void {
  let idx = -1;
  for (let i = 0; i < itemSegments.length; i++) {
    if (itemSegments[i].start <= audio.currentTime + 0.05) idx = i;
    else break;
  }
  if (idx === lastHighlighted) return;
  document.querySelector('#mTranscript .line.current')?.classList.remove('current');
  const line = document.querySelector(`#mTranscript .line[data-index="${idx}"]`);
  if (line) {
    line.classList.add('current');
    if (!audio.paused) line.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
  lastHighlighted = idx;
}

['timeupdate', 'loadedmetadata', 'play', 'pause', 'ended'].forEach((e) => audio.addEventListener(e, updatePlayer));
$('#pPlay').addEventListener('click', () => (audio.paused ? void audio.play() : audio.pause()));
$('#pBack').addEventListener('click', () => (audio.currentTime = Math.max(0, audio.currentTime - 15)));
$('#pFwd').addEventListener('click', () => (audio.currentTime = Math.min(audio.duration || 0, audio.currentTime + 15)));
$('#pSeek').addEventListener('input', (e) => {
  seeking = true;
  const d = audio.duration || 0;
  const value = Number((e.target as HTMLInputElement).value);
  $('#pTime').textContent = `${formatClock((value / 1000) * d)} / ${formatClock(d)}`;
});
$('#pSeek').addEventListener('change', (e) => {
  audio.currentTime = (Number((e.target as HTMLInputElement).value) / 1000) * (audio.duration || 0);
  seeking = false;
});
$('#pVol').addEventListener('input', (e) => (audio.volume = Number((e.target as HTMLInputElement).value)));

// ----- transcribe -----
function showItemProgress(percent: number | undefined): void {
  const busy = percent !== undefined;
  $('#mProgressWrap').hidden = !busy;
  $<HTMLButtonElement>('#mTranscribe').disabled = busy;
  if (busy) {
    $('#mProgressBar').style.width = `${percent}%`;
    $('#mProgressText').textContent = percent > 0 ? `Transcribing… ${percent}%` : 'Preparing…';
  }
}

api.library.onProgress(({ id, percent, etaSec }) => {
  itemProgress.set(id, percent);
  if (id === itemId) {
    showItemProgress(percent);
    if (etaSec > 0)
      $('#mProgressText').textContent = `Transcribing… ${percent}% · about ${formatDuration(etaSec)} left`;
  }
});

$('#mTranscribe').addEventListener('click', async () => {
  const id = itemId;
  if (id === null) return;
  $('#mError').hidden = true;
  itemProgress.set(id, 0);
  showItemProgress(0);
  const res = await api.library.transcribe(id, {
    language: $<HTMLSelectElement>('#mLang').value,
    translate: $<HTMLInputElement>('#mTranslate').checked,
  });
  itemProgress.delete(id);
  if (id !== itemId) return; // user moved on; the list shows the result
  showItemProgress(undefined);
  if (res.ok) renderItemTranscript(await api.library.get(id));
  else if (!res.cancelled) {
    $('#mError').textContent = `Couldn't transcribe: ${res.error}`;
    $('#mError').hidden = false;
  }
});
$('#mCancel').addEventListener('click', () => api.library.cancel());

// ----- actions -----
$('#mBack').addEventListener('click', () => void showLibraryList());
$('#mReveal').addEventListener('click', () => itemId && api.library.reveal(itemId));
$('#mCopy').addEventListener('click', async () => {
  await api.copyTranscript(itemSegments);
  flash($('#mCopy'), 'Copied');
});
$('#mDelete').addEventListener('click', async () => {
  if (itemId === null) return;
  const res = await api.library.delete(itemId);
  if (res.ok) void showLibraryList();
  else if (!res.cancelled) {
    $('#mError').textContent = res.error ?? '';
    $('#mError').hidden = false;
  }
});

const RENAME_HIDES = ['#mTitle', '#mRename', '#mReveal', '#mDelete']; // shown while not renaming
const RENAME_SHOWS = ['#mTitleInput', '#mSaveName', '#mCancelName']; // shown while renaming

function startRename(): void {
  const input = $<HTMLInputElement>('#mTitleInput');
  input.value = $('#mTitle').textContent ?? '';
  RENAME_HIDES.forEach((s) => ($(s).hidden = true));
  RENAME_SHOWS.forEach((s) => ($(s).hidden = false));
  input.focus();
  input.select();
}
function cancelRename(): void {
  RENAME_HIDES.forEach((s) => ($(s).hidden = false));
  RENAME_SHOWS.forEach((s) => ($(s).hidden = true));
}
async function saveRename(): Promise<void> {
  if (itemId === null) return;
  const res = await api.library.rename(itemId, $<HTMLInputElement>('#mTitleInput').value);
  if (!res.ok) {
    $('#mError').textContent = res.error ?? '';
    $('#mError').hidden = false;
    return;
  }
  const t = audio.currentTime;
  const wasPlaying = !audio.paused;
  await openItem(res.id); // reload under the new name (keeps your place)
  audio.addEventListener(
    'loadedmetadata',
    () => {
      audio.currentTime = t;
      if (wasPlaying) void audio.play();
    },
    { once: true }
  );
}
$('#mRename').addEventListener('click', startRename);
$('#mCancelName').addEventListener('click', cancelRename);
$('#mSaveName').addEventListener('click', () => void saveRename());
$('#mTitleInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') void saveRename();
  if (e.key === 'Escape') cancelRename();
});

// recordings started/stopped, files transcribed, items renamed/deleted → refresh the list if it's showing
api.library.onChanged(() => {
  if ($('.page[data-page="library"]').classList.contains('on') && itemId === null) void showLibraryList();
});

// ================= AI summary (task 26) =================
let summarizingId: string | null = null; // item being summarized (one at a time)
let summaryText = ''; // summary on screen (for Copy)
const PROVIDER_NAMES: Record<string, string> = { claude: 'Claude Code', codex: 'Codex' };

/** The Summary card of the open item. */
function renderSummary(summary: LibraryItemDetail['summary'], hasTranscript: boolean): void {
  summaryText = summary?.text ?? '';
  const busy = summarizingId !== null && summarizingId === itemId;
  const btn = $<HTMLButtonElement>('#mSummarize');
  btn.textContent = summary ? 'Regenerate' : 'Summarize';
  btn.disabled = !hasTranscript || summarizingId !== null;
  btn.title = hasTranscript ? '' : 'Transcribe first';
  $('#mSummaryHint').hidden = Boolean(summary) || busy;
  $('#mSummaryBusy').hidden = !busy;
  $('#mSummaryCopy').hidden = !summary;
  $('#mSummaryOutdated').hidden = !summary?.outdated;
  $('#mSummaryMeta').textContent = summary
    ? `${summary.provider ? PROVIDER_NAMES[summary.provider] : 'AI'} · ${formatWhen(summary.createdAt)}`
    : '';
  $('#mSummary').hidden = !summary;
  $('#mSummary').replaceChildren(...(summary ? renderMarkdown(summary.text) : []));
}

/**
 * A small, safe Markdown → DOM: "## heading", "- bullets", "1. numbered", "**bold**", paragraphs.
 * Everything is built with textContent — the AI's text is never inserted as HTML.
 */
function renderMarkdown(md: string): Node[] {
  const out: Node[] = [];
  let list: HTMLElement | null = null;
  const inline = (el: HTMLElement, text: string): HTMLElement => {
    for (const part of text.split(/(\*\*[^*]+\*\*)/)) {
      if (/^\*\*[^*]+\*\*$/.test(part))
        el.append(Object.assign(document.createElement('strong'), { textContent: part.slice(2, -2) }));
      else if (part) el.append(document.createTextNode(part));
    }
    return el;
  };
  for (const raw of md.split('\n')) {
    const line = raw.trim();
    const heading = /^#{1,6}\s+(.*)$/.exec(line);
    const bullet = /^[-*•]\s+(.*)$/.exec(line);
    const numbered = /^\d+[.)]\s+(.*)$/.exec(line);
    if (bullet || numbered) {
      const kind = bullet ? 'UL' : 'OL';
      if (!list || list.tagName !== kind) {
        list = document.createElement(kind.toLowerCase());
        out.push(list);
      }
      list.append(inline(document.createElement('li'), (bullet ?? numbered)![1]));
      continue;
    }
    list = null;
    if (!line) continue;
    if (heading) out.push(inline(document.createElement('h4'), heading[1]));
    else out.push(inline(document.createElement('p'), line));
  }
  return out;
}

/** Settings → AI summary, scrolled into view and briefly highlighted. */
function openAiSettings(): void {
  showPage('settings');
  const card = $('#aiCard');
  card.scrollIntoView({ behavior: 'smooth', block: 'center' });
  card.classList.add('highlight');
  setTimeout(() => card.classList.remove('highlight'), 1600);
}

async function summarizeOpenItem(): Promise<void> {
  const id = itemId;
  if (id === null || summarizingId !== null) return;
  if (currentAiProvider === 'off') return openAiSettings(); // nothing set up → Settings, nothing sent
  $('#mSummaryError').hidden = true;
  summarizingId = id;
  $('#mSummaryBusyText').textContent = `Summarizing with ${PROVIDER_NAMES[currentAiProvider]}…`;
  renderSummary(
    summaryText ? { text: summaryText, provider: null, createdAt: Date.now(), outdated: false } : null,
    true
  );
  const res = await api.library.summarize(id);
  summarizingId = null;
  if (id !== itemId) return; // user moved on; it's saved anyway (the list shows the tag)
  if (res.ok) return void openItemSummary(id);
  void openItemSummary(id); // back to the saved state
  if (res.cancelled) return;
  if (res.needsSetup) return openAiSettings();
  $('#mSummaryError').textContent = res.error ?? 'Something went wrong.';
  $('#mSummaryError').hidden = false;
}

/** Reload just the summary part of the open item. */
async function openItemSummary(id: string): Promise<void> {
  const m = await api.library.get(id);
  if (m.id === itemId) renderSummary(m.summary, m.segments.length > 0);
}

$('#mSummarize').addEventListener('click', () => void summarizeOpenItem());
$('#mSummaryCancel').addEventListener('click', () => api.library.cancelSummary());
$('#mSummaryCopy').addEventListener('click', async () => {
  await api.copyText(summaryText);
  flash($('#mSummaryCopy'), 'Copied');
});

// ----- Settings → AI summary -----
let currentAiProvider: AppState['aiProvider'] = 'off';
const AI_HELP: Record<string, string> = {
  claude:
    'Not found. Install Claude Code (claude.com/claude-code), then run “claude” once in Terminal and sign in with your Claude subscription — or use Choose… to pick the program.',
  codex:
    'Not found. Install Codex (in Terminal: npm install -g @openai/codex), then run “codex” once and sign in with your ChatGPT subscription — or use Choose… to pick the program.',
};
const AI_COMPANY: Record<string, string> = { claude: 'Anthropic', codex: 'OpenAI' };

function renderAiProvider(provider: AppState['aiProvider']): void {
  if (provider === currentAiProvider && $<HTMLSelectElement>('#aiProvider').value === provider) return;
  currentAiProvider = provider;
  $<HTMLSelectElement>('#aiProvider').value = provider;
  $('#aiStatusRow').hidden = provider === 'off';
  $('#aiPrivacy').hidden = provider === 'off';
  $('#aiPrivacy').textContent =
    provider === 'off'
      ? ''
      : `Clicking Summarize sends that transcript's text (never audio) to ${AI_COMPANY[provider]} using your subscription. Nothing is sent otherwise.`;
  $('#aiTestResult').hidden = true;
  void refreshAiStatus();
}

async function refreshAiStatus(status?: AiStatus): Promise<void> {
  if (currentAiProvider === 'off') {
    $('#aiHelp').hidden = true;
    return;
  }
  $('#aiStatus').textContent = 'Checking…';
  const s = status ?? (await api.ai.status());
  if (s.provider !== currentAiProvider) return; // changed meanwhile
  $('#aiStatus').textContent = s.path
    ? `✓ Found${s.manual ? ' (chosen by hand)' : ''}: ${shortPath(s.path)}${s.version ? ` · ${s.version}` : ''}`
    : '✗ Not found';
  $('#aiHelp').hidden = Boolean(s.path);
  $('#aiHelp').textContent = s.path ? '' : AI_HELP[s.provider];
  $<HTMLButtonElement>('#aiTest').disabled = !s.path;
}

$('#aiProvider').addEventListener('change', (e) => {
  void api.ai.setProvider((e.target as HTMLSelectElement).value as AppState['aiProvider']);
});
$('#aiChoose').addEventListener('click', async () => void refreshAiStatus(await api.ai.choosePath()));
$('#aiTest').addEventListener('click', async () => {
  const btn = $<HTMLButtonElement>('#aiTest');
  btn.disabled = true;
  const out = $('#aiTestResult');
  out.hidden = false;
  out.textContent = `Asking ${PROVIDER_NAMES[currentAiProvider]}…`;
  const res = await api.ai.test();
  out.textContent = res.ok
    ? `✓ Works — it answered “${res.reply}”. You can summarize in the Library.`
    : `✗ ${res.error}`;
  btn.disabled = false;
});

// ================= helpers =================
function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}
/** 75 → "01:15", 3725 → "1:02:05" */
function formatClock(seconds: number): string {
  const sec = Math.max(0, Math.floor(seconds));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}
/** 75 → "1 min 15 s" */
function formatDuration(sec: number): string {
  if (sec < 60) return `${sec} s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return s ? `${m} min ${s} s` : `${m} min`;
}
/** Briefly change a button's label (e.g. "Copied"), then restore it — icon included. */
function flash(btn: HTMLElement, text: string): void {
  if (btn.dataset.flashing) return;
  btn.dataset.flashing = '1';
  const original = [...btn.childNodes];
  btn.textContent = text;
  setTimeout(() => {
    btn.replaceChildren(...original);
    delete btn.dataset.flashing;
  }, 1200);
}
