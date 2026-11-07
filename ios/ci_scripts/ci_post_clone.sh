#!/usr/bin/env bash
# Xcode Cloud: AnkiBase.xcodeproj isn't kept in git (XcodeGen makes it from project.yml), so
# make it here, right after the clone, the way scripts/xcode.sh does on a Mac.
#
# The build's settings come from the workflow's environment variables (ANKIBASE_BUNDLE_ID,
# ANKIBASE_SERVER, ANKIBASE_UPDATE_FEED; see local.env.example), written to local.env: the
# scheme's pre-action runs scripts/xcode.sh prepare without the build's environment.
set -euo pipefail
cd "$(dirname "$0")/.."
# It replaces local.env: on your own Mac, use scripts/xcode.sh.
[ "${CI:-}" = TRUE ] || { echo "error: this is for Xcode Cloud; use scripts/xcode.sh" >&2; exit 1; }

echo "== Tools"
export HOMEBREW_NO_INSTALL_CLEANUP=1 HOMEBREW_NO_AUTO_UPDATE=1
brew install xcodegen protobuf librsvg node
if ! command -v rustup >/dev/null && [ ! -x "$HOME/.cargo/bin/rustup" ]; then
  # The toolchain itself (and the iPhone target) comes from engine/rust-toolchain.toml.
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal --default-toolchain none
fi
export PATH="$HOME/.cargo/bin:$PATH"
(cd engine && rustup toolchain install)  # reads rust-toolchain.toml

echo "== Release tags (the app's version, see scripts/xcode.sh)"
git fetch --tags --quiet || echo "warning: couldn't fetch the tags"

echo "== local.env"
{
  echo "# Made by ci_scripts/ci_post_clone.sh from the Xcode Cloud workflow's environment."
  for name in ANKIBASE_BUNDLE_ID ANKIBASE_TEAM_ID ANKIBASE_SERVER ANKIBASE_UPDATE_FEED; do
    [ -z "${!name:-}" ] || printf '%s=%q\n' "$name" "${!name}"
  done
  # Xcode Cloud numbers its builds itself; the app's build number (CFBundleVersion) follows.
  [ -z "${CI_BUILD_NUMBER:-}" ] || echo "ANKIBASE_BUILD_NUMBER=$CI_BUILD_NUMBER"
  # Built from a tag (v1.4.0): that's the version; otherwise scripts/xcode.sh takes the latest tag.
  [ -z "${CI_TAG:-}" ] || echo "ANKIBASE_VERSION=${CI_TAG#v}"
} > local.env
cat local.env

# What the project includes (the asset catalog, Local.xcconfig) has to exist before XcodeGen
# runs; the scheme's pre-action runs this again before the build.
scripts/xcode.sh prepare

echo "== Xcode project"
xcodegen generate --spec project.yml
