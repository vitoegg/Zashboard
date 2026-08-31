#!/bin/sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
TARGET=${1:?usage: sh maint/apply.sh <upstream-dir>}
[ -d "$TARGET" ] || { echo "missing target: $TARGET" >&2; exit 1; }
TARGET=$(CDPATH= cd -- "$TARGET" && pwd)

[ "$TARGET" != "$ROOT" ] || { echo "target must not be repo root" >&2; exit 1; }

while IFS= read -r path || [ -n "$path" ]; do
	case "$path" in '' | \#*) continue ;; esac
	rm -rf "$TARGET/$path"
done < "$ROOT/maint/remove-paths.txt"

rm -rf "$TARGET/slim"
cp -R "$ROOT/maint/slim" "$TARGET/slim"

node "$TARGET/slim/rewrites.mjs" "$TARGET"

echo "ok"
