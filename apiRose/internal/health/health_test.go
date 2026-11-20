package health

import (
	"encoding/json"
	"maps"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestHandler(t *testing.T) {
	tests := []struct {
		name            string
		method          string
		wantStatus      int
		wantContentType string
		wantBody        map[string]string
	}{
		{
			name:            "get returns ok",
			method:          http.MethodGet,
			wantStatus:      http.StatusOK,
			wantContentType: "application/json",
			wantBody:        map[string]string{"status": "ok"},
		},
		{
			name:            "non-get method is still served",
			method:          http.MethodPost,
			wantStatus:      http.StatusOK,
			wantContentType: "application/json",
			wantBody:        map[string]string{"status": "ok"},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(tt.method, "/health", nil)
			rec := httptest.NewRecorder()

			Handler()(rec, req)

			if rec.Code != tt.wantStatus {
				t.Fatalf("status = %d, want %d", rec.Code, tt.wantStatus)
			}
			if got := rec.Header().Get("Content-Type"); got != tt.wantContentType {
				t.Fatalf("Content-Type = %q, want %q", got, tt.wantContentType)
			}

			var body map[string]string
			if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
				t.Fatalf("decode body: %v", err)
			}
			if !maps.Equal(body, tt.wantBody) {
				t.Fatalf("body = %v, want %v", body, tt.wantBody)
			}
		})
	}
}
