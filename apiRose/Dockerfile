# syntax=docker/dockerfile:1

# Static binary, then a minimal runtime. No cloud-specific base image.
FROM golang:1.26-alpine AS builder

WORKDIR /src
ENV CGO_ENABLED=0

# go.* keeps the dependency layer valid once go.sum exists.
COPY go.* ./
RUN go mod download

COPY . .
RUN go build -trimpath -ldflags='-s -w' -o /out/server ./cmd/server

FROM alpine:3.22 AS runtime

RUN apk add --no-cache ca-certificates \
    && adduser -D -H -u 10001 appuser

WORKDIR /app
COPY --from=builder /out/server ./server

USER appuser
ENV PORT=8080
EXPOSE 8080

CMD ["/app/server"]
