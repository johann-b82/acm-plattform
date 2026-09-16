"""Stellvertreter für den Pi-Sidecar: nur GET /health.

Vertrag wie acm-signage/docs/operator-runbook-lumeapps.md §7.3:
`{"ready": bool, "online": bool, "cached_items": int}`.

`online` prüft der echte Sidecar alle 10 s mit GET `<SIGNAGE_API_BASE>/health`
(Status < 500 gilt als erreichbar). Der Stellvertreter prüft bei jeder Anfrage
sofort — so braucht der Test keine Wartezeit. `api_base` gibt es nur hier,
damit der Test sieht, welche Adresse tatsächlich eingelesen wurde.
"""
import json
import os
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, HTTPServer

API_BASE = os.environ.get("SIGNAGE_API_BASE", "").rstrip("/")


def reachable() -> bool:
    if not API_BASE:
        return False
    try:
        with urllib.request.urlopen(f"{API_BASE}/health", timeout=3) as r:
            return r.status < 500
    except urllib.error.HTTPError as e:
        return e.code < 500
    except Exception:
        return False


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path != "/health":
            self.send_error(404)
            return
        body = json.dumps(
            {"ready": True, "online": reachable(), "cached_items": 0, "api_base": API_BASE}
        ).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass


if __name__ == "__main__":
    HTTPServer(("127.0.0.1", 8080), Handler).serve_forever()
