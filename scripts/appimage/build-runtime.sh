#!/bin/bash
set -euo pipefail
revision=8f39b89e2ac31e1640b3d3f7e9a5108e6ce805fa
output="$(pwd)/test-output/appimage-runtime"
context="$(mktemp -d)"
trap 'rm -rf "$context"' EXIT
mkdir -p "$output"
curl -fLsS --retry 3 "https://codeload.github.com/AppImage/type2-runtime/tar.gz/$revision" -o "$context/upstream.tar.gz"
echo "c449eb42c2190820872631f5e22f8e15b1e985a36dc4a9e2de3585bb7536c785  $context/upstream.tar.gz" | sha256sum -c -
docker pull alpine:3.21
base=$(docker image inspect alpine:3.21 --format '{{index .RepoDigests 0}}')
cp scripts/appimage/runtime.Dockerfile "$context/Dockerfile"
cp scripts/appimage/runtime-build.sh scripts/appimage/runtime-sources.py "$context/"
docker build --build-arg "ALPINE_IMAGE=$base" -t yingkuang-appimage-runtime "$context"
docker run --rm --volume "$output:/out" yingkuang-appimage-runtime
printf '%s\n' "$base" > "$output/ALPINE-IMAGE.txt"
cp scripts/appimage/runtime.Dockerfile scripts/appimage/runtime-build.sh scripts/appimage/runtime-sources.py scripts/appimage/build-runtime.sh "$output/"
# Dynamic dependencies would invalidate the static runtime source inventory.
if readelf -l "$output/runtime-x86_64" | grep -q INTERP; then
    echo 'Runtime unexpectedly depends on a host ELF interpreter' >&2
    exit 1
fi
"$output/runtime-x86_64" --appimage-version
