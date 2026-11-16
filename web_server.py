#!/usr/bin/env python3
"""FishLink local development server.

Uses only Python's standard library and serves files from this script's folder.
"""

from __future__ import annotations

import argparse
import contextlib
import os
import socket
import sys
import webbrowser
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


PROJECT_DIR = Path(__file__).resolve().parent


class FishLinkRequestHandler(SimpleHTTPRequestHandler):
    """Static-file handler with headers suitable for local Web Serial use."""

    extensions_map = {
        **SimpleHTTPRequestHandler.extensions_map,
        ".css": "text/css; charset=utf-8",
        ".html": "text/html; charset=utf-8",
        ".js": "text/javascript; charset=utf-8",
        ".json": "application/json; charset=utf-8",
        ".svg": "image/svg+xml",
    }

    def end_headers(self) -> None:
        self.send_header("Cache-Control", "no-store")
        self.send_header("Permissions-Policy", "serial=(self)")
        self.send_header("X-Content-Type-Options", "nosniff")
        super().end_headers()

    def log_message(self, message_format: str, *args: object) -> None:
        sys.stdout.write(
            f"[{self.log_date_time_string()}] "
            f"{self.address_string()} {message_format % args}\n"
        )


class ReusableThreadingHTTPServer(ThreadingHTTPServer):
    allow_reuse_address = True
    daemon_threads = True


def port_is_available(host: str, port: int) -> bool:
    """Return whether the selected address can be bound."""
    family = socket.AF_INET6 if ":" in host else socket.AF_INET
    with contextlib.closing(socket.socket(family, socket.SOCK_STREAM)) as probe:
        with contextlib.suppress(OSError):
            probe.bind((host, port))
            return True
    return False


def parse_arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="启动 FishLink 机器鱼串口助手的本地网页服务。"
    )
    parser.add_argument(
        "--host",
        default="127.0.0.1",
        help="监听地址，默认为 127.0.0.1",
    )
    parser.add_argument(
        "--port",
        type=int,
        default=8000,
        help="监听端口，默认为 8000",
    )
    parser.add_argument(
        "--open",
        action="store_true",
        help="启动后自动在默认浏览器中打开页面",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_arguments()
    if not 1 <= args.port <= 65535:
        print("错误：端口必须在 1 到 65535 之间。", file=sys.stderr)
        return 2

    if not port_is_available(args.host, args.port):
        print(
            f"错误：{args.host}:{args.port} 已被占用或无法监听。",
            file=sys.stderr,
        )
        return 1

    handler = partial(FishLinkRequestHandler, directory=os.fspath(PROJECT_DIR))
    url_host = "localhost" if args.host in {"127.0.0.1", "::1"} else args.host
    url = f"http://{url_host}:{args.port}/"

    try:
        with ReusableThreadingHTTPServer((args.host, args.port), handler) as server:
            print("FishLink 本地服务已启动")
            print(f"项目目录：{PROJECT_DIR}")
            print(f"访问地址：{url}")
            print("按 Ctrl+C 停止服务")
            if args.open:
                webbrowser.open(url)
            server.serve_forever()
    except KeyboardInterrupt:
        print("\nFishLink 本地服务已停止。")
    except OSError as error:
        print(f"启动失败：{error}", file=sys.stderr)
        return 1

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
