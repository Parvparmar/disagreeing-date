FROM nvidia/cuda:12.8.1-cudnn-runtime-ubuntu22.04

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    HOME=/opt/face-home \
    PIP_DEFAULT_TIMEOUT=180 \
    PIP_RETRIES=10

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3.10 python3.10-dev python3.10-venv build-essential libglib2.0-0 libgomp1 libgl1 \
    && rm -rf /var/lib/apt/lists/*
RUN python3.10 -m venv /opt/venv
ENV PATH=/opt/venv/bin:$PATH
WORKDIR /app
RUN mkdir -p /opt/face-home
COPY requirements.txt .
RUN python -m pip install --no-cache-dir --timeout 180 --retries 10 \
    --upgrade pip setuptools wheel "Cython==0.29.37" "numpy==1.26.4"
RUN python -m pip install --no-cache-dir --prefer-binary --no-build-isolation \
    --timeout 180 --retries 10 -r requirements.txt
RUN python -m pip install --no-cache-dir --no-deps --no-build-isolation \
    --timeout 180 --retries 10 "insightface==0.7.3"
COPY app.py .
EXPOSE 8000
CMD ["sh", "-c", "exec uvicorn app:app --host 0.0.0.0 --port ${PORT:-8000}"]
