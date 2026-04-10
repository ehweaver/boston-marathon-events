import http.server
import os

os.chdir(os.path.dirname(os.path.abspath(__file__)))

port = int(os.environ.get("PORT", 3456))
handler = http.server.SimpleHTTPRequestHandler
with http.server.HTTPServer(("", port), handler) as httpd:
    httpd.serve_forever()
