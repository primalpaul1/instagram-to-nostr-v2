FROM python:3.11-slim

WORKDIR /app

# Install system dependencies for secp256k1
RUN apt-get update && apt-get install -y \
    build-essential \
    libsecp256k1-dev \
    libffi-dev \
    && rm -rf /var/lib/apt/lists/*

# Install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY db.py worker.py schema.sql ./

# Ensure Python output is not buffered (for docker logs)
ENV PYTHONUNBUFFERED=1

# Run the worker
CMD ["python", "worker.py"]
