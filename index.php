<?php
$musicDir = __DIR__ . '/music';
$playlistFile = __DIR__ . '/playlists/playlist.m3u';
$lsPidFile = '/tmp/liquidsoap.pid';
$host = $_SERVER['HTTP_HOST'] ?? 'localhost';
$hostname = parse_url("http://$host", PHP_URL_HOST);
$streamUrl = "http://{$hostname}:8000/stream";

function isStreamRunning() {
    $pid = @file_get_contents('/tmp/liquidsoap.pid');
    if ($pid && is_numeric(trim($pid))) {
        $pid = trim($pid);
        if (file_exists("/proc/$pid")) return true;
    }
    exec("pgrep -x liquidsoap 2>/dev/null", $out, $rc);
    return $rc === 0 && !empty($out);
}

function getSongs() {
    $exts = ['mp3','ogg','wav','aac','flac','m4a'];
    $list = [];
    $dir = opendir(__DIR__ . '/music');
    if ($dir) {
        while (($f = readdir($dir)) !== false) {
            if ($f === '.' || $f === '..') continue;
            $ext = strtolower(pathinfo($f, PATHINFO_EXTENSION));
            if (in_array($ext, $exts)) {
                $list[] = $f;
            }
        }
        closedir($dir);
    }
    sort($list);
    return $list;
}

