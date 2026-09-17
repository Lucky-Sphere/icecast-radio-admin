interface Song {
  name: string;
  size: number;
  sizeLabel: string;
}

interface StationState {
  running: boolean;
  streamUrl: string;
  icecastUrl: string;
  songs: Song[];
  playlist: string[];
  totalSongs: number;
  playlistCount: number;
}

let state: StationState | null = null;

function $(id: string): HTMLElement | null {
  return document.getElementById(id);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return (await res.json()) as T;
}

function checkedSongs(scope: HTMLElement): string[] {
  const names: string[] = [];
  scope.querySelectorAll<HTMLInputElement>('input[name="songs"]:checked').forEach((cb) => {
    if (cb.value) names.push(cb.value);
  });
  return names;
}

async function refresh(message?: string): Promise<void> {
  state = await api<StationState>('/api/state');
  render();
  showMessage(message);
}

function showMessage(message: string | undefined): void {
  if (!message) return;
  const container = $('content-section');
  if (!container) return;
  const el = document.createElement('div');
  el.className = 'msg';
  el.textContent = message;
  container.insertBefore(el, container.firstChild);
}

async function sendAction(
  path: string,
  body: Record<string, unknown> | null,
): Promise<void> {
  try {
    const r = await api<{ ok: boolean; message: string }>(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
    });
    await refresh(r.message);
  } catch (err) {
    await refresh();
    showMessage('Request failed: ' + (err as Error).message);
  }
}

function renderRowCheckbox(song: string): string {
  return `<input type="checkbox" name="songs" value="${escapeHtml(song)}">`;
}

function render(): void {
  if (!state) return;
  const ws = $('player-wrap');
  const player = $('player') as HTMLAudioElement | null;

  if (state.running) {
    if (ws) ws.style.display = '';
    if (player) player.volume = 0.8;
    const link = $('stream-link');
    if (link) {
      link.textContent = state.streamUrl;
      link.setAttribute('href', state.streamUrl);
    }
    const src = $('player-src') as HTMLSourceElement | null;
    if (src && player) {
      if (src.src !== state.streamUrl) {
        src.src = state.streamUrl;
        player.load();
      }
    }
  } else if (ws) {
    ws.style.display = 'none';
    if (player) {
      player.pause();
      const b = $('playBtn');
      if (b) {
        b.classList.add('btn-primary');
        b.classList.remove('btn-danger');
        b.textContent = 'Play';
      }
    }
  }

  const section = $('content-section');
  if (!section) return;

  const emptyLib = state.songs.length === 0;
  const emptyPl = state.playlist.length === 0;
  const startDisabled = emptyPl ? 'disabled' : '';

  let html =
    `<div class="stats-row">
      <div class="stat-box"><div class="num">${state.totalSongs}</div><div class="lbl">Songs Library</div></div>
      <div class="stat-box"><div class="num">${state.playlistCount}</div><div class="lbl">Playlist</div></div>
      <div class="stat-box"><div class="num">${state.running ? 'Live' : 'Off'}</div><div class="lbl">Stream</div></div>
    </div>

    <div class="grid-2">
      <div class="card">
        <h2>Upload Songs</h2>
        <form id="upload-form" enctype="multipart/form-data">
          <div class="upload-row">
            <input type="file" name="song" multiple accept=".mp3,.ogg,.wav,.aac,.flac,.m4a" required>
            <button type="submit" class="btn btn-primary btn-sm" id="upload-btn">Upload</button>
          </div>
        </form>
      </div>
      <div class="card">
        <h2>Stream Control</h2>
        <div class="stream-actions">`;

  if (state.running) {
    html +=
      `<button type="button" class="btn btn-danger" id="stopStream">Stop Stream</button>`;
  } else {
    html +=
      `<button type="button" class="btn btn-primary" id="startStream" ${startDisabled}>Start Stream</button>`;
  }
  html +=
      ` <a href="${escapeHtml(state.icecastUrl)}" target="_blank" class="btn btn-secondary">Icecast Status</a>
        </div>
        ${emptyPl ? '<p class="hint">Add songs to the playlist before starting.</p>' : ''}
      </div>
    </div>

    <div class="grid-2">
      <div class="card">
        <h2>Music Library <span>(${state.totalSongs})</span></h2>
        ${emptyLib ? '<p class="hint">No songs uploaded yet.</p>' : `
        <table>
          <thead><tr><th></th><th>File</th><th>Size</th></tr></thead>
          <tbody>
            ${state.songs
              .map(
                (s) =>
                  `<tr><td>${renderRowCheckbox(s.name)}</td><td>${escapeHtml(s.name)}</td><td class="size">${escapeHtml(s.sizeLabel)}</td></tr>`,
              )
              .join('')}
          </tbody>
        </table>
        <div style="display:flex;gap:8px;margin-top:10px;">
          <button type="button" class="btn btn-primary btn-sm" id="libAdd">Add to Playlist</button>
          <button type="button" class="btn btn-danger btn-sm" id="libDelete">Delete</button>
        </div>`}
      </div>

      <div class="card">
        <h2>Playlist <span>(${state.playlistCount})</span></h2>
        ${emptyPl ? '<p class="hint">Playlist is empty.</p>' : `
        <table>
          <thead><tr><th></th><th>#</th><th>Song</th></tr></thead>
          <tbody>
            ${state.playlist
              .map(
                (s, i) =>
                  `<tr><td>${renderRowCheckbox(s)}</td><td style="color:#666">${i + 1}</td><td>${escapeHtml(s)}</td></tr>`,
              )
              .join('')}
          </tbody>
        </table>
        <div style="margin-top:10px;">
          <button type="button" class="btn btn-danger btn-sm" id="plRemove">Remove Selected</button>
        </div>`}
      </div>
    </div>

    <div style="text-align:center;margin-top:30px;padding:20px;color:#444;font-size:12px;">
      Icecast Radio Admin &mdash; Powered by Icecast2 + Liquidsoap
    </div>`;

  section.innerHTML = html;

  attachActions(section);
}

