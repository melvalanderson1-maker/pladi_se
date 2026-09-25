FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

WORKDIR /app

RUN apt-get update && apt-get install -y \
    build-essential \
    curl \
    libgl1 \
    libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .

RUN pip install --no-cache-dir --upgrade pip \
    && pip install --no-cache-dir -r requirements.txt

RUN playwright install --with-deps chromium

COPY . .

EXPOSE 4100

HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=5 \
    CMD curl --fail http://127.0.0.1:4100/health || exit 1

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "4100"]