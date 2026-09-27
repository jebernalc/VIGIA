FROM python:3.12-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app.py cloud.py ./
COPY static ./static
RUN mkdir -p /app/data && useradd -r -u 10001 vigia && chown -R vigia:vigia /app
USER vigia
ENV VIGIA_DATA=/app/data
CMD ["sh", "-c", "exec uvicorn app:app --host 0.0.0.0 --port ${PORT:-8000}"]
