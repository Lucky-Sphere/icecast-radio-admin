# Icecast Radio Station

Single-page PHP admin interface to manage an Icecast2 radio station with playlist management, song uploads (auto-converted to MP3), and a Liquidsoap streaming backend with seamless playlist reloading.

## Dependencies

```bash
sudo apt-get install -y icecast2 liquidsoap lame madplay flac vorbis-tools ffmpeg php php-mbstring php-xml apache2
```

## Setup

### 1. Clone the repo

```bash
git clone <repo-url> /var/www/html/icecast
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

Allow `www-data` to start/stop Liquidsoap from the admin page:

```bash
echo "www-data ALL=(ALL) NOPASSWD: /usr/bin/liquidsoap" | sudo tee /etc/sudoers.d/www-data-liquidsoap
```

### 5. PHP upload limits

Create `/etc/php/8.3/apache2/conf.d/99-icecast.ini`:

```ini
upload_max_filesize = 100M
post_max_size = 100M
```

```bash
sudo systemctl restart apache2
```

### 6. Permissions

```bash
sudo chown -R www-data:www-data /var/www/html/icecast/
```

## Usage

| URL | Description |
|---|---|
| `http://your-server/icecast/` | Admin page (upload, playlist, stream control) |
| `http://your-server:8000/stream` | Stream URL |

Playlist updates (add/remove songs) take effect immediately — no stream restart needed. Liquidsoap watches the playlist file via inotify.

## Directory structure

```
/var/www/html/icecast/
├── index.php          # Admin interface
├── music/             # Uploaded MP3 files
└── playlists/
    └── playlist.m3u   # Active playlist

/etc/liquidsoap/
└── icecast.liq        # Liquidsoap script
```

## License

MIT
