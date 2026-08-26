"""Development server for Torchbound Labyrinth.

Serves the game as static files and accepts POST /_shot so the running page can
hand a rendered frame back to disk. Used for visual verification during
development; the game itself does not depend on it.
"""
import http.server
import os
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHOTS = os.path.join(ROOT, "shots")


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def do_POST(self):
        if not self.path.startswith("/_shot"):
            self.send_error(404)
            return
        length = int(self.headers.get("Content-Length", 0))
        data = self.rfile.read(length)
        name = self.headers.get("X-Shot-Name") or ("shot-%d" % int(time.time()))
        name = "".join(c for c in name if c.isalnum() or c in "-_.")
        if not name.endswith((".png", ".jpg")):
            name += ".png"
        os.makedirs(SHOTS, exist_ok=True)
        with open(os.path.join(SHOTS, name), "wb") as fh:
            fh.write(data)
        body = ("saved %s (%d bytes)" % (name, len(data))).encode()
        self.send_response(200)
        self.send_header("Content-Type", "text/plain")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def end_headers(self):
        # No caching, so an edit is always picked up on reload.
        self.send_header("Cache-Control", "no-store, max-age=0")
        super().end_headers()

    def log_message(self, fmt, *args):
        # Quiet: browsers open a lot of speculative sockets.
        pass


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8123
    # Threading matters here: a browser opens several sockets at once and a
    # single-threaded server blocks forever on the idle ones.
    http.server.ThreadingHTTPServer.allow_reuse_address = True
    httpd = http.server.ThreadingHTTPServer(("127.0.0.1", port), Handler)
    print("serving %s on http://127.0.0.1:%d" % (ROOT, port), flush=True)
    httpd.serve_forever()
