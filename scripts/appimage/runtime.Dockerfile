ARG ALPINE_IMAGE
FROM ${ALPINE_IMAGE}
RUN apk add --no-cache bash alpine-sdk util-linux file autoconf automake libtool xz eudev-dev gettext-dev linux-headers meson zstd-dev zstd-static zlib-dev zlib-static clang musl-dev mimalloc-dev curl python3
COPY upstream.tar.gz /tmp/upstream.tar.gz
COPY runtime-build.sh runtime-sources.py /work/
WORKDIR /work
ENTRYPOINT ["bash", "/work/runtime-build.sh"]
