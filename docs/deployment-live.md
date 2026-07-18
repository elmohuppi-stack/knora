# 🚀 Deployment auf Live (Hetzner)

> **Ziel:** Knora auf dem Hetzner-Produktionsserver deployen.
> **Domain:** [knora.elmarhepp.de](https://knora.elmarhepp.de) · API: `https://knora-api.elmarhepp.de`
> **Server:** `knora.elmarhepp.de` (Hetzner CX?, IP via Spaceship-DNS)

---

## 📋 Voraussetzungen

- SSH-Zugang via `~/.ssh/config` unter dem Host `elmarhepp`
- Docker & Docker Compose auf dem Server installiert
- Nginx-Reverse-Proxy auf dem Server (für Subdomain-Routing)
- DNS-Einträge bei Spaceship:
  - `knora.elmarhepp.de` → Server-IP
  - `knora-api.elmarhepp.de` → Server-IP
- Hetzner-Netzwerk `hetzner-network` muss auf dem Server existieren:

  ```bash
  ssh elmarhepp
  docker network create hetzner-network
  ```

---

## 🔧 1. Repository auf dem Server klonen & Produktion-`.env` vorbereiten

**Einmalig** das Repo auf dem Server klonen:

```bash
ssh elmarhepp
git clone https://github.com/elmohuppi-stack/knora.git /var/www/knora
```

Danach `.env` im geklonten Verzeichnis anlegen (bleibt lokal auf dem Server, `.env` ist in `.gitignore`):

```bash
cd /var/www/knora
# .env erstellen (Inhalt siehe nächster Abschnitt)
```

Dann `.env` auf dem Server erstellen:

```ini
# === Deployment ===
APP_SLUG=knora
WEB_PORT=3000
FRONTEND_PORT=3084

# === Datenbank ===
DB_USER=knora
DB_PASSWORD=<sicheres Passwort generieren>

# === App ===
JWT_SECRET=<openssl rand -base64 32>

# === Admin Credentials (für Seed) ===
ADMIN_EMAIL=elmar.hepp@gmail.com
ADMIN_PASSWORD=<admin-passwort>
ADMIN_NAME=Elmo

# === LLM Provider ===
OPENAI_API_KEY=sk-...
# oder
DEEPSEEK_API_KEY=sk-...

# === YouTube Import Provider ===
# Hetzner blockt die YouTube-API → externen Provider verwenden
YOUTUBE_TRANSCRIPT_PROVIDER=apify
APIFY_API_KEY=apify_api_...
```

> **Wichtig:** Die `DATABASE_URL` wird automatisch aus `DB_USER`, `DB_PASSWORD` und dem DB-Host `knora-db` zusammengesetzt (siehe `docker-compose.yml`). Kein manuelles Setzen nötig.

---

## 🚢 2. Deployment via `deploy.sh`

Lokal ausführen – `deploy.sh` lädt automatisch die `.env` aus dem Projekt-Root, also einfach `DEPLOY_HOST` dort eintragen.

```bash
# DEPLOY_HOST in der .env (einmalig eintragen, dann automatisch)
echo 'DEPLOY_HOST=elmarhepp' >> .env

# Dann nur noch:
./deploy.sh              # main-Branch
./deploy.sh feature-x    # feature-Branch

# Oder Host als Argument (überschreibt .env)
./deploy.sh elmarhepp          # main
./deploy.sh main elmarhepp     # main explizit
./deploy.sh feature-x elmarhepp
```

### Was `deploy.sh` macht:

1. **`git fetch origin`** – holt die neuesten Branches und Tags
2. **`git checkout <branch>`** – wechselt auf den gewünschten Branch
3. **`git pull origin <branch>`** – zieht die neuesten Änderungen
4. **`docker compose up -d --build`** – baut und startet alle Container neu

> **Kein rsync mehr!** Der Server hat ein eigenes Git-Clone und bleibt so immer sauber synchronisiert. Die `.env` bleibt lokal auf dem Server und wird von Git ignoriert.

---

## 🗄️ 3. Datenbank-Migration & Seed (einmalig)

Nach dem ersten Deployment die Datenbank migrieren und seeden:

```bash
ssh elmarhepp
cd /var/www/knora

# Migration ausführen
docker compose exec app bun run db:migrate

# Admin-User seeden
docker compose exec app bun run db:seed
```

> **Tipp:** Nach `ssh elmarhepp` und `cd /var/www/knora` kannst du auch:
>
> ```bash
> docker compose exec app bun run db:migrate
> docker compose exec app bun run db:seed
> ```

---

## ✅ 4. Health-Check

Nach dem Deployment prüfen:

```bash
# Backend-Health
curl https://knora-api.elmarhepp.de/health
# → {"status":"ok"}

# Oder direkt via localhost auf dem Server
ssh elmarhepp
curl http://127.0.0.1:3000/health
```

---

## 🌐 5. Nginx-Reverse-Proxy (Server-Konfiguration)

Auf dem Hetzner-Server müssen zwei Nginx-Serverblöcke existieren (einmalig einrichten):

### `knora.elmarhepp.de` → Frontend (Port 3084)

```nginx
server {
    listen 80;
    server_name knora.elmarhepp.de;

    location / {
        proxy_pass http://127.0.0.1:3084;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

### `knora-api.elmarhepp.de` → Backend (Port 3000)

```nginx
server {
    listen 80;
    server_name knora-api.elmarhepp.de;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # SSE-Support für Chat-Streaming
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 86400s;
    }
}
```

> **Tipp:** Für HTTPS via Let's Encrypt/Certbot die Blöcke erweitern.

---

## 🧩 6. Parser (optional)

Der Python-Parser für PDF/DOCX wird standardmäßig **nicht** mitgestartet. Aktivieren mit:

```bash
ssh elmarhepp
cd /var/www/knora
docker compose --profile parser up -d --build parser
```

---

## 🔄 7. Update / Re-Deployment

Einfach `deploy.sh` erneut ausführen – Git pullt die neuesten Changes, Docker baut nur bei Bedarf neu:

```bash
./deploy.sh            # main-Branch
./deploy.sh feature-x  # feature-Branch
```

Bei Datenbank-Änderungen zusätzlich migrieren:

```bash
ssh elmarhepp
cd /var/www/knora
docker compose exec app bun run db:migrate
```

---

## 🐞 8. Troubleshooting

| Problem                                  | Lösung                                                                                  |
| ---------------------------------------- | --------------------------------------------------------------------------------------- |
| `knora.elmarhepp.de` lädt nicht          | DNS prüfen, Nginx-Konfiguration prüfen, `docker compose ps` auf Server                  |
| `knora-api.elmarhepp.de` antwortet nicht | Gleiche Prüfung + Health-Endpoint testen                                                |
| YouTube-Import schlägt fehl              | Provider-Konfiguration prüfen (Apify/Supadata); auf Hetzner geht direktes YouTube nicht |
| LLM-Antworten kommen nicht               | `OPENAI_API_KEY` / `DEEPSEEK_API_KEY` in `.env` prüfen                                  |
| Datenbank-Fehler                         | Migration fehlt? `docker compose exec app bun run db:migrate`                           |
| Container starten nicht                  | `docker compose logs app` für Details                                                   |
| Port-Konflikt                            | Prüfen ob Ports 3000/3084 bereits belegt sind: `lsof -i :3000`                          |

---

## 📊 9. Wichtige Befehle (Server)

```bash
# Status
docker compose ps
docker compose logs -f app

# Restart
docker compose restart app

# Shell im Container
docker compose exec app /bin/sh

# Kompletter Reset (Daten bleiben dank Volume erhalten)
docker compose down
docker compose up -d

# Datenbank-Volume löschen (Vorsicht! Alle Daten weg)
docker compose down -v
```

---

## 🔐 10. Sicherheit

- `JWT_SECRET` mit `openssl rand -base64 32` generieren (nicht das Dev-Secret verwenden!)
- `DB_PASSWORD` mit einem starken Passwort setzen
- `.env` liegt **nur** auf dem Server, nicht im Repo
- Die API ist nur über `https://knora-api.elmarhepp.de` erreichbar (Subdomain)
- Interne Ports (3000, 3084) sind nur an `127.0.0.1` gebunden – kein direkter Zugriff von außen
