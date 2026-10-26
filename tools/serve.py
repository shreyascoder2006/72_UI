"""Local development server for the site.

    python tools/serve.py [port]          (default 8000, from anywhere)

`python -m http.server` works too, but on Windows its listen backlog of 5 makes it refuse
some of the page's ~60 parallel script requests, which leaves the page on its loading
screen; and browsers keep stale copies of edited scripts. This one is threaded, queues
up to 128 connections, and tells the browser to revalidate every file, so an edit shows
on the next plain reload.
"""
import functools
import http.server
import os
import sys

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")


class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def log_message(self, fmt, *args):
        if not str(args[1] if len(args) > 1 else "").startswith(("2", "3")):
            super().log_message(fmt, *args)


class Server(http.server.ThreadingHTTPServer):
    request_queue_size = 128
    daemon_threads = True


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    handler = functools.partial(Handler, directory=os.path.abspath(ROOT))
    with Server(("127.0.0.1", port), handler) as httpd:
        print(f"Serving {os.path.abspath(ROOT)} at http://localhost:{port}/", flush=True)
        httpd.serve_forever()


if __name__ == "__main__":
    main()
