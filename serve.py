"""TOEIC スタディブック用の簡易サーバー。
PCとスマホ(同じWi-Fi)の両方からアクセスできるよう 0.0.0.0 で待ち受ける。
PORT環境変数があればそのポートで起動する。"""
import os
import socket
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler

port = int(os.environ.get("PORT", "8765"))
ThreadingHTTPServer.allow_reuse_address = True
httpd = ThreadingHTTPServer(("0.0.0.0", port), SimpleHTTPRequestHandler)

lan_ip = None
try:
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    s.connect(("8.8.8.8", 80))
    lan_ip = s.getsockname()[0]
    s.close()
except OSError:
    pass

print(f"PC        : http://localhost:{port}")
if lan_ip:
    print(f"Smartphone: http://{lan_ip}:{port}  (same Wi-Fi required)")
print("Close this window to stop the app.")
httpd.serve_forever()
