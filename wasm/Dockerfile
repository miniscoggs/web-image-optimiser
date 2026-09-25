# Builds wasm/pkg in a pinned environment, so a local build and the CI rebuild produce identical
# bytes. Run it through `npm run build:wasm`, which also pins the platform to linux/amd64.
# Keep the Rust version in step with rust-toolchain.toml, and wasm-bindgen with Cargo.lock.
FROM rust:1.98.1-slim-trixie@sha256:f47a8de237dcbb0b0ce1099901e60a89728e3d51f24e664b40e947171538ade7 AS build

ADD --checksum=sha256:c09f971ecaed9a2efc80fdcea7a00ef6b53c7fadc8c57d1f61b53a6aa66b668a \
    https://github.com/wasm-bindgen/wasm-pack/releases/download/v0.15.0/wasm-pack-v0.15.0-x86_64-unknown-linux-musl.tar.gz \
    /tmp/wasm-pack.tar.gz
ADD --checksum=sha256:82d12bb940e2d4e72e0d5605387fc1b8ca179044e012b620f0ce4e7440e8320e \
    https://github.com/wasm-bindgen/wasm-bindgen/releases/download/0.2.129/wasm-bindgen-0.2.129-x86_64-unknown-linux-musl.tar.gz \
    /tmp/wasm-bindgen.tar.gz
ADD --checksum=sha256:3dc677006555b355ea2da5e82602065a161d5e83eaefd3f759afa00b96e83212 \
    https://github.com/WebAssembly/binaryen/releases/download/version_117/binaryen-version_117-x86_64-linux.tar.gz \
    /tmp/binaryen.tar.gz
RUN tar -xzf /tmp/wasm-pack.tar.gz -C /usr/local/bin --strip-components=1 \
        wasm-pack-v0.15.0-x86_64-unknown-linux-musl/wasm-pack \
    && tar -xzf /tmp/wasm-bindgen.tar.gz -C /usr/local/bin --strip-components=1 \
        wasm-bindgen-0.2.129-x86_64-unknown-linux-musl/wasm-bindgen \
    && tar -xzf /tmp/binaryen.tar.gz -C /usr/local/bin --strip-components=2 \
        binaryen-version_117/bin/wasm-opt

WORKDIR /wasm
COPY . .
# no-install: use the checksummed tools above, never a download
# pkg/package.json scopes the commonjs output back from the root's "type": "module"
# --no-pack still writes a .gitignore
RUN rustup target add wasm32-unknown-unknown \
    && wasm-pack build --mode no-install --target nodejs --release --out-name ssimulacra2 --no-pack -- --locked \
    && rm pkg/.gitignore \
    && echo '{ "type": "commonjs" }' > pkg/package.json \
    && sh notices.sh > pkg/THIRD-PARTY-NOTICES.txt

FROM scratch
COPY --from=build /wasm/pkg /
