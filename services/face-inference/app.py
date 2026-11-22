from __future__ import annotations

import os
import uuid
import hmac
import asyncio
from functools import lru_cache
from datetime import datetime, timezone
from urllib.parse import quote, unquote, urlparse

import cv2
import httpx
import numpy as np
import onnxruntime as ort
from fastapi import FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from insightface.app import FaceAnalysis


SUPABASE_URL = os.environ["SUPABASE_URL"].rstrip("/")
SUPABASE_ANON_KEY = os.environ.get("SUPABASE_PUBLISHABLE_KEY") or os.environ["SUPABASE_ANON_KEY"]
SUPABASE_SECRET_KEY = os.environ.get("SUPABASE_SECRET_KEY") or os.environ["SUPABASE_SERVICE_ROLE_KEY"]
FACE_BACKFILL_TOKEN = os.environ.get("FACE_BACKFILL_TOKEN", "")
MODEL_NAME = os.environ.get("FACE_MODEL_NAME", "buffalo_l")
MIN_FACE_SIDE = int(os.environ.get("MIN_FACE_SIDE", "64"))
MAX_IMAGE_BYTES = 5 * 1024 * 1024

app = FastAPI(title="Opinionated private face feature service", version="1.0.0")
allowed_origins = [
    origin.strip()
    for origin in os.environ.get("FRONTEND_ORIGINS", "http://localhost:4173,http://127.0.0.1:4173").split(",")
    if origin.strip()
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)


class IndexPhotoRequest(BaseModel):
    photo_id: uuid.UUID
    storage_path: str = Field(min_length=3, max_length=512)
    mime_type: str = Field(pattern=r"^image/(jpeg|png|webp)$")


@lru_cache(maxsize=1)
def face_analyzer() -> FaceAnalysis:
    if "CUDAExecutionProvider" not in ort.get_available_providers():
        raise RuntimeError("CUDAExecutionProvider is unavailable; run this service with Docker GPU access enabled.")
    analyzer = FaceAnalysis(
        name=MODEL_NAME,
        allowed_modules=["detection", "recognition"],
        providers=["CUDAExecutionProvider", "CPUExecutionProvider"],
    )
    analyzer.prepare(ctx_id=0, det_size=(640, 640))
    return analyzer


def headers_for(key: str) -> dict[str, str]:
    return {"apikey": key, "Authorization": f"Bearer {key}"}


async def authenticated_user_id(authorization: str | None) -> str:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Sign in to process your photo.")
    async with httpx.AsyncClient(timeout=15) as client:
        response = await client.get(
            f"{SUPABASE_URL}/auth/v1/user",
            headers={"apikey": SUPABASE_ANON_KEY, "Authorization": authorization},
        )
    if response.status_code != 200:
        raise HTTPException(status_code=401, detail="Your session could not be verified.")
    return response.json()["id"]


async def admin_request(method: str, path: str, **kwargs: object) -> httpx.Response:
    request_headers = {**headers_for(SUPABASE_SECRET_KEY), **kwargs.pop("headers", {})}
    async with httpx.AsyncClient(timeout=45) as client:
        for attempt in range(3):
            try:
                response = await client.request(
                    method,
                    f"{SUPABASE_URL}{path}",
                    headers=request_headers,
                    **kwargs,
                )
                break
            except httpx.RequestError as error:
                if attempt == 2:
                    raise HTTPException(status_code=502, detail="Could not connect to Supabase. Retry the operation.") from error
                await asyncio.sleep(0.5 * (attempt + 1))
    if response.is_error:
        raise HTTPException(status_code=502, detail="Private feature storage request failed.")
    return response


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


