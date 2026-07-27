#!/usr/bin/env bash
# Cut a new release. Bumps the version in every place that matters, commits,
# tags, and pushes — which triggers the GitHub Actions workflow to build the
# .dmg and create a draft release for you to review and publish.
#
# Keeping Cargo.toml in sync matters: the in-app "update available" check
# compares GitHub's latest tag against the version compiled into the app
# (CARGO_PKG_VERSION). If they drift, the banner logic breaks.
#
# Usage:  ./release.sh 0.2.0     (or ./release.sh v0.2.0)
set -euo pipefail

RAW="${1:?Usage: ./release.sh <version>   e.g. ./release.sh 0.2.0}"
VERSION="${RAW#v}"          # accept 0.2.0 or v0.2.0
TAG="v${VERSION}"
cd "$(dirname "$0")"

# Bump "version": "x.y.z" in tauri.conf.json
sed -i '' -E "s/(\"version\": \")[0-9]+\.[0-9]+\.[0-9]+(\")/\1${VERSION}\2/" src-tauri/tauri.conf.json
# Bump version = "x.y.z" under [package] in Cargo.toml
sed -i '' -E "s/^version = \"[0-9]+\.[0-9]+\.[0-9]+\"/version = \"${VERSION}\"/" src-tauri/Cargo.toml

git add src-tauri/tauri.conf.json src-tauri/Cargo.toml
git commit -m "Release ${TAG}"
git tag "${TAG}"
git push
git push origin "${TAG}"

echo ""
echo "Pushed ${TAG}. The build is starting:"
echo "  https://github.com/richdavies2005/spending-tracker/actions"
echo "When it finishes, publish the draft release it creates."
