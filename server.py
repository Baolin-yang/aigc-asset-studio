"""A zero-dependency local server for AIGC Asset Studio.

The UI runs in Demo Provider mode by default. The provider boundary is kept
explicit so a real Hunyuan3D or Blender worker can be connected later without
changing the product-facing task protocol.
"""

from __future__ import annotations

import json
import os
import secrets
import time
import urllib.error
import urllib.request
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse


ROOT = Path(__file__).resolve().parent
PORT = int(os.environ.get("PORT", "8787"))
HUNYUAN_API_URL = os.environ.get("HUNYUAN_API_URL", "").strip()


class ProviderRegistry:
    """Provider registry used by the demo API.

    The demo deliberately does not fabricate a Hunyuan result. A production
    adapter can implement the same `run` contract and persist its job id.
    """

    def __init__(self) -> None:
        self.providers = {
            "demo": {"label": "Demo Provider", "mode": "offline"},
            "hunyuan3d": {
                "label": "Hunyuan3D adapter",
                "mode": "configured" if HUNYUAN_API_URL else "not-configured",
                "endpoint": HUNYUAN_API_URL or None,
            },
            "blender": {"label": "Blender render adapter", "mode": "contract-ready"},
        }

    def run(self, workflow: str, payload: dict) -> dict:
        provider = payload.get("provider", "demo")
        provider_info = self.providers.get(provider, self.providers["demo"])
        now = int(time.time())
        job_id = f"job_{now}_{secrets.token_hex(3)}"
        if provider == "hunyuan3d" and HUNYUAN_API_URL and payload.get("imageData"):
            return self._run_hunyuan(job_id, workflow, payload, provider_info)
        return {
            "jobId": job_id,
            "workflow": workflow,
            "provider": provider,
            "providerInfo": provider_info,
            "status": "completed",
            "stages": [
                {"id": "input", "label": "照片检查", "status": "completed"},
                {"id": "shape", "label": "图生 3D 候选", "status": "completed"},
                {"id": "world", "label": "世界场景", "status": "completed"},
                {"id": "shot", "label": "镜头规划", "status": "completed"},
                {"id": "film", "label": "广告成片", "status": "completed"},
            ],
            "input": {
                "filename": payload.get("filename", "local-upload"),
                "scene": payload.get("scene", "apartment"),
            },
            "message": "任务已完成。当前为本地 Demo 结果；接入真实 provider 后沿用此任务协议。",
        }

    def _run_hunyuan(self, job_id: str, workflow: str, payload: dict, provider_info: dict) -> dict:
        """Call the existing local Hunyuan3D `/generate` contract when configured."""
        image_data = payload["imageData"].split(",", 1)[-1]
        request_body = json.dumps({
            "image": image_data,
            "seed": 1234,
            "octree_resolution": 128,
            "num_inference_steps": 5,
            "type": "glb",
        }).encode("utf-8")
        request = urllib.request.Request(
            f"{HUNYUAN_API_URL.rstrip('/')}/generate",
            data=request_body,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=180) as response:
                glb = response.read()
            output_dir = ROOT / "outputs"
            output_dir.mkdir(exist_ok=True)
            output_path = output_dir / f"{job_id}.glb"
            output_path.write_bytes(glb)
            return {
                "jobId": job_id,
                "workflow": workflow,
                "provider": "hunyuan3d",
                "providerInfo": provider_info,
                "status": "completed",
                "artifacts": [{"role": "model", "path": f"outputs/{output_path.name}", "bytes": len(glb)}],
                "stages": [
                    {"id": "input", "label": "照片检查", "status": "completed"},
                    {"id": "shape", "label": "图生 3D 候选", "status": "completed"},
                    {"id": "world", "label": "世界场景", "status": "completed"},
                    {"id": "shot", "label": "镜头规划", "status": "completed"},
                    {"id": "film", "label": "广告成片", "status": "completed"},
                ],
                "input": {"filename": payload.get("filename", "local-upload"), "scene": payload.get("scene", "apartment")},
                "message": "Hunyuan3D 已返回 GLB；世界场景和广告渲染继续沿用任务协议。",
            }
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            return {
                "jobId": job_id,
                "workflow": workflow,
                "provider": "hunyuan3d",
                "providerInfo": provider_info,
                "status": "error",
                "message": f"Hunyuan3D provider 调用失败：{exc}",
            }


REGISTRY = ProviderRegistry()


class Handler(BaseHTTPRequestHandler):
    server_version = "AIGCAssetStudio/1.0"

    def _json(self, payload: dict, status: int = HTTPStatus.OK) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:  # noqa: N802
        path = urlparse(self.path).path
        if path == "/api/health":
            self._json(
                {
                    "ok": True,
                    "service": "aigc-asset-studio",
                    "providers": REGISTRY.providers,
                }
            )
            return
        if path == "/api/providers":
            self._json({"providers": REGISTRY.providers})
            return
        self._serve_file(path)

    def do_POST(self) -> None:  # noqa: N802
        path = urlparse(self.path).path
        if path != "/api/jobs":
            self._json({"error": "Not found"}, HTTPStatus.NOT_FOUND)
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            raw = self.rfile.read(length) if length else b"{}"
            payload = json.loads(raw.decode("utf-8"))
            result = REGISTRY.run(payload.get("workflow", "asset-to-film"), payload)
            self._json(result, HTTPStatus.ACCEPTED)
        except (ValueError, json.JSONDecodeError) as exc:
            self._json({"error": f"Invalid JSON: {exc}"}, HTTPStatus.BAD_REQUEST)

    def _serve_file(self, path: str) -> None:
        relative = "index.html" if path in ("", "/") else path.lstrip("/")
        candidate = (ROOT / relative).resolve()
        if ROOT not in candidate.parents and candidate != ROOT:
            self._json({"error": "Forbidden"}, HTTPStatus.FORBIDDEN)
            return
        if not candidate.is_file():
            self._json({"error": "Not found"}, HTTPStatus.NOT_FOUND)
            return
        content_type = {
            ".html": "text/html; charset=utf-8",
            ".css": "text/css; charset=utf-8",
            ".js": "text/javascript; charset=utf-8",
            ".svg": "image/svg+xml",
            ".json": "application/json; charset=utf-8",
        }.get(candidate.suffix, "application/octet-stream")
        data = candidate.read_bytes()
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, fmt: str, *args: object) -> None:
        print(f"[{self.log_date_time_string()}] {fmt % args}")


if __name__ == "__main__":
    httpd = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print(f"AIGC Asset Studio running at http://127.0.0.1:{PORT}")
    print(f"Hunyuan3D adapter: {'configured' if HUNYUAN_API_URL else 'demo mode'}")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nServer stopped")
        httpd.server_close()
