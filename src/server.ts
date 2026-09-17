import * as fs from 'fs';
import * as path from 'path';
import express from 'express';
import multer from 'multer';
import {
  IcecastConfig,
  addToPlaylist,
  convertToMp3,
  deleteSongs,
  formatSize,
  getPlaylist,
  getSongs,
  isStreamRunning,
  removeFromPlaylist,
  startStream,
  stopStream,
} from './icecast';

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.PORT || 3000);

function buildConfig(): IcecastConfig {
  return {
    musicDir: process.env.MUSIC_DIR || path.join(ROOT, 'music'),
    playlistFile: process.env.PLAYLIST_FILE || path.join(ROOT, 'playlists', 'playlist.m3u'),
    lsPidFile: process.env.LS_PID_FILE || '/tmp/liquidsoap.pid',
    liqScript: process.env.LIQ_SCRIPT || '/etc/liquidsoap/icecast.liq',
    icecastPort: Number(process.env.ICECAST_PORT || 8000),
  };
}

const config = buildConfig();
const ALLOWED_EXTS = ['mp3', 'ogg', 'wav', 'aac', 'flac', 'm4a'];
if (!fs.existsSync(config.musicDir)) fs.mkdirSync(config.musicDir, { recursive: true });

const app = express();
app.use(express.json());
app.use(express.static(path.join(ROOT, 'public')));

const upload = multer({
  storage: multer.diskStorage({
    destination: config.musicDir,
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname || '').toLowerCase();
      cb(null, `tmp_${Date.now()}_${Math.random().toString(36).slice(2)}${ext}`);
    },
  }),
  limits: { fileSize: 200 * 1024 * 1024 },
});

app.get('/api/state', (req, res) => {
  const host = req.headers.host || 'localhost';
  const hostname = host.split(':')[0];
  const streamUrl = `http://${hostname}:${config.icecastPort}/stream`;
  const icecastUrl = `http://${hostname}:${config.icecastPort}`;
  const songs = getSongs(config.musicDir).map((s) => ({ ...s, sizeLabel: formatSize(s.size) }));
  const playlist = getPlaylist(config.playlistFile);
  res.json({
    running: isStreamRunning(config),
    streamUrl,
    icecastUrl,
    songs,
    playlist,
    totalSongs: songs.length,
    playlistCount: playlist.length,
  });
});

app.post('/api/upload', upload.array('song'), async (req, res) => {
  const files: Express.Multer.File[] = Array.isArray(req.files) ? req.files : [];
  let uploaded = 0;
  let converted = 0;

  for (const file of files) {
    const origName = path.basename(file.originalname || '');
    const ext = path.extname(origName).slice(1).toLowerCase();
    if (!ALLOWED_EXTS.includes(ext)) {
      try {
        fs.unlinkSync(file.path);
      } catch {
        /* ignore */
      }
      continue;
    }

    if (ext === 'mp3') {
      const dest = path.join(config.musicDir, origName);
      try {
        fs.renameSync(file.path, dest);
        uploaded++;
      } catch {
        try {
          fs.unlinkSync(file.path);
        } catch {
          /* ignore */
        }
      }
    } else {
      const base = path.basename(origName, path.extname(origName));
      let dest = path.join(config.musicDir, base + '.mp3');
      let i = 1;
      while (fs.existsSync(dest)) {
        dest = path.join(config.musicDir, `${base}_${i}.mp3`);
        i++;
      }
      const ok = await convertToMp3(file.path, dest);
      try {
        fs.unlinkSync(file.path);
      } catch {
        /* ignore */
      }
      if (ok) converted++;
    }
  }

  let message = '';
  if (uploaded) message = `${uploaded} MP3 file(s) uploaded.`;
  if (converted) message = (message ? message + ' ' : '') + `${converted} file(s) converted to MP3.`;
  if (!uploaded && !converted) message = 'No files were processed.';
  res.json({ ok: !!(uploaded || converted), message });
});

app.post('/api/playlist/add', (req, res) => {
  const songs: string[] = Array.isArray(req.body.songs) ? req.body.songs : [];
  res.json(addToPlaylist(config, songs));
});

app.post('/api/playlist/remove', (req, res) => {
  const songs: string[] = Array.isArray(req.body.songs) ? req.body.songs : [];
  res.json(removeFromPlaylist(config, songs));
});

app.post('/api/music/delete', (req, res) => {
  const songs: string[] = Array.isArray(req.body.songs) ? req.body.songs : [];
  res.json(deleteSongs(config, songs));
});

app.post('/api/stream/start', async (_req, res) => {
  res.json(await startStream(config));
});

app.post('/api/stream/stop', async (_req, res) => {
  res.json(await stopStream(config));
});

app.listen(PORT, () => {
  console.log(`Icecast Radio Admin listening on http://localhost:${PORT}`);
});