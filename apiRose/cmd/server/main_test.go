package main

import (
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"
)

func TestHealthcheckSuccess(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/health" {
			t.Errorf("path = %q, want %q", r.URL.Path, "/health")
		}
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	t.Setenv("PORT", portFromURL(t, srv.URL))

	if code := healthcheck(); code != 0 {
		t.Fatalf("healthcheck() = %d, want 0", code)
	}
}

func TestHealthcheckFailure(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer srv.Close()

	t.Setenv("PORT", portFromURL(t, srv.URL))

	if code := healthcheck(); code != 1 {
		t.Fatalf("healthcheck() = %d, want 1", code)
	}
}

func portFromURL(t *testing.T, raw string) string {
	t.Helper()

	parsed, err := url.Parse(raw)
	if err != nil {
		t.Fatalf("parse %q: %v", raw, err)
	}

	_, port, err := net.SplitHostPort(parsed.Host)
	if err != nil {
		t.Fatalf("split host %q: %v", parsed.Host, err)
	}
	return port
}
