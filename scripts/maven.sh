#!/bin/sh
# Repository-local Maven only; exact upstream SHA512 pinned before execution.
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
version=3.9.16
archive="$root/.tools/apache-maven-$version-bin.tar.gz"
expected=831a8591fe20c8243b1dbe7d71e3244f31d1665b0804b2e825e38cbbe5ce0cafb8338851f90780735568773e0a6cd07bbec107cda0b896b008b861075358b6f6
if [ ! -x "$root/.tools/apache-maven-$version/bin/mvn" ]; then
  mkdir -p "$root/.tools"
  curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 "https://repo.maven.apache.org/maven2/org/apache/maven/apache-maven/$version/apache-maven-$version-bin.tar.gz" -o "$archive"
  actual=$(shasum -a 512 "$archive" | cut -d ' ' -f1)
  [ "$actual" = "$expected" ] || { printf '%s\n' 'Maven checksum mismatch' >&2; exit 1; }
  tar -xzf "$archive" -C "$root/.tools"
  rm "$archive"
fi
exec "$root/.tools/apache-maven-$version/bin/mvn" "$@"
