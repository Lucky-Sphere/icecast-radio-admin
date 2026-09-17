#!/usr/bin/env bash
# One-shot setup: install Icecast2 + Liquidsoap and wire up the radio stream.
# Run as:  sudo bash setup.sh
set -euo pipefail

STREAM_PASSWORD="${STREAM_PASSWORD:-hackme}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-hackme}"
APP_DIR="/var/www/html/icecast"
LIQ_SCRIPT="/etc/liquidsoap/icecast.liq"
ICECAST_XML="/etc/icecast2/icecast.xml"

echo "==> Installing icecast2 and liquidsoap..."
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y icecast2 liquidsoap

echo "==> Writing Liquidsoap config: $LIQ_SCRIPT"
mkdir -p /etc/liquidsoap
cat > "$LIQ_SCRIPT" <<EOF
radio = mksafe(playlist("$APP_DIR/playlists/playlist.m3u"))
output.icecast(
  %mp3(bitrate=128, samplerate=44100, stereo=true),
  host="localhost", port=8000, password="$STREAM_PASSWORD",
  mount="/stream", radio
)
EOF

echo "==> Setting Icecast passwords in $ICECAST_XML"
if [ -f "$ICECAST_XML" ]; then
  sed -i "s|<source-password>.*</source-password>|<source-password>$STREAM_PASSWORD</source-password>|" "$ICECAST_XML"
  sed -i "s|<admin-password>.*</admin-password>|<admin-password>$ADMIN_PASSWORD</admin-password>|" "$ICECAST_XML"
  sed -i 's|<hostname>.*</hostname>|<hostname>localhost</hostname>|' "$ICECAST_XML"
else
  echo "WARNING: $ICECAST_XML not found - configure it manually with the source password '$STREAM_PASSWORD'"
fi

echo "==> Enabling and starting Icecast..."
sed -i 's|ENABLE=.*|ENABLE=true|' /etc/default/icecast2 2>/dev/null || true
systemctl enable icecast2 2>/dev/null || true
systemctl restart icecast2

echo "==> Done."
echo "    Open the admin page and click 'Start Stream'."
echo "    Stream: http://<server-ip>:8000/stream"
echo "    Icecast status: http://<server-ip>:8000/"