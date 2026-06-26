#!/usr/bin/env bash
# Package Irishka Community from extensiones-chrome repo → zip + public/community/ for Railway.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
COMMUNITY_SRC="${COMMUNITY_SRC:-/home/nicolas/proyectos-sbs/extensiones-chrome/irishka-group-master-1.1.29-community}"
PUBLIC_DIR="${ROOT}/license-server/public/community"
DIST="${ROOT}/irishka/dist"
OUT_ZIP="${DIST}/COMMUNITY.zip"
OUT_DIR="${DIST}/COMMUNITY"
PKG="COMMUNITY"
PUBLISH_TO_SERVER="${PUBLISH_TO_SERVER:-0}"

if [[ ! -f "${COMMUNITY_SRC}/manifest.json" ]]; then
  echo "Missing ${COMMUNITY_SRC}/manifest.json — set COMMUNITY_SRC" >&2
  exit 1
fi

VER="$(grep -m1 '"version"' "${COMMUNITY_SRC}/manifest.json" | sed -E 's/.*"version"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/')"
if [[ -z "$VER" ]]; then
  echo "Could not parse version from manifest.json" >&2
  exit 1
fi

STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

mkdir -p "$STAGE/$PKG/src" "$STAGE/$PKG/icons"
cp "${COMMUNITY_SRC}/manifest.json" "$STAGE/$PKG/"
cp "${COMMUNITY_SRC}/app.html" "${COMMUNITY_SRC}/popup.html" "${COMMUNITY_SRC}/legal.html" "$STAGE/$PKG/"
cp "${COMMUNITY_SRC}/icons/"*.png "$STAGE/$PKG/icons/"
cp -a "${COMMUNITY_SRC}/src/." "$STAGE/$PKG/src/"

mkdir -p "$DIST"
rm -f "$OUT_ZIP"
(cd "$STAGE" && zip -qr "$OUT_ZIP" "$PKG")
rm -rf "$OUT_DIR"
cp -a "$STAGE/$PKG" "$OUT_DIR"

if [[ "$PUBLISH_TO_SERVER" == "1" ]]; then
  mkdir -p "$PUBLIC_DIR"
  cp -f "$OUT_ZIP" "${PUBLIC_DIR}/COMMUNITY.zip"
  cat > "${PUBLIC_DIR}/version.json" <<EOF
{"version":"${VER}","package":"COMMUNITY","updatedAt":"$(date -u +%Y-%m-%dT%H:%M:%SZ)"}
EOF
  echo "Published ${PUBLIC_DIR}/COMMUNITY.zip (server deploy only)"
fi

echo "Created ${OUT_ZIP} (v${VER})"
echo "Folder: ${OUT_DIR}/"
echo "Distribución manual: copiá COMMUNITY/ o el zip por AnyDesk/USB."
