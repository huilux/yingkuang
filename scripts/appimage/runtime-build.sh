#!/bin/bash
set -euo pipefail
mkdir -p /out/sources /out/notices
cp /tmp/upstream.tar.gz /out/sources/type2-runtime.tar.gz
mkdir upstream
 tar -xf /tmp/upstream.tar.gz -C upstream --strip-components=1
cd upstream
cp LICENSE /out/notices/type2-runtime-LICENSE.txt
curl -fLsS --retry 3 https://github.com/libfuse/libfuse/releases/download/fuse-3.15.0/fuse-3.15.0.tar.xz -o /out/sources/fuse-3.15.0.tar.xz
curl -fLsS --retry 3 https://github.com/vasi/squashfuse/archive/0.5.2.tar.gz -o /out/sources/squashfuse-0.5.2.tar.gz
sha256sum -c <<'SUMS'
70589cfd5e1cff7ccd6ac91c86c01be340b227285c5e200baa284e401eea2ca0  /out/sources/fuse-3.15.0.tar.xz
db0238c5981dabbd80ee09ae15387f390091668ca060a7bc38047912491443d3  /out/sources/squashfuse-0.5.2.tar.gz
SUMS
tar -xf /out/sources/fuse-3.15.0.tar.xz
patch -d fuse-3.15.0 -p1 < patches/libfuse/mount.c.diff
meson setup fuse-3.15.0/build fuse-3.15.0 --prefix=/usr --default-library=static
ninja -C fuse-3.15.0/build install
tar -xf /out/sources/squashfuse-0.5.2.tar.gz
(cd squashfuse-0.5.2 && ./autogen.sh && CFLAGS='-ffunction-sections -fdata-sections -Os' ./configure LDFLAGS=-static && make -j2 && make install && install -m644 ./*.h /usr/local/include/squashfuse/)
cd src/runtime
# Capture the actual static link inputs, including compiler startup objects.
printf '%s\n' '8f39b89e2ac31e1640b3d3f7e9a5108e6ce805fa' > version
make runtime 'CC=clang -Wl,-t' 2>&1 | tee /out/link.log
cp runtime /out/runtime-x86_64
clang -I/usr/local/include/squashfuse -I/usr/include/fuse3 -std=gnu99 -D_FILE_OFFSET_BITS=64 -M runtime.c > /out/headers.txt
strip --strip-debug --strip-unneeded /out/runtime-x86_64
printf 'AI\002' | dd of=/out/runtime-x86_64 bs=1 count=3 seek=8 conv=notrunc
cp /lib/apk/db/installed /out/apk-installed.txt
python3 /work/runtime-sources.py /out
chmod -R a+rX /out
