FROM alpine AS base

ARG BUN_RUNTIME_TRANSPILER_CACHE_PATH=0
ENV BUN_RUNTIME_TRANSPILER_CACHE_PATH=${BUN_RUNTIME_TRANSPILER_CACHE_PATH}
RUN apk add --no-cache libgcc libstdc++ ripgrep

FROM base AS build-amd64
COPY dist/cli-linux-x64-baseline-musl/bin/nemoracode /usr/local/bin/nemoracode

FROM base AS build-arm64
COPY dist/cli-linux-arm64-musl/bin/nemoracode /usr/local/bin/nemoracode

ARG TARGETARCH
FROM build-${TARGETARCH}
RUN ln -s nemoracode /usr/local/bin/nemoracode2 && nemoracode --version && nemoracode2 --version
ENTRYPOINT ["nemoracode"]
