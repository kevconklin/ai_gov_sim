"""Object storage for checkpoints and exports. Local paths by default; Supabase Storage when configured (SPEC 11.2)."""

from __future__ import annotations

import os
import urllib.request
from pathlib import Path


class SupabaseStorage:
    def __init__(self, url: str, service_key: str, bucket: str) -> None:
        self.url, self.key, self.bucket = url.rstrip("/"), service_key, bucket

    @classmethod
    def from_env(cls) -> "SupabaseStorage | None":
        url, key = os.environ.get("SUPABASE_URL"), os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
        return cls(url, key, os.environ.get("SUPABASE_STORAGE_BUCKET", "sim-artifacts")) if url and key else None

    def upload(self, path: Path, object_name: str) -> str:
        request = urllib.request.Request(
            f"{self.url}/storage/v1/object/{self.bucket}/{object_name}", data=Path(path).read_bytes(), method="POST",
            headers={"Authorization": f"Bearer {self.key}", "Content-Type": "application/octet-stream", "x-upsert": "true"})
        with urllib.request.urlopen(request, timeout=60):
            pass
        return f"supabase://{self.bucket}/{object_name}"
