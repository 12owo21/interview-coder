"""Local PP-OCR models exposed over HTTP. Coordinates belong to the uploaded image."""

import hashlib
import io
import logging
import os
import secrets
import threading
import time
from contextlib import asynccontextmanager
from uuid import uuid4

from fastapi import Depends, FastAPI, HTTPException, Security, UploadFile
from fastapi.security import APIKeyHeader
from PIL import Image, UnidentifiedImageError
from rapidocr_onnxruntime import RapidOCR

MAX_BYTES = 10 * 1024 * 1024
MAX_PIXELS = 20_000_000
Image.MAX_IMAGE_PIXELS = MAX_PIXELS
engine = None
engine_lock = threading.Lock()
api_key = os.environ["OCR_API_KEY"]
if len(api_key) < 24:
    raise RuntimeError("OCR_API_KEY must have at least 24 characters")


@asynccontextmanager
async def lifespan(app):
    global engine
    engine = RapidOCR(intra_op_num_threads=2, inter_op_num_threads=1)
    yield
    engine = None


app = FastAPI(title="Assessment OCR", version="1.0.0", lifespan=lifespan)
key_header = APIKeyHeader(name="X-API-Key", auto_error=False)


def authenticate(key: str | None = Security(key_header)):
    if not key or not secrets.compare_digest(key.encode(), api_key.encode()):
        raise HTTPException(status_code=401, detail="Invalid API key")


@app.get("/health")
def health():
    if engine is None:
        raise HTTPException(status_code=503, detail="OCR is starting")
    return {"status": "ok", "engine": "RapidOCR/PP-OCRv4", "device": "cpu"}


@app.post("/ocr", dependencies=[Depends(authenticate)])
def recognize(file: UploadFile):
    if engine is None:
        raise HTTPException(status_code=503, detail="OCR is starting")
    if not engine_lock.acquire(blocking=False):
        raise HTTPException(status_code=429, detail="OCR is busy; retry later")

    started = time.perf_counter()
    try:
        data = file.file.read(MAX_BYTES + 1)
        if not data:
            raise HTTPException(status_code=400, detail="Empty image")
        if len(data) > MAX_BYTES:
            raise HTTPException(status_code=413, detail="Image exceeds 10 MiB")
        try:
            with Image.open(io.BytesIO(data)) as image:
                width, height = image.size
                if width * height > MAX_PIXELS:
                    raise HTTPException(status_code=413, detail="Image exceeds 20 megapixels")
                if image.format not in ("PNG", "JPEG", "BMP", "WEBP"):
                    raise HTTPException(status_code=400, detail="Unsupported image format")
                image.verify()
        except Image.DecompressionBombError:
            raise HTTPException(status_code=413, detail="Image dimensions are too large")
        except (UnidentifiedImageError, OSError, SyntaxError, ValueError):
            raise HTTPException(status_code=400, detail="Cannot decode image")

        result, _ = engine(data)
        regions = []
        for box, text, score in result or []:
            points = [[float(x), float(y)] for x, y in box]
            xs, ys = zip(*points)
            regions.append({
                "text": str(text),
                "score": float(score),
                "points": points,
                "box": {
                    "left": min(xs), "top": min(ys),
                    "right": max(xs), "bottom": max(ys)
                }
            })
        return {
            "requestId": str(uuid4()),
            "imageSha256": hashlib.sha256(data).hexdigest(),
            "imageSize": {"width": width, "height": height},
            "coordinateSpace": "input-image",
            "regions": regions,
            "elapsedMs": round((time.perf_counter() - started) * 1000)
        }
    except HTTPException:
        raise
    except Exception:
        logging.exception("OCR request failed")
        raise HTTPException(status_code=500, detail="OCR inference failed")
    finally:
        engine_lock.release()

