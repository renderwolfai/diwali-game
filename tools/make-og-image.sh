#!/bin/sh
# Builds assets/og-image.jpg, the 1200x630 link-preview image referenced by the og:/twitter: tags in index.html.
# Needs ImageMagick (`magick`) and Google Chrome (renders the bow overlay from tools/og-overlay.html).
set -e
cd "$(dirname "$0")/.."
CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
FONT="${FONT:-/System/Library/Fonts/Supplemental/Arial Rounded Bold.ttf}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

"$CHROME" --headless --disable-gpu --hide-scrollbars --default-background-color=00000000 \
  --window-size=1200,630 --screenshot="$TMP/overlay.png" "file://$PWD/tools/og-overlay.html" 2>/dev/null

cd assets
magick bg_wide.jpg -resize 1200x630^ -gravity center -extent 1200x630 \
  \( -size 1200x630 radial-gradient:'rgba(11,7,38,0.15)'-'rgba(11,7,38,0.75)' \) -composite \
  \( demon_red.png -resize 170x170 \) -gravity northwest -geometry +95+95 -composite \
  \( demon_orange.png -resize 150x150 \) -geometry +300+60 -composite \
  \( demon_yellow.png -resize 160x160 \) -geometry +495+85 -composite \
  \( demon_green.png -resize 150x150 \) -geometry +695+55 -composite \
  \( demon_blue.png -resize 165x165 \) -geometry +880+90 -composite \
  \( demon_purple.png -resize 130x130 \) -geometry +1040+215 -composite \
  "$TMP/overlay.png" -geometry +0+0 -composite \
  -font "$FONT" -gravity center -pointsize 88 \
  -fill '#2a0f00' -annotate +114+104 'Diwali Demon Pop' \
  -fill '#ffc93c' -stroke '#7a2e00' -strokewidth 3 -annotate +110+100 'Diwali Demon Pop' \
  -stroke none -pointsize 34 -fill white -annotate +110+185 'Pop the demons. Light up the night.' \
  -quality 85 og-image.jpg
echo "wrote assets/og-image.jpg"