function getPlaylist() {
    $file = __DIR__ . '/playlists/playlist.m3u';
    $entries = [];
    if (file_exists($file)) {
        $lines = file($file, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
        foreach ($lines as $line) {
            $line = trim($line);
            if ($line && $line[0] !== '#') {
                $entries[] = basename($line);
            }
        }
    }
    return $entries;
}

function formatSize($bytes) {
    if ($bytes >= 1073741824) return number_format($bytes / 1073741824, 2) . ' GB';
    if ($bytes >= 1048576) return number_format($bytes / 1048576, 2) . ' MB';
    if ($bytes >= 1024) return number_format($bytes / 1024, 2) . ' KB';
    return $bytes . ' B';
}

$message = '';
$isAjax = ($_SERVER['HTTP_X_REQUESTED_WITH'] ?? '') === 'XMLHttpRequest';

if ($_POST['action'] ?? null) {
    $action = $_POST['action'];

    if ($action === 'upload' && !empty($_FILES['song']['name'][0])) {
        $allowed = ['mp3', 'ogg', 'wav', 'aac', 'flac', 'm4a'];
        $converted = 0; $uploaded = 0;
        foreach ($_FILES['song']['tmp_name'] as $i => $tmp) {
            if ($_FILES['song']['error'][$i] !== UPLOAD_ERR_OK) continue;
            $origName = basename($_FILES['song']['name'][$i]);
            $ext = strtolower(pathinfo($origName, PATHINFO_EXTENSION));
            if (!in_array($ext, $allowed)) continue;
            if ($ext === 'mp3') {
                $dest = $musicDir . '/' . $origName;
                if (move_uploaded_file($tmp, $dest)) $uploaded++;
            } else {
                $outName = pathinfo($origName, PATHINFO_FILENAME) . '.mp3';
                $dest = $musicDir . '/' . $outName;
                $i = 1;
                while (file_exists($dest)) {
                    $dest = $musicDir . '/' . pathinfo($origName, PATHINFO_FILENAME) . "_{$i}.mp3";
                    $i++;
                }
                exec("ffmpeg -i " . escapeshellarg($tmp) . " -c:a libmp3lame -b:a 128k -y " . escapeshellarg($dest) . " 2>/dev/null", $ffOut, $rc);
                if ($rc === 0) $converted++;
            }
        }
        if ($uploaded) $message = "$uploaded MP3 file(s) uploaded.";
        if ($converted) $message = ($uploaded ? "$uploaded MP3 file(s) uploaded, " : '') . "$converted file(s) converted to MP3.";
        if (!$uploaded && !$converted) $message = 'No files were processed.';
    }

    if ($action === 'add_to_playlist' && !empty($_POST['songs'])) {
        $pl = getPlaylist();
        $existing = array_flip($pl);
        foreach ($_POST['songs'] as $song) {
            $path = $musicDir . '/' . basename($song);
            if (file_exists($path) && !isset($existing[$song])) {
                $pl[] = $song;
                $existing[$song] = true;
            }
        }
        $content = "#EXTM3U\n";
        foreach ($pl as $entry) {
            $content .= $musicDir . '/' . $entry . "\n";
        }
        file_put_contents($playlistFile, $content);
        $message = 'Songs added to playlist.';
    }

    if ($action === 'remove_from_playlist' && !empty($_POST['songs'])) {
        $pl = getPlaylist();
        $remove = array_flip($_POST['songs']);
        $pl = array_filter($pl, fn($s) => !isset($remove[$s]));
        $content = "#EXTM3U\n";
        foreach ($pl as $entry) {
            $content .= $musicDir . '/' . $entry . "\n";
        }
        file_put_contents($playlistFile, $content);
        $message = 'Songs removed from playlist.';
    }

    if ($action === 'start_stream') {
        if (!isStreamRunning()) {
            $pidFile = '/tmp/liquidsoap.pid';
            $cmd = "nohup liquidsoap /etc/liquidsoap/icecast.liq > /dev/null 2>&1 & echo \$! > $pidFile";
            exec($cmd);
            usleep(2000000);
            if (isStreamRunning()) {
                $message = 'Stream started.';
            } else {
                $message = 'Failed to start stream.';
            }
        } else {
            $message = 'Stream is already running.';
        }
    }

    if ($action === 'stop_stream') {
        if (isStreamRunning()) {
            $pid = trim(@file_get_contents('/tmp/liquidsoap.pid'));
            if ($pid) exec("kill $pid 2>/dev/null");
            exec("pkill -x liquidsoap 2>/dev/null");
            usleep(1000000);
            $message = 'Stream stopped.';
        } else {
            $message = 'Stream is not running.';
        }
    }

    if ($action === 'delete_songs' && !empty($_POST['songs'])) {
        $pl = getPlaylist();
        $plSongs = array_flip($pl);
        foreach ($_POST['songs'] as $song) {
            $path = $musicDir . '/' . basename($song);
            if (file_exists($path)) {
                unlink($path);
                if (isset($plSongs[$song])) {
                    $pl = array_filter($pl, fn($s) => $s !== $song);
                }
            }
        }
        $content = "#EXTM3U\n";
        foreach ($pl as $entry) {
            $content .= $musicDir . '/' . $entry . "\n";
        }
        file_put_contents($playlistFile, $content);
        $message = 'Songs deleted.';
    }
}

$songs = getSongs();
$playlist = getPlaylist();
$running = isStreamRunning();
$totalSongs = count($songs);
$playlistCount = count($playlist);

function renderContent($message, $songs, $playlist, $running, $totalSongs, $playlistCount, $musicDir, $streamUrl, $hostname) {
    ob_start(); ?>
    <?php if ($message): ?>
    <div class="msg"><?= htmlspecialchars($message) ?></div>
    <?php endif; ?>

    <div class="stats-row">
        <div class="stat-box"><div class="num"><?= $totalSongs ?></div><div class="lbl">Songs Library</div></div>
        <div class="stat-box"><div class="num"><?= $playlistCount ?></div><div class="lbl">Playlist</div></div>
        <div class="stat-box"><div class="num"><?= $running ? 'Live' : 'Off' ?></div><div class="lbl">Stream</div></div>
    </div>

    <div class="grid-2">
        <div class="card">
            <h2>Upload Songs</h2>
            <form method="post" enctype="multipart/form-data">
                <input type="hidden" name="action" value="upload">
                <div class="upload-row">
                    <input type="file" name="song[]" multiple accept=".mp3,.ogg,.wav,.aac,.flac,.m4a,.wma,.aiff" required>
                    <button type="submit" class="btn btn-primary btn-sm">Upload</button>
                </div>
            </form>
        </div>
        <div class="card">
            <h2>Stream Control</h2>
            <div class="stream-actions">
                <?php if ($running): ?>
                <form method="post" style="display:inline"><input type="hidden" name="action" value="stop_stream"><button type="submit" class="btn btn-danger">Stop Stream</button></form>
                <?php else: ?>
                <form method="post" style="display:inline"><input type="hidden" name="action" value="start_stream"><button type="submit" class="btn btn-primary" <?= $playlistCount === 0 ? 'disabled style="opacity:.5"' : '' ?>>Start Stream</button></form>
                <?php endif; ?>
                <a href="http://<?= htmlspecialchars($hostname) ?>:8000" target="_blank" class="btn btn-secondary">Icecast Status</a>
            </div>
            <?php if ($playlistCount === 0): ?>
            <p style="color:#888;font-size:13px;">Add songs to the playlist before starting.</p>
            <?php endif; ?>
        </div>
    </div>

    <div class="grid-2">
        <div class="card">
            <h2>Music Library <span>(<?= $totalSongs ?>)</span></h2>
            <?php if (empty($songs)): ?>
            <p style="color:#666;font-size:14px;">No songs uploaded yet.</p>
            <?php else: ?>
            <form method="post" id="lib-form">
            <input type="hidden" name="action" id="lib-action" value="">
            <table>
                <thead><tr><th></th><th>File</th><th>Size</th></tr></thead>
                <tbody>
                <?php foreach ($songs as $song):
                    $size = formatSize(filesize($musicDir . '/' . $song));
                    $inPl = in_array($song, $playlist);
                ?>
                <tr>
                    <td><input type="checkbox" name="songs[]" value="<?= htmlspecialchars($song) ?>"></td>
                    <td><?= htmlspecialchars($song) ?></td>
                    <td class="size"><?= $size ?></td>
                </tr>
                <?php endforeach; ?>
                </tbody>
            </table>
            <div style="display:flex;gap:8px;margin-top:10px;">
                <button type="submit" class="btn btn-primary btn-sm" onclick="document.getElementById('lib-action').value='add_to_playlist'">Add to Playlist</button>
                <button type="submit" class="btn btn-danger btn-sm" onclick="if(!confirm('Delete selected songs?'))return false;document.getElementById('lib-action').value='delete_songs'">Delete</button>
            </div>
            </form>
            <?php endif; ?>
        </div>

        <div class="card">
            <h2>Playlist <span>(<?= $playlistCount ?>)</span></h2>
            <?php if (empty($playlist)): ?>
            <p style="color:#666;font-size:14px;">Playlist is empty.</p>
            <?php else: ?>
            <form method="post" id="pl-form">
            <input type="hidden" name="action" value="remove_from_playlist">
            <table>
                <thead><tr><th></th><th>#</th><th>Song</th></tr></thead>
                <tbody>
                <?php foreach ($playlist as $i => $song): ?>
                <tr>
                    <td><input type="checkbox" name="songs[]" value="<?= htmlspecialchars($song) ?>"></td>
                    <td style="color:#666"><?= $i + 1 ?></td>
                    <td><?= htmlspecialchars($song) ?></td>
                </tr>
                <?php endforeach; ?>
                </tbody>
            </table>
            <div style="margin-top:10px;">
                <button type="submit" class="btn btn-danger btn-sm">Remove Selected</button>
            </div>
            </form>
            <?php endif; ?>
        </div>
    </div>

    <div style="text-align:center;margin-top:30px;padding:20px;color:#444;font-size:12px;">
        Icecast Radio Admin &mdash; Powered by Icecast2 + Liquidsoap
    </div>
<?php return ob_get_clean();
}

$contentHtml = renderContent($message, $songs, $playlist, $running, $totalSongs, $playlistCount, $musicDir, $streamUrl, $hostname);

if ($isAjax) {
    echo $contentHtml;
    exit;
}
?>
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Icecast Radio Admin</title>
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0f0f0f; color: #e0e0e0; min-height: 100vh; }
.container { max-width: 1100px; margin: 0 auto; padding: 20px; }
.header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 30px; padding-bottom: 20px; border-bottom: 1px solid #2a2a2a; }
.header h1 { font-size: 24px; color: #fff; }
.header h1 span { color: #00d4aa; }

.btn { display: inline-flex; align-items: center; gap: 6px; padding: 8px 18px; border: none; border-radius: 6px; font-size: 14px; cursor: pointer; text-decoration: none; transition: all .2s; }
.btn-primary { background: #00d4aa; color: #000; }
.btn-primary:hover { background: #00b894; }
.btn-danger { background: #e74c3c; color: #fff; }
.btn-danger:hover { background: #c0392b; }
.btn-warning { background: #f39c12; color: #000; }
.btn-warning:hover { background: #d68910; }
.btn-secondary { background: #333; color: #e0e0e0; }
.btn-secondary:hover { background: #444; }
.btn-sm { padding: 5px 12px; font-size: 12px; }
.card { background: #1a1a1a; border-radius: 10px; padding: 20px; margin-bottom: 20px; border: 1px solid #2a2a2a; }
.card h2 { font-size: 16px; color: #888; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 15px; }
.card h2 span { color: #e0e0e0; font-weight: 400; text-transform: none; letter-spacing: 0; }
.grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 15px; }
table { width: 100%; border-collapse: collapse; }
th, td { text-align: left; padding: 10px 8px; border-bottom: 1px solid #2a2a2a; font-size: 14px; }
th { color: #888; font-weight: 600; text-transform: uppercase; font-size: 11px; letter-spacing: .5px; }
tr:hover td { background: #222; }
td:first-child { width: 30px; }
td.size { color: #666; white-space: nowrap; }
input[type="file"]::file-selector-button { background: #333; color: #e0e0e0; border: 1px solid #444; padding: 6px 14px; border-radius: 4px; cursor: pointer; }
input[type="file"]::file-selector-button:hover { background: #444; }
.upload-row { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
.upload-row input[type="file"] { flex: 1; min-width: 200px; color: #e0e0e0; }
.msg { background: #00d4aa22; border: 1px solid #00d4aa44; color: #00d4aa; padding: 10px 16px; border-radius: 6px; margin-bottom: 20px; font-size: 14px; }
.stats-row { display: flex; gap: 20px; margin-bottom: 15px; flex-wrap: wrap; }
.stat-box { background: #222; border-radius: 6px; padding: 12px 18px; min-width: 120px; }
.stat-box .num { font-size: 22px; font-weight: 700; color: #00d4aa; }
.stat-box .lbl { font-size: 11px; color: #666; text-transform: uppercase; letter-spacing: .5px; margin-top: 2px; }
.player-wrap { margin-top: 15px; }
.player-wrap audio { width: 100%; }
.stream-actions { display: flex; gap: 10px; flex-wrap: wrap; margin-bottom: 10px; }
@media (max-width: 768px) { .grid-2 { grid-template-columns: 1fr; } }
</style>
</head>
<body>
<div id="top-section">
<div class="container">
    <div class="header">
        <h1>icecast<span>radio</span></h1>
    </div>

    <?php if ($running): ?>
    <div class="card player-wrap" style="text-align:center;">
        <audio id="player" style="display:none">
            <source src="<?= htmlspecialchars($streamUrl) ?>" type="audio/mpeg">
        </audio>
        <div style="display:flex;align-items:center;justify-content:center;gap:15px;flex-wrap:wrap;">
            <button type="button" id="playBtn" class="btn btn-primary" style="font-size:16px;padding:10px 30px;" onclick="togglePlay()">Play</button>
            <div style="display:flex;align-items:center;gap:8px;">
                <span style="color:#888;font-size:13px;">Vol</span>
                <input type="range" id="volControl" min="0" max="100" value="80" oninput="setVolume(this.value)" style="width:100px;accent-color:#00d4aa;">
            </div>
        </div>
        <p style="color:#666;font-size:12px;margin-top:8px;">Stream URL: <a href="<?= htmlspecialchars($streamUrl) ?>" style="color:#00d4aa;"><?= htmlspecialchars($streamUrl) ?></a></p>
    </div>
    <script>
    var player = document.getElementById('player');
    player.volume = 0.8;
    function togglePlay() {
        var b = document.getElementById('playBtn');
        if (player.paused) {
            player.play();
            b.textContent = 'Stop';
            b.className = 'btn btn-danger';
        } else {
            player.pause();
            b.textContent = 'Play';
            b.className = 'btn btn-primary';
        }
    }
    function setVolume(val) {
        player.volume = val / 100;
    }
    </script>
    <?php endif; ?>
</div>
</div>

<div id="content-section">
<div class="container">
<?= $contentHtml ?>
</div>
</div>

<script>
(function() {
    function ajaxSubmit(form) {
        var formData = new FormData(form);
        fetch('', { method: 'POST', body: formData, headers: { 'X-Requested-With': 'XMLHttpRequest' } })
            .then(function(r) {
                if (!r.ok) throw new Error('HTTP ' + r.status);
                return r.text();
            })
            .then(function(html) {
                var el = document.getElementById('content-section');
                el.innerHTML = '<div class="container">' + html + '</div>';
                attachForms();
                var fi = el.querySelector('.upload-row input[type=file]');
                if (fi) fi.value = '';
            })
            .catch(function(err) {
                alert('Request failed: ' + err.message);
            });
    }

    function attachForms() {
        document.querySelectorAll('#content-section form').forEach(function(f) {
            f.onsubmit = function(e) {
                e.preventDefault();
                ajaxSubmit(f);
            };
        });
    }

    attachForms();
})();
</script>
</body>
</html>
