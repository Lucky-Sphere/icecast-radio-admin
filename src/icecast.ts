import * as fs from 'fs';
import * as path from 'path';
import { execFile, spawnSync } from 'child_process';

export interface SongInfo {
  name: string;
  size: number;
}

export interface IcecastConfig {
  musicDir: string;
  playlistFile: string;
  lsPidFile: string;
  liqScript: string;
  icecastPort: number;
}

export interface ActionResult {
  ok: boolean;
  message: string;
}

const ALLOWED_EXTS = ['mp3', 'ogg', 'wav', 'aac', 'flac', 'm4a'];

function shellEscape(arg: string): string {
  return "'" + arg.replace(/'/g, "'\\''") + "'";
}

export function formatSize(bytes: number): string {
  if (bytes >= 1073741824) return (bytes / 1073741824).toFixed(2) + ' GB';
  if (bytes >= 1048576) return (bytes / 1048576).toFixed(2) + ' MB';
  if (bytes >= 1024) return (bytes / 1024).toFixed(2) + ' KB';
  return bytes + ' B';
}

export function getSongs(musicDir: string): SongInfo[] {
  const list: SongInfo[] = [];
  if (!fs.existsSync(musicDir)) return list;
  for (const dirent of fs.readdirSync(musicDir, { withFileTypes: true })) {
    if (!dirent.isFile()) continue;
    const ext = path.extname(dirent.name).slice(1).toLowerCase();
    if (!ALLOWED_EXTS.includes(ext)) continue;
    let size = 0;
    try {
      size = fs.statSync(path.join(musicDir, dirent.name)).size;
    } catch {
      /* ignore unreadable files */
    }
    list.push({ name: dirent.name, size });
  }
  list.sort((a, b) => a.name.localeCompare(b.name));
  return list;
}

export function getPlaylist(playlistFile: string): string[] {
  const entries: string[] = [];
  if (!fs.existsSync(playlistFile)) return entries;
  const content = fs.readFileSync(playlistFile, 'utf-8');
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line && !line.startsWith('#')) entries.push(path.basename(line));
  }
  return entries;
}

export function writePlaylist(playlistFile: string, musicDir: string, entries: string[]): void {
  let content = '#EXTM3U\n';
  for (const entry of entries) content += path.join(musicDir, entry) + '\n';
  fs.writeFileSync(playlistFile, content);
}

export function addToPlaylist(config: IcecastConfig, songs: string[]): ActionResult {
  const pl = getPlaylist(config.playlistFile);
  const existing = new Set(pl);
  let added = 0;
  for (const song of songs) {
    const name = path.basename(song);
    if (!existing.has(name) && fs.existsSync(path.join(config.musicDir, name))) {
      existing.add(name);
      pl.push(name);
      added++;
    }
  }
  if (added > 0) writePlaylist(config.playlistFile, config.musicDir, pl);
  return {
    ok: true,
    message: added > 0 ? `${added} song(s) added to playlist.` : 'No new songs added.',
  };
}

export function removeFromPlaylist(config: IcecastConfig, songs: string[]): ActionResult {
  const remove = new Set(songs.map((s) => path.basename(s)));
  const pl = getPlaylist(config.playlistFile).filter((s) => !remove.has(s));
  writePlaylist(config.playlistFile, config.musicDir, pl);
  return { ok: true, message: 'Song(s) removed from playlist.' };
}

export function deleteSongs(config: IcecastConfig, songs: string[]): ActionResult {
  const plSongs = new Set(getPlaylist(config.playlistFile));
  let deleted = 0;
  for (const song of songs) {
    const name = path.basename(song);
    const file = path.join(config.musicDir, name);
    if (fs.existsSync(file)) {
      try {
        fs.unlinkSync(file);
        deleted++;
        plSongs.delete(name);
      } catch {
        /* keep going */
      }
    }
  }
  if (deleted > 0) writePlaylist(config.playlistFile, config.musicDir, [...plSongs]);
  return { ok: true, message: `${deleted} song(s) deleted.` };
}

export function isStreamRunning(config: IcecastConfig): boolean {
  try {
    const pid = fs.readFileSync(config.lsPidFile, 'utf-8').trim();
    if (/^\d+$/.test(pid) && fs.existsSync('/proc/' + pid)) return true;
  } catch {
    /* pid file missing */
  }
  try {
    const res = spawnSync('pgrep', ['-x', 'liquidsoap'], { encoding: 'utf-8' });
    return res.status === 0 && (res.stdout || '').trim().length > 0;
  } catch {
    return false;
  }
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export async function startStream(config: IcecastConfig): Promise<ActionResult> {
  if (isStreamRunning(config)) {
    return { ok: true, message: 'Stream is already running.' };
  }
  const cmd =
    `nohup liquidsoap ${shellEscape(config.liqScript)} > /dev/null 2>&1 & echo $! > ${shellEscape(config.lsPidFile)}`;
  spawnSync('sh', ['-c', cmd]);
  await sleep(2000);
  if (isStreamRunning(config)) {
    return { ok: true, message: 'Stream started.' };
  }
  return { ok: false, message: 'Failed to start stream.' };
}

export async function stopStream(config: IcecastConfig): Promise<ActionResult> {
  if (!isStreamRunning(config)) {
    return { ok: true, message: 'Stream is not running.' };
  }
  try {
    const pid = fs.readFileSync(config.lsPidFile, 'utf-8').trim();
    if (/^\d+$/.test(pid)) execFile('kill', [pid]);
  } catch {
    /* ignore */
  }
  spawnSync('pkill', ['-x', 'liquidsoap']);
  await sleep(1000);
  return { ok: true, message: 'Stream stopped.' };
}

export function convertToMp3(input: string, output: string): Promise<boolean> {
  return new Promise((resolve) => {
    execFile(
      'ffmpeg',
      ['-i', input, '-c:a', 'libmp3lame', '-b:a', '128k', '-y', output],
      (err) => resolve(!err),
    );
  });
}