function attachActions(section: HTMLElement): void {
  const uploadForm = $('upload-form') as HTMLFormElement | null;
  if (uploadForm) {
    uploadForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const btn = $('upload-btn') as HTMLButtonElement | null;
      if (btn) btn.disabled = true;
      const fd = new FormData(uploadForm);
      fetch('/api/upload', { method: 'POST', body: fd })
        .then((r) => {
          if (!r.ok) throw new Error('HTTP ' + r.status);
          return r.json() as Promise<{ message: string }>;
        })
        .then(async (r) => {
          const input = uploadForm.querySelector('input[type="file"]') as HTMLInputElement;
          if (input) input.value = '';
          await refresh(r.message);
        })
        .catch(async (err) => {
          await refresh();
          showMessage('Upload failed: ' + (err as Error).message);
        });
    });
  }

  const libTable = section.querySelectorAll('table')[0];
  const plTable = section.querySelectorAll('table')[1];

  const libAdd = $('libAdd');
  if (libAdd) {
    libAdd.addEventListener('click', () => {
      const names = checkedSongs(libTable || section);
      if (names.length === 0) {
        showMessage('Select songs from the Music Library first.');
        return;
      }
      sendAction('/api/playlist/add', { songs: names });
    });
  }

  const libDelete = $('libDelete');
  if (libDelete) {
    libDelete.addEventListener('click', () => {
      const names = checkedSongs(libTable || section);
      if (names.length === 0) {
        showMessage('Select songs from the Music Library first.');
        return;
      }
      if (!confirm('Delete selected songs?')) return;
      sendAction('/api/music/delete', { songs: names });
    });
  }

  const plRemove = $('plRemove');
  if (plRemove) {
    plRemove.addEventListener('click', () => {
      const names = checkedSongs(plTable || section);
      if (names.length === 0) {
        showMessage('Select songs from the Playlist first.');
        return;
      }
      sendAction('/api/playlist/remove', { songs: names });
    });
  }

  const startBtn = $('startStream');
  if (startBtn) {
    startBtn.addEventListener('click', () => sendAction('/api/stream/start', null));
  }
  const stopBtn = $('stopStream');
  if (stopBtn) {
    stopBtn.addEventListener('click', () => sendAction('/api/stream/stop', null));
  }
}

function initPlayer(): void {
  const playBtn = $('playBtn');
  const volControl = $('volControl') as HTMLInputElement | null;
  const player = $('player') as HTMLAudioElement | null;

  if (playBtn && player) {
    playBtn.addEventListener('click', () => {
      if (player.paused) {
        player.play();
        playBtn.textContent = 'Stop';
        playBtn.classList.add('btn-danger');
        playBtn.classList.remove('btn-primary');
      } else {
        player.pause();
        playBtn.textContent = 'Play';
        playBtn.classList.add('btn-primary');
        playBtn.classList.remove('btn-danger');
      }
    });
  }
  if (volControl && player) {
    volControl.addEventListener('input', () => {
      player.volume = Number(volControl.value) / 100;
    });
  }
}

async function init(): Promise<void> {
  initPlayer();
  try {
    await refresh();
  } catch (err) {
    const section = $('content-section');
    if (section) {
      section.innerHTML = `<div class="msg err">Failed to load: ${escapeHtml((err as Error).message)}</div>`;
    }
  }
}

init();