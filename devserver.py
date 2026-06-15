#!/usr/bin/env python3
"""
Dev-сервер для SHPUK-Desktop с прокси к каталожному API (sollersdev.ru).

Зачем: боевой API на https://sollersdev.ru НЕ отдаёт CORS-заголовки, поэтому
из браузера напрямую его дёргать нельзя (fetch и THREE.TextureLoader блокируются).
Этот сервер раздаёт статику проекта И проксирует /api/* и /static/* на sollersdev.ru,
делая их same-origin для страницы (CORS вообще не нужен). В JSON-ответах /api
абсолютные ссылки https://sollersdev.ru переписываются в относительные (/static/...),
чтобы текстуры тоже грузились через прокси (same-origin).

Когда бэкенд включит CORS — прокси не нужен: в index.html выставить
RESOURCE_API_DOMAIN = 'https://sollersdev.ru' и раздавать статику любым сервером.

Запуск:  python devserver.py [порт]   (по умолчанию 8848)
Раздаётся каталог, где лежит этот файл (независимо от текущей директории).
"""
import os
import sys
import urllib.request
import urllib.error
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

UPSTREAM = "https://sollersdev.ru"
# Префиксы, которые ВСЕГДА идут на апстрим (даже если вдруг появится одноимённая папка).
PROXY_PREFIXES = ("/api/", "/static/")
# Абсолютные ссылки апстрима в JSON переписываем в относительные (→ same-origin, через прокси).
# Учитываем http/https и www, чтобы картинки/текстуры товаров тоже грузились через прокси.
UPSTREAM_URL_VARIANTS = (
    "https://www.sollersdev.ru", "http://www.sollersdev.ru",
    "https://sollersdev.ru", "http://sollersdev.ru",
)
ROOT = os.path.dirname(os.path.abspath(__file__))
ATTEMPTS = 6            # попыток к нестабильному апстриму
ATTEMPT_TIMEOUT = 7     # таймаут на одну попытку, сек (легит. ответы ≤5с, зависания бросаем быстрее)


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        self._proxying = False
        super().__init__(*args, directory=ROOT, **kwargs)

    def _should_proxy(self):
        # Явные префиксы — всегда на апстрим.
        if any(self.path.startswith(p) for p in PROXY_PREFIXES):
            return True
        # Иначе проксируем всё, чего НЕТ локально: картинки/текстуры товаров Bitrix лежат
        # под /upload/... (и т.п.) — перечислять все префиксы хрупко, поэтому отдаём апстриму
        # любой путь, которому не соответствует локальный файл. Локальная статика (index.html,
        # *.js, assets/) при этом всегда обслуживается с диска.
        local = self.translate_path(self.path)
        if os.path.isdir(local):
            return False
        return not os.path.isfile(local)

    def end_headers(self):
        # Локальная статика (особенно index.html) — no-store, чтобы дев всегда грузил свежую
        # версию (cache-bust ?v=N стоит только на скриптах). Прокси-ответы свой Cache-Control
        # ставят сами (см. _proxy → self._proxying).
        if not self._proxying:
            self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "*")
        self.end_headers()

    def do_GET(self):
        if self._should_proxy():
            self._proxy()
        else:
            super().do_GET()

    def do_HEAD(self):
        if self._should_proxy():
            self._proxy(head=True)
        else:
            super().do_HEAD()

    def _fetch_upstream(self, url, head):
        # Апстрим (sollersdev.ru) нестабилен: TLS-рукопожатие периодически виснет
        # (~1 из 3 запросов). Сбои независимы, поэтому делаем несколько попыток с
        # коротким таймаутом — это почти всегда даёт успех за 1-2 ретрая.
        last = None
        for attempt in range(ATTEMPTS):
            try:
                req = urllib.request.Request(url, method="HEAD" if head else "GET")
                req.add_header("User-Agent", "Mozilla/5.0 (SHPUK-devproxy)")
                req.add_header("Accept", "*/*")
                req.add_header("Connection", "close")
                with urllib.request.urlopen(req, timeout=ATTEMPT_TIMEOUT) as resp:
                    ctype = resp.headers.get("Content-Type", "application/octet-stream")
                    body = b"" if head else resp.read()
                    return resp.status, ctype, body, None
            except urllib.error.HTTPError as e:
                # Реальный HTTP-код (404/500…) — не ретраим.
                return e.code, "text/plain; charset=utf-8", b"", None
            except Exception as e:
                last = e
                continue
        return None, None, None, last

    def _proxy(self, head=False):
        self._proxying = True
        url = UPSTREAM + self.path
        status, ctype, body, err = self._fetch_upstream(url, head)
        if status is None:
            self.send_response(502)
            self.send_header("Content-Type", "text/plain; charset=utf-8")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            try:
                self.wfile.write(f"proxy error after {ATTEMPTS} attempts: {err}".encode())
            except Exception:
                pass
            return
        # В JSON переписываем абсолютные ссылки апстрима на относительные, чтобы картинки и
        # текстуры товаров (preview_picture, texture_urls, /upload/...) грузились через тот же
        # прокси (same-origin). Покрываем http/https и www.
        if body and "application/json" in (ctype or ""):
            for variant in UPSTREAM_URL_VARIANTS:
                body = body.replace(variant.encode(), b"")
        self.send_response(status)
        self.send_header("Content-Type", ctype or "application/octet-stream")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        if not head and body:
            try:
                self.wfile.write(body)
            except Exception:
                pass

    def log_message(self, fmt, *args):
        pass  # тише в консоли


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8848
    httpd = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    print(f"SHPUK dev server on http://localhost:{port}  (proxy {PROXY_PREFIXES} -> {UPSTREAM})")
    httpd.serve_forever()


if __name__ == "__main__":
    main()
