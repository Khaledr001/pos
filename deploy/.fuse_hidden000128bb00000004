#!/usr/bin/env bash
# =============================================================================
# DevsFleet POS — manual terminal release (build, package, publish).
#
#   ./deploy/release-pos.sh              # build, package, confirm, upload
#   ./deploy/release-pos.sh --yes        # skip the confirmation prompt
#   ./deploy/release-pos.sh --skip-build # re-upload an existing apps/pos/release/
#                                         # (e.g. retrying after a failed upload)
#
# The manual counterpart to .github/workflows/pos-release.yml — same build,
# same env var, same target directory, run from your own machine instead of
# a tag push.
#
# Only builds installers for the OS you run this ON. electron-builder defaults
# to the current platform and this script does not attempt Wine or any other
# cross-compilation — run it on Linux for AppImage/deb, on Windows for the
# NSIS .exe, on macOS for the .dmg.
#
# Bump the version in apps/pos/package.json yourself before running this —
# electron-updater on every till compares against whatever version this
# script's build produces, and a re-upload of the same version number is
# invisible to them.
# =============================================================================
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO"

SKIP_BUILD=0
ASSUME_YES=0
for arg in "$@"; do
  case "$arg" in
    --skip-build) SKIP_BUILD=1 ;;
    --yes|-y)     ASSUME_YES=1 ;;
    *) echo "unknown flag: $arg" >&2; exit 2 ;;
  esac
done

say() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
die() { printf '\n\033[1;31mSTOPPED: %s\033[0m\n' "$*" >&2; exit 1; }

# -----------------------------------------------------------------------------
# Configuration — override any of these as env vars if your setup differs.
# Same defaults as .github/workflows/pos-release.yml and deploy/deploy.sh.
# -----------------------------------------------------------------------------
VITE_API_URL="${VITE_API_URL:-https://api.devsfleet.com/api/v1}"
SSH_HOST="${SSH_HOST:-163.227.50.195}"
SSH_USER="${SSH_USER:-root}"
RELEASE_DIR="${RELEASE_DIR:-/var/www/devsfleet-pos-releases}"
FEED_URL="${FEED_URL:-https://pos.devsfleet.com/pos-dl}"

RELEASE_OUT="apps/pos/release"

say "Preflight"
command -v pnpm >/dev/null || die "pnpm is not on PATH"
command -v node >/dev/null || die "node is not on PATH (nvm installs are often missing from a non-interactive shell's PATH — see CLAUDE.md)"
command -v scp  >/dev/null || die "scp is not on PATH"
ssh -o BatchMode=yes -o ConnectTimeout=5 "$SSH_USER@$SSH_HOST" true 2>/dev/null \
  || die "cannot reach $SSH_USER@$SSH_HOST over SSH — check your key/agent before continuing"

VERSION="$(node -p "require('./apps/pos/package.json').version")"
echo "    apps/pos/package.json version: $VERSION"
echo "    VITE_API_URL:                  $VITE_API_URL"
echo "    target:                        $SSH_USER@$SSH_HOST:$RELEASE_DIR"

if [ "$SKIP_BUILD" = 0 ]; then
  say "Building POS and its workspace dependencies"
  # VITE_API_URL is inlined into the renderer bundle right here, by `vite
  # build` — not read at runtime. See the comment at the top of
  # apps/pos/src/lib/api-client.ts: this is what the pairing screen on a
  # brand-new till uses for its admin login and device-creation calls, before
  # any device exists to read a URL from any other way. A wrong value here
  # means rebuilding this installer, not reconfiguring a till after the fact.
  VITE_API_URL="$VITE_API_URL" pnpm --filter=@devsfleet/pos... build

  say "Packaging the installer for $(uname -s)"
  # --publish never: nothing here has a credential to push anywhere.
  # electron-builder still writes latest*.yml locally because `publish` is
  # configured in electron-builder.yml — the scp below is the actual upload.
  ( cd apps/pos && pnpm exec electron-builder --publish never )
else
  say "Skipping build — reusing whatever is already in $RELEASE_OUT"
  [ -d "$RELEASE_OUT" ] || die "$RELEASE_OUT does not exist — drop --skip-build and build first"
fi

# -----------------------------------------------------------------------------
# Collect whatever this platform actually produced. A native build only ever
# writes one OS's files, so most of these globs match nothing — that's
# expected, not an error.
# -----------------------------------------------------------------------------
say "Collecting build artifacts"
shopt -s nullglob
ARTIFACTS=(
  "$RELEASE_OUT"/*.exe "$RELEASE_OUT"/*.exe.blockmap
  "$RELEASE_OUT"/*.AppImage "$RELEASE_OUT"/*.deb
  "$RELEASE_OUT"/*.dmg "$RELEASE_OUT"/*.dmg.blockmap
  "$RELEASE_OUT"/latest.yml "$RELEASE_OUT"/latest-linux.yml "$RELEASE_OUT"/latest-mac.yml
)
shopt -u nullglob

[ "${#ARTIFACTS[@]}" -gt 0 ] || die "no installer or manifest found in $RELEASE_OUT — did the build actually run?"

echo "    Found:"
for f in "${ARTIFACTS[@]}"; do echo "      $(basename "$f")"; done

# -----------------------------------------------------------------------------
if [ "$ASSUME_YES" = 0 ]; then
  printf '\nUpload v%s to %s — live for every paired till'"'"'s auto-updater? [y/N] ' \
    "$VERSION" "$FEED_URL"
  read -r reply
  case "$reply" in
    y|Y|yes|YES) ;;
    *) die "Cancelled — nothing was uploaded." ;;
  esac
fi

say "Uploading to $SSH_USER@$SSH_HOST:$RELEASE_DIR"
scp "${ARTIFACTS[@]}" "$SSH_USER@$SSH_HOST:$RELEASE_DIR/"

say "Verifying"
for manifest in latest.yml latest-linux.yml latest-mac.yml; do
  [ -f "$RELEASE_OUT/$manifest" ] || continue
  code="$(curl -fsS -o /dev/null -w '%{http_code}' "$FEED_URL/$manifest" || echo "000")"
  if [ "$code" = "200" ]; then
    echo "    $manifest -> $FEED_URL/$manifest  OK"
  else
    die "$manifest uploaded but $FEED_URL/$manifest returned $code — check the nginx /pos-dl/ block"
  fi
done

printf '\n\033[1;32mPublished v%s.\033[0m  %s\n' "$VERSION" "$FEED_URL"
printf 'Reminder: this uploaded whatever version was already in apps/pos/package.json.\n'
printf 'If you meant this to be a new version, bump it, commit, and re-run.\n\n'
