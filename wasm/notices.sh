#!/bin/sh
# Prints the licence of every crate compiled into the WASM module. Run inside the build image.
# Crates offered under a choice of MIT or Apache-2.0 are used under MIT, so their Apache text
# is left out.
set -eu -o pipefail

echo "The WebAssembly module in this folder is compiled from the Rust crates below."
echo "Each crate's licence follows its name. Crates offered under a choice of MIT"
echo "or Apache-2.0 are used under MIT."

cargo tree --locked --edges normal,no-proc-macro --target wasm32-unknown-unknown \
  --prefix none --format '{p}|{l}' \
  | grep -v '(/wasm)|' \
  | sed 's/ (\*)$//' \
  | sort -u \
  | while IFS='|' read -r package licence; do
    name=${package% v*}
    version=${package##* v}
    dir=$(echo "$CARGO_HOME"/registry/src/*/"$name-$version")
    found=false

    printf '\n\n==== %s %s (%s) ====\n' "$name" "$version" "$licence"
    for file in "$dir"/LICENSE* "$dir"/COPYING*; do
      [ -f "$file" ] || continue
      case $file in
        */LICENSE-APACHE*) [ -f "$dir/LICENSE-MIT" ] && continue ;;
      esac
      printf '\n'
      tr -d '\r' < "$file"
      found=true
    done

    if [ "$found" = false ]; then
      echo "No licence file found for $name $version" >&2
      exit 1
    fi
  done
