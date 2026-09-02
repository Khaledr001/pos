#!/usr/bin/env bash
# =============================================================================
# DevsFleet POS — manual terminal release (build, package, publish).
#
# Runs ON THE VPS ITSELF: builds the POS app on this machine and copies the
# result straight into the directory nginx already serves at
# https://pos.devsfleet.com/pos-dl/ — no SSH/scp involved, because there is
# nowhere else to send it to.
#
#   ./deploy/release-pos.sh              # pull, build, package, confirm, copy
#   ./deploy/release-pos.sh --no-pull    # build the working tree as-is
#   ./deploy/release-pos.sh --yes        # skip the confirmation prompt
#   ./deploy/release-pos.sh --skip-build # re-copy an existing apps/pos/release/
#                                         # (e.g. retrying after a failed copy)
#
# IMPORTANT — this only ever produces what THIS machine can build natively.
# electron-builder defaults to the current platform and this script does not
# attempt Wine or any other cross-compilation. If the VPS is Linux (the usual
# case), running this here produces the AppImage/.deb ONLY — never the
# Windows .exe or macOS .dmg. For those, build on a Windows/macOS machine (or
# use .github/workflows/pos-release.yml, which builds all of them on native
# runners) and drop the result into RELEASE_DIR by hand, or just run
# release-pos.sh again on that other machine with RELEASE_DIR pointed at
# this same path over a mount/share.
#
# Bump the version in apps/pos/package.json yourself before running this —
# electron-updater on every till compares against whatever version this
# script's build produces, and a re-copy of the same version number is
# invisible to them.
# =============================================================================
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO"

PULL=1
SKIP_BUILD=0
ASSUME_YES=0
for arg in "$@"; do
  case "$arg" in
    --no-pull)    PULL=0 ;;
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
VITE_API_URL="${VITE_API_URL:-https://pos-api.devsfleet.com/api/v1}"
RELEASE_DIR="${RELEASE_DIR:-/var/www/devsfleet-pos-releases}"
FEED_URL="${FEED_URL:-https://pos.devsfleet.com/pos-dl}"

RELEASE_OUT="apps/pos/release"

say "Preflight"
command -v pnpm >/dev/null || die "pnpm is not on PATH"
command -v node >/dev/null || die "node is not on PATH"
command -v curl >/dev/null || die "curl is not on PATH"
[ -d "$RELEASE_DIR" ] || die "$RELEASE_DIR does not exist — create it and chown it to this user first (see docs/DEPLOYMENT.md)"
[ -w "$RELEASE_DIR" ] || die "$RELEASE_DIR is not writable by $(whoami) — chown it to this user first"

if [ "$PULL" = 1 ]; then
  say "Pulling"
  git pull --ff-only
fi

VERSION="$(node -p "require('./apps/pos/package.json').version")"
echo "    apps/pos/package.json version: $VERSION"
echo "    VITE_API_URL:                  $VITE_API_URL"
echo "    building for:                  $(uname -s)"
echo "    target directory:              $RELEASE_DIR"

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
  # configured in electron-builder.yml — the copy below is the actual publish.
  ( cd apps/pos && pnpm exec electron-builder --publish never )
else
  say "Skipping build — reusing whatever is already in $RELEASE_OUT"
  [ -d "$RELEASE_OUT" ] || die "$RELEASE_OUT does not exist — drop --skip-build and build first"
fi

# -----------------------------------------------------------------------------
# Collect whatever this platform actually produced. A native build only ever
# writes one OS's files, so most of these candidates match nothing — that's
# expected, not an error. On a Linux VPS, expect only the AppImage/deb/
# latest-linux.yml lines below to ever be real.
#
# Checked with `-f` explicitly rather than trusting `nullglob` alone:
# nullglob only discards a WILDCARD pattern that matched nothing — the three
# literal `latest*.yml` filenames below have no wildcard in them, so bash
# never treats them as unmatched globs and keeps them in the array even when
# the file does not exist, only for `cp` to fail on them afterwards.
# -----------------------------------------------------------------------------
say "Collecting build artifacts"
shopt -s nullglob
CANDIDATES=(
  "$RELEASE_OUT"/*.exe "$RELEASE_OUT"/*.exe.blockmap
  "$RELEASE_OUT"/*.AppImage "$RELEASE_OUT"/*.deb
  "$RELEASE_OUT"/*.dmg "$RELEASE_OUT"/*.dmg.blockmap
  "$RELEASE_OUT/latest.yml" "$RELEASE_OUT/latest-linux.yml" "$RELEASE_OUT/latest-mac.yml"
)
shopt -u nullglob

ARTIFACTS=()
for f in "${CANDIDATES[@]}"; do
  [ -f "$f" ] && ARTIFACTS+=("$f")
done

[ "${#ARTIFACTS[@]}" -gt 0 ] || die "no installer or manifest found in $RELEASE_OUT — did the build actually run?"

echo "    Found:"
for f in "${ARTIFACTS[@]}"; do echo "      $(basename "$f")"; done

# -----------------------------------------------------------------------------
if [ "$ASSUME_YES" = 0 ]; then
  printf '\nPublish v%s to %s — live for every paired till'"'"'s auto-updater? [y/N] ' \
    "$VERSION" "$FEED_URL"
  read -r reply
  case "$reply" in
    y|Y|yes|YES) ;;
    *) die "Cancelled — nothing was published." ;;
  esac
fi

say "Copying into $RELEASE_DIR"
cp -f "${ARTIFACTS[@]}" "$RELEASE_DIR/"

say "Verifying"
for manifest in latest.yml latest-linux.yml latest-mac.yml; do
  [ -f "$RELEASE_OUT/$manifest" ] || continue
  # `|| true`, not `|| echo "000"`: curl's own -w already prints "000" when it
  # never got an HTTP response at all (DNS failure, refused, etc.) — an
  # `echo "000"` fallback INSIDE the substitution stacks a second "000" onto
  # what curl already wrote. But curl still exits non-zero in that case, and
  # under `set -e` an assignment's exit status IS the command substitution's
  # exit status — without `|| true` out here, a connection failure kills the
  # whole script right on this line, before the die message below ever runs.
  code="$(curl -s -o /dev/null -w '%{http_code}' "$FEED_URL/$manifest")" || true
  if [ "$code" = "200" ]; then
    echo "    $manifest -> $FEED_URL/$manifest  OK"
  else
    die "$manifest copied but $FEED_URL/$manifest returned $code — check the nginx /pos-dl/ block"
  fi
done

printf '\n\033[1;32mPublished v%s.\033[0m  %s\n' "$VERSION" "$FEED_URL"
printf 'Reminder: this published whatever version was already in apps/pos/package.json.\n'
printf 'If you meant this to be a new version, bump it, commit, push, and re-run.\n\n'