async def process_photo(user_id: str, payload: IndexPhotoRequest, demo_backfill: bool = False) -> dict[str, object]:
    normalized_path = payload.storage_path.strip("/")
    path_parts = normalized_path.split("/")
    owned_path = path_parts[0] == user_id
    demo_path = len(path_parts) >= 3 and path_parts[0] == "demo" and path_parts[1] == user_id
    if (not owned_path and not (demo_backfill and demo_path)) or ".." in path_parts:
        raise HTTPException(status_code=403, detail="Photo path is outside your account.")

    profile_response = await admin_request(
        "GET",
        "/rest/v1/profiles",
        params={"user_id": f"eq.{user_id}", "select": "face_learning_consent,is_demo"},
    )
    profile_rows = profile_response.json()
    if not profile_rows or not profile_rows[0].get("face_learning_consent", False):
        raise HTTPException(status_code=403, detail="Enable private face learning in your profile first.")
    if demo_backfill and not profile_rows[0].get("is_demo", False):
        raise HTTPException(status_code=403, detail="Only existing demo profiles can be backfilled.")

    image_response = await admin_request(
        "GET",
        f"/storage/v1/object/profile-photos/{quote(normalized_path, safe='/')}",
    )
    if len(image_response.content) > MAX_IMAGE_BYTES:
        raise HTTPException(status_code=413, detail="Photo is larger than 5 MB.")
    image_array = np.frombuffer(image_response.content, dtype=np.uint8)
    image = cv2.imdecode(image_array, cv2.IMREAD_COLOR)
    if image is None:
        raise HTTPException(status_code=422, detail="The photo could not be decoded.")

    faces = face_analyzer().get(image)
    if not faces:
        raise HTTPException(status_code=422, detail="No clear face was found in this photo.")

    image_area = float(image.shape[0] * image.shape[1])
    usable_faces = []
    for face in faces:
        x1, y1, x2, y2 = [float(point) for point in face.bbox]
        side = min(x2 - x1, y2 - y1)
        if side >= MIN_FACE_SIDE and getattr(face, "kps", None) is not None:
            usable_faces.append((face, max(0.0, side), max(0.0, (x2 - x1) * (y2 - y1))))
    if not usable_faces:
        raise HTTPException(status_code=422, detail="The face is too small or unclear to process.")

    face, _, face_area = max(
        usable_faces,
        key=lambda item: float(item[0].det_score) * item[2],
    )
    detector_confidence = float(np.clip(float(face.det_score), 0, 1))
    size_quality = float(np.clip(np.sqrt(face_area / image_area) * 3.0, 0, 1))
    sharpness = float(cv2.Laplacian(image, cv2.CV_64F).var())
    sharpness_quality = float(np.clip(sharpness / 220.0, 0, 1))
    quality_score = float(np.clip(detector_confidence * size_quality * (0.5 + sharpness_quality / 2), 0, 1))
    embedding = np.asarray(face.normed_embedding, dtype=np.float32)
    if embedding.shape != (512,) or not np.isfinite(embedding).all():
        raise HTTPException(status_code=500, detail="The configured recognizer returned an invalid feature vector.")

    await admin_request(
        "POST",
        "/rest/v1/profile_photos",
        params={"on_conflict": "photo_id"},
        headers={"Prefer": "resolution=merge-duplicates"},
        json={
            "photo_id": str(payload.photo_id),
            "user_id": user_id,
            "storage_path": normalized_path,
            "mime_type": payload.mime_type,
        },
    )
    await admin_request(
        "POST",
        "/rest/v1/face_features",
        params={"on_conflict": "photo_id"},
        headers={"Prefer": "resolution=merge-duplicates"},
        json={
            "photo_id": str(payload.photo_id),
            "user_id": user_id,
            "embedding": "[" + ",".join(f"{value:.8f}" for value in embedding) + "]",
            "quality_score": quality_score,
            "detector_confidence": detector_confidence,
            "model_name": MODEL_NAME,
        },
    )

    stored_features = await admin_request(
        "GET",
        "/rest/v1/face_features",
        params={"user_id": f"eq.{user_id}", "select": "embedding,quality_score", "order": "quality_score.desc"},
    )
    all_features = stored_features.json()
    selected = all_features[:2]
    vectors = [np.fromstring(row["embedding"].strip("[]"), sep=",") for row in selected]
    weights = np.asarray([max(float(row["quality_score"]), 0.01) for row in selected], dtype=np.float32)
    centroid = np.average(np.stack(vectors), axis=0, weights=weights)
    centroid /= max(float(np.linalg.norm(centroid)), 1e-8)
    await admin_request(
        "POST",
        "/rest/v1/profile_face_vectors",
        params={"on_conflict": "user_id"},
        headers={"Prefer": "resolution=merge-duplicates"},
        json={
            "user_id": user_id,
            "embedding": "[" + ",".join(f"{value:.8f}" for value in centroid) + "]",
            "photo_count": len(all_features),
            "quality_score": float(np.average(weights)),
            "updated_at": datetime.now(timezone.utc).isoformat(),
        },
    )
    return {
        "photo_id": str(payload.photo_id),
        "processed": True,
        "quality_score": round(quality_score, 4),
        "model": MODEL_NAME,
    }


