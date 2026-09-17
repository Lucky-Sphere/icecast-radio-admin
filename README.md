# Icecast Radio Station

Single-page TypeScript admin interface to manage an Icecast2 radio station with playlist management, song uploads (auto-converted to MP3), and a Liquidsoap streaming backend with seamless playlist reloading.

Full-stack TypeScript rewrite of the original PHP version:
- **Backend:** Node.js + Express REST API (`src/`)
- **Frontend:** TypeScript single-page app (`public/`)

## Live demo (static showcase)

The root `index.html` is a **self-contained static demo** of the admin interface — it runs entirely in the browser with dummy data (no server needed), so it can be hosted on GitHub Pages:

- **Live:** `https://lucky-sphere.github.io/Icecast-Radio-Admin/`
- Works standalone: just open `index.html` locally or drop it on any static host.
- Simulated actions: upload, add/remove playlist songs, delete, start/stop stream, player.
- `.nojekyll` is included so GitHub Pages serves the file directly.

To enable GitHub Pages: push the repo, then go to **Settings → Pages**, set **Source** to branch `master` (root).

## Dependencies

```bash
sudo apt-get install -y icecast2 liquidsoap lame madplay flac vorbis-tools ffmpeg
```

Node.js 18+ is required.

## Setup

### 1. Install & build

```bash
git clone <repo-url> /var/www/html/icecast
cd /var/www/html/icecast
npm install
npm run build
```

### 2. Configure Icecast

Edit `/etc/icecast2/icecast.xml` and set your source/admin passwords:

```xml
<source-password>your-source-password</source-password>
<admin-password>your-admin-password</admin-password>
```

Then start Icecast:

```bash
sudo service icecast2 start
```

### 3. Configure Liquidsoap

Edit `/etc/liquidsoap/icecast.liq` with the same source password:

```liquidsoap
output.icecast(
  %mp3(bitrate=128, samplerate=44100, stereo=true),
  host="localhost", port=8000, password="your-source-password",
  mount="/stream", radio
)
```

### 4. Sudoers

Allow the Node process user to start/stop Liquidsoap from the admin page:

```bash
echo "icecast ALL=(ALL) NOPASSWD: /usr/bin/liquidsoap" | sudo tee /etc/sudoers.d/icecast-liquidsoap
```

### 5. Run

```bash
npm start          # serves http://localhost:3000 (override with PORT=8080)
```

The server must keep running in the terminal. To run it detached so it survives you closing the terminal:

```bash
nohup npm start > /tmp/icecast-admin.log 2>&1 &
```

### Open the admin page

After `npm start`, open a browser and go to:

| Where you're accessing it from | URL |
|---|---|
| Same machine as the server | `http://localhost:3000/` |
| Another machine on the network | `http://<SERVER-IP>:3000/` |

The stream is at `http://<SERVER-IP>:8000/stream`. To use the standard web port `80`, set `PORT=80` (`sudo npm start`) or configure a reverse proxy (below) if Apache is already in use.

For production, run it as a service:

```
[Unit]
Description=Icecast Radio Admin
After=network.target

[Service]
WorkingDirectory=/var/www/html/icecast
ExecStart=/usr/bin/node dist/server.js
Restart=always
User=www-data

[Install]
WantedBy=multi-user.target
```

Tip: to keep serving on :80, point Apache/nginx via a reverse proxy to `localhost:3000` (because Apache already occupies port 80 on this server). Example Apache vhost for `/var/www/html/icecast`:

```apache
<VirtualHost *:80>
    ServerName icecast.local

    ProxyPreserveHost On
    ProxyPass / http://localhost:3000/
    ProxyPassReverse / http://localhost:3000/
</VirtualHost>
```

enable it with `sudo a2enmod proxy proxy_http && sudo systemctl reload apache2`. The page is then at `http://icecast.local/` (or your server IP).

### 6. Permissions

```bash
sudo chown -R www-data:www-data /var/www/html/icecast/
```

## Usage

| URL | Description |
|---|---|
| `http://your-server:3000/` | Admin page (upload, playlist, stream control) |
| `http://your-server:8000/stream` | Stream URL |

Playlist updates (add/remove songs) take effect immediately — no stream restart needed. Liquidsoap watches the playlist file via inotify.

## API

| Method | Endpoint | Body | Description |
|---|---|---|---|
| GET | `/api/state` | – | Songs, playlist, stream status, stream URLs |
| POST | `/api/upload` | `multipart/form-data` field `song[]` | Upload; non-MP3 auto-converted via ffmpeg |
| POST | `/api/playlist/add` | `{ "songs": string[] }` | Add songs to playlist |
| POST | `/api/playlist/remove` | `{ "songs": string[] }` | Remove songs from playlist |
| POST | `/api/music/delete` | `{ "songs": string[] }` | Delete files (also drops from playlist) |
| POST | `/api/stream/start` | – | Start Liquidsoap |
| POST | `/api/stream/stop` | – | Stop Liquidsoap |

## Configuration (environment variables)

| Variable | Default |
|---|---|
| `PORT` | `3000` |
| `MUSIC_DIR` | `{repo}/music` |
| `PLAYLIST_FILE` | `{repo}/playlists/playlist.m3u` |
| `LS_PID_FILE` | `/tmp/liquidsoap.pid` |
| `LIQ_SCRIPT` | `/etc/liquidsoap/icecast.liq` |
| `ICECAST_PORT` | `8000` |

## Directory structure

```
/var/www/html/icecast/
├── index.html          # Static demo of the UI (GitHub Pages showcase)
├── .nojekyll           # Disables Jekyll on GitHub Pages
├── setup.sh            # One-shot install: icecast2 + liquidsoap + config
├── src/
│   ├── server.ts       # Express API
│   └── icecast.ts      # Core logic (playlist, uploads, stream control)
├── public/
│   ├── index.html      # Admin page
│   ├── app.ts          # Frontend (compiles to app.js)
│   └── style.css
├── dist/               # Compiled backend (generated by npm run build)
├── music/              # Uploaded MP3 files
└── playlists/
    └── playlist.m3u    # Active playlist
```

## License

MIT