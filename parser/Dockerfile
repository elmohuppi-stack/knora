FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY main.py .
EXPOSE 8000
# --timeout 1800: gunicorn-Default sind 30 s – ein PDF mit tausenden Seiten wird von
#   MarkItDown niemals in 30 s geparst, der Worker würde mit "WORKER TIMEOUT" gekillt.
# --workers 2: ein einzelner sync-Worker blockiert den gesamten Parser für die Dauer
#   eines langen Parses; mit 2 Workern bleibt der Health-Check/parallele Requests bedienbar.
CMD ["gunicorn", "--bind", "0.0.0.0:8000", "--timeout", "1800", "--workers", "2", "main:app"]