@app.post("/v1/photos/index")
async def index_photo(
    payload: IndexPhotoRequest,
    authorization: str | None = Header(default=None),
) -> dict[str, object]:
    user_id = await authenticated_user_id(authorization)
    return await process_photo(user_id, payload)


@app.post("/v1/admin/demo-photos/backfill")
async def backfill_demo_photos(x_backfill_token: str | None = Header(default=None)) -> dict[str, object]:
    if not FACE_BACKFILL_TOKEN or not x_backfill_token or not hmac.compare_digest(FACE_BACKFILL_TOKEN, x_backfill_token):
        raise HTTPException(status_code=401, detail="A valid backfill token is required.")

    profiles_response = await admin_request(
        "GET",
        "/rest/v1/profiles",
        params={
            "is_demo": "eq.true",
            "face_learning_consent": "eq.true",
            "photo_url": "not.is.null",
            "select": "user_id,photo_url",
            "limit": "1000",
        },
    )
    indexed_response = await admin_request(
        "GET",
        "/rest/v1/profile_face_vectors",
        params={"select": "user_id", "limit": "1000"},
    )
    already_indexed = {row["user_id"] for row in indexed_response.json()}
    semaphore = asyncio.Semaphore(4)

    async def process_demo_profile(profile: dict[str, str]) -> dict[str, str]:
        user_id = profile["user_id"]
        if user_id in already_indexed:
            return {"user_id": user_id, "status": "already processed"}
        photo_url = profile.get("photo_url") or ""
        marker = "/storage/v1/object/public/profile-photos/"
        parsed_url = urlparse(photo_url)
        if marker not in parsed_url.path:
            return {"user_id": user_id, "status": "skipped: unsupported photo URL"}
        storage_path = unquote(parsed_url.path.split(marker, 1)[1])
        extension = storage_path.rsplit(".", 1)[-1].lower()
        mime_type = {"jpg": "image/jpeg", "jpeg": "image/jpeg", "png": "image/png", "webp": "image/webp"}.get(extension)
        if not mime_type or not storage_path.startswith(f"demo/{user_id}/"):
            return {"user_id": user_id, "status": "skipped: unsupported photo path or type"}
        photo_id = uuid.uuid5(uuid.NAMESPACE_URL, photo_url)
        try:
            async with semaphore:
                await process_photo(user_id, IndexPhotoRequest(
                    photo_id=photo_id, storage_path=storage_path, mime_type=mime_type
                ), demo_backfill=True)
            return {"user_id": user_id, "status": "processed"}
        except HTTPException as error:
            return {"user_id": user_id, "status": f"failed: {error.detail}"}
        except Exception:
            return {"user_id": user_id, "status": "failed: unexpected service error"}

    results = await asyncio.gather(*(process_demo_profile(profile) for profile in profiles_response.json()))
    return {"count": len(results), "results": results}
