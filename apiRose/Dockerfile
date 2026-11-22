# syntax=docker/dockerfile:1.7

FROM --platform=$BUILDPLATFORM golang:1.26.7-alpine AS builder

ARG TARGETOS=linux
ARG TARGETARCH=amd64

WORKDIR /src
ENV CGO_ENABLED=0
ENV GOTOOLCHAIN=local

COPY go.* ./
RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    go mod download

COPY . .
RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    GOOS=$TARGETOS GOARCH=$TARGETARCH \
    go build -trimpath -buildvcs=false -ldflags='-s -w -buildid=' -o /out/server ./cmd/server

FROM gcr.io/distroless/static-debian12:nonroot

WORKDIR /app
COPY --link --from=builder --chown=65532:65532 /out/server ./server

ENV PORT=8080
USER 65532:65532
EXPOSE 8080
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=5 \
  CMD ["/app/server", "-healthcheck"]
ENTRYPOINT ["/app/server"]
