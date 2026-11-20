#!/usr/bin/env python3
"""FishLink local development server.

Uses only Python's standard library and serves files from this script's folder.
"""

from __future__ import annotations

import argparse
import contextlib
import json
import os
import socket
import sys
import webbrowser
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


PROJECT_DIR = Path(__file__).resolve().parent
DATA_DIR = PROJECT_DIR / "data"
COMMANDS_FILE = DATA_DIR / "quick_commands.json"
IMU_CONFIG_FILE = DATA_DIR / "imu_frame_config.json"
SERVO_CONFIG_FILE = DATA_DIR / "servo_config.json"


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

    def do_GET(self) -> None:
        if self.path == "/api/servo-config":
            try:
                data = SERVO_CONFIG_FILE.read_bytes()
            except OSError:
                self.send_error(500, "Cannot read servo configuration")
                return
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return
        if self.path == "/api/imu-config":
            try:
                data = IMU_CONFIG_FILE.read_bytes()
            except OSError:
                self.send_error(500, "Cannot read IMU configuration")
                return
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return
        if self.path == "/api/quick-commands":
            try:
                data = COMMANDS_FILE.read_bytes() if COMMANDS_FILE.exists() else b"[]"
            except OSError:
                self.send_error(500, "Cannot read quick commands")
                return
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return
        super().do_GET()

    def do_PUT(self) -> None:
        if self.path == "/api/servo-config":
            try:
                length = int(self.headers.get("Content-Length", "0"))
                if not 0 < length <= 1024:
                    raise ValueError("Invalid size")
                config = json.loads(self.rfile.read(length))
                if (not isinstance(config, dict)
                    or any(type(config.get(key)) is not int or not -60 <= config[key] <= 60
                           for key in ("minAngle", "maxAngle"))
                    or config["minAngle"] >= config["maxAngle"]
                    or set(config) != {"minAngle", "maxAngle"}):
                    raise ValueError("Invalid servo configuration")
                payload = (json.dumps(config, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
                temporary = SERVO_CONFIG_FILE.with_suffix(".json.tmp")
                temporary.write_bytes(payload)
                temporary.replace(SERVO_CONFIG_FILE)
            except (ValueError, UnicodeDecodeError, OSError):
                self.send_error(400, "Invalid servo configuration")
                return
            self.send_response(204)
            self.end_headers()
            return
        if self.path == "/api/imu-config":
            try:
                length = int(self.headers.get("Content-Length", "0"))
                if not 0 < length <= 16_384:
                    raise ValueError("Invalid size")
                config = json.loads(self.rfile.read(length))
                if (not isinstance(config, dict)
                    or not isinstance(config.get("frameFormat"), str)
                    or not 0 < len(config["frameFormat"]) <= 8192
                    or any(not isinstance(config.get(key), (int, float)) or isinstance(config.get(key), bool)
                           or not 0 < config[key] <= 1_000_000
                           for key in ("accelDivisor", "gyroDivisor", "angleDivisor"))):
                    raise ValueError("Invalid IMU configuration")
                payload = (json.dumps(config, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
                temporary = IMU_CONFIG_FILE.with_suffix(".json.tmp")
                temporary.write_bytes(payload)
                temporary.replace(IMU_CONFIG_FILE)
            except (ValueError, UnicodeDecodeError, OSError):
                self.send_error(400, "Invalid IMU configuration")
                return
            self.send_response(204)
            self.end_headers()
            return
        if self.path != "/api/quick-commands":
            self.send_error(404)
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if not 0 < length <= 256_000:
                raise ValueError("Invalid size")
            commands = json.loads(self.rfile.read(length))
            if not isinstance(commands, list) or len(commands) > 500 or any(
                not isinstance(item, dict)
                or not isinstance(item.get("name"), str)
                or not 0 < len(item["name"]) <= 40
                or not isinstance(item.get("data"), str)
                or not 0 < len(item["data"]) <= 4096
                or item.get("format", "hex") not in {"hex", "ascii"}
                or any(key not in {"name", "data", "format"} for key in item)
                for item in commands
            ):
                raise ValueError("Invalid commands")
            payload = (json.dumps(commands, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
            temporary = COMMANDS_FILE.with_suffix(".json.tmp")
            temporary.write_bytes(payload)
            temporary.replace(COMMANDS_FILE)
        except (ValueError, UnicodeDecodeError, OSError):
            self.send_error(400, "Invalid quick commands")
            return
        self.send_response(204)
        self.end_headers()

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
