#!/bin/sh
# Pins the app source in the Flatpak manifest to the commit of its tag.
# Usage: packaging/flatpak/update-commit.sh [manifest]
# Run after creating the tag named in the manifest's `tag:` line (e.g. v0.2.0).
set -eu

dir=$(dirname "$0")
manifest=${1:-$dir/io.github.brayanspagnol.OpenMHub.yml}

tag=$(sed -n '/# BEGIN app-source/,/# END app-source/s/^ *tag: *//p' "$manifest")
[ -n "$tag" ] || { echo "no tag: line in the app-source block of $manifest" >&2; exit 1; }

commit=$(git -C "$dir" rev-parse --verify "refs/tags/$tag^{commit}") || {
  echo "tag $tag not found; create it first: git tag -a $tag -m $tag" >&2
  exit 1
}

# Replaces the placeholder comment or a previously pinned commit.
sed -i "/# BEGIN app-source/,/# END app-source/{
  s|^\( *\)# commit:.*|\1commit: $commit|
  s|^\( *\)commit: .*|\1commit: $commit|
}" "$manifest"

echo "$manifest: $tag -> $commit"
