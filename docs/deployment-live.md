# 🚀 Deployment auf Live (Hetzner)

> **Ziel:** Knora auf dem Hetzner-Produktionsserver deployen.
> **Domain:** [knora.elmarhepp.de](https://knora.elmarhepp.de) — die API läuft
> unter demselben Namen auf `/api/`, es gibt **keine** eigene API-Subdomain.
> **Server:** `knora.elmarhepp.de` (Hetzner, IP via Spaceship-DNS)

---

## 📋 Voraussetzungen

- SSH-Zugang via `~/.ssh/config` unter dem Host `elmarhepp`
- Docker & Docker Compose auf dem Server installiert
- Nginx-Reverse-Proxy auf dem Server (für Subdomain-Routing)
- DNS-Eintrag bei Spaceship:
  - `knora.elmarhepp.de` → Server-IP
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
# Die App-Rolle, NICHT die Wartungsrolle `knora`. knora_app ist Eigentümerin
# der Tabellen (kann also migrieren), aber kein Superuser und kommt damit nicht
# an die Datenbanken der anderen Apps in derselben Instanz.
DB_USER=knora_app
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

> **Wichtig:** Die `DATABASE_URL` wird automatisch aus `DB_USER`, `DB_PASSWORD` und dem DB-Host `pg-shared` zusammengesetzt (siehe `docker-compose.yml`). Kein manuelles Setzen nötig.

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

## 🗄️ 3. Datenbank-Migrationen anwenden

> **Wichtig:** Der `app`-Container enthält nur das gebündelte `dist/` – **kein**
> `drizzle-kit`, keine `db:migrate`/`db:seed`-Scripts, keinen `drizzle/`-Ordner.
> `docker compose exec app bun run db:migrate` funktioniert daher **nicht**.
> Migrationen werden stattdessen als **rohes SQL direkt in den DB-Container**
> gespielt – die `.sql`-Dateien liegen nach `git pull` im Checkout unter
> `backend/drizzle/`.
>
> **Seit der DB-Konsolidierung** läuft Postgres nicht mehr in knoras Compose-Stack,
> sondern als gemeinsame Instanz unter `/var/www/pg-shared` (Container und
> Netzwerkname `pg-shared`). Statt `docker compose exec db` also
> **`docker exec -i pg-shared`** verwenden.
>
> **Achtung bei `-U "$DB_USER"`:** Seit dem 2. August ist `DB_USER` in der `.env`
> die App-Rolle `knora_app` — sie ist Eigentümerin der Tabellen und darf damit
> DDL, aber sie ist **kein** Superuser. Für Wartung, die mehr braucht (neue
> Extensions, Rollen, `pg_dumpall`), stattdessen `-U knora` verwenden.

```bash
ssh elmarhepp
cd /var/www/knora
# DB-User aus der .env
source .env

# NUR die noch nicht angewandten Migrationen einspielen (additive DDL).
# Reihenfolge einhalten. Bereits angewandte NICHT erneut ausführen
# (raw SQL ist nicht idempotent → "column already exists").
docker exec -i pg-shared psql -U "$DB_USER" -d knora < backend/drizzle/0002_naive_ultimo.sql
docker exec -i pg-shared psql -U "$DB_USER" -d knora < backend/drizzle/0003_careless_ghost_rider.sql
docker exec -i pg-shared psql -U "$DB_USER" -d knora < backend/drizzle/0004_polite_mongoose.sql
# 0005 ist idempotent (IF NOT EXISTS) und enthält ein Backfill, das bereits
# generierte Kapitel-Artikel an ihre Übersichtsseite hängt.
docker exec -i pg-shared psql -U "$DB_USER" -d knora < backend/drizzle/0005_flowery_spyke.sql

# 0008–0010 (2. August 2026). Alle drei sind idempotent bzw. wiederholbar:
#   0008  Trigramm-Index, damit die Wiki-Suche ihren Volltextindex nutzt
#   0009  HNSW-Vektorindex (auf dem Server bereits vorhanden → No-Op)
#   0010  COLLATE "C" auf Slugs, E-Mail und Session-Token
docker exec -i pg-shared psql -U "$DB_USER" -d knora < backend/drizzle/0008_wiki_search_trgm.sql
docker exec -i pg-shared psql -U "$DB_USER" -d knora < backend/drizzle/0009_hnsw_index.sql
docker exec -i pg-shared psql -U "$DB_USER" -d knora < backend/drizzle/0010_collate_c_identifiers.sql
```

**Welche Migrationen fehlen?** Vorhandene Spalten/Tabellen prüfen, z. B.:

```bash
# Hat die documents-Tabelle schon die channel-Spalte (Migration 0002)?
docker exec -i pg-shared psql -U "$DB_USER" -d knora -c "\d documents" | grep channel
# Gibt es die topics-Tabelle (0003) / wiki_page_revisions (0004)?
docker exec -i pg-shared psql -U "$DB_USER" -d knora -c "\dt" | grep -E "topics|wiki_page_revisions"
# Hat wiki_pages schon parent_slug/sort_order (0005)?
docker exec -i pg-shared psql -U "$DB_USER" -d knora -c "\d wiki_pages" | grep -E "parent_slug|sort_order"
```

Nur die Migrationen einspielen, deren Objekte noch fehlen.

> **Seed (nur Erstinstallation):** Der Admin-User wird ebenfalls nicht im
> Container geseedet. Bei einer frischen DB einmalig lokal gegen die Prod-DB
> (`bun run db:seed`) oder den User direkt per SQL anlegen. Bei bestehender DB
> mit Usern **nicht nötig**.

---

## ✅ 4. Health-Check

Nach dem Deployment prüfen:

```bash
# Backend-Health (nginx im Frontend-Container reicht /health an app:3000 durch).
# Der Endpunkt führt ein `select 1` gegen die Datenbank aus und antwortet mit
# 503, wenn sie nicht erreichbar ist.
curl https://knora.elmarhepp.de/health
# → {"status":"ok","db":"ok"}

# Container-Zustand (alle drei Dienste haben einen Healthcheck)
ssh elmarhepp 'cd /var/www/knora && docker compose ps'
```

---

## 🌐 5. Nginx-Reverse-Proxy (Server-Konfiguration)

Auf dem Server genügt **ein** Serverblock. Anders als die übrigen Apps auf dem
Host exponiert knora keinen API-Port: der `app`-Container ist nur im
Docker-Netz erreichbar, und der nginx **im Frontend-Container** leitet `/api/`
und `/health` intern an `app:3000` weiter (siehe `frontend/nginx.conf`). Eine
Subdomain `knora-api.elmarhepp.de` gibt es deshalb nicht und hat nie existiert.

### `knora.elmarhepp.de` → Frontend-Container

```nginx
server {
    listen 80;
    server_name knora.elmarhepp.de;

    location / {
        proxy_pass http://127.0.0.1:3081;   # = FRONTEND_PORT aus der .env
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

> **Portvergabe:** `FRONTEND_PORT` steht auf dem Server auf **3081**, nicht auf
> dem Compose-Default 3084. Vor einer Änderung gegenprüfen, dass der neue Port
> nicht schon belegt ist:
> `ssh elmarhepp 'grep -rh proxy_pass /etc/nginx/sites-available/ | sort -u'` —
> `sites-available`, nicht `sites-enabled`, denn eine deaktivierte Config kann
> jederzeit wieder aktiviert werden.

> **Tipp:** Für HTTPS via Let's Encrypt/Certbot die Blöcke erweitern.

---

## 🧩 6. Parser (optional)

Der Python-Parser für PDF/DOCX läuft **immer mit** — das Profil-Gate wurde
entfernt, weil `docker compose up -d --build` beim Deploy ihn sonst nicht
startet und jeder PDF-Import abbricht. Er braucht keine gesonderte Aktivierung.

```bash
ssh elmarhepp 'cd /var/www/knora && docker compose ps parser'
```

---

## 🔄 7. Update / Re-Deployment

Einfach `deploy.sh` erneut ausführen – Git pullt die neuesten Changes, Docker baut nur bei Bedarf neu:

```bash
./deploy.sh            # main-Branch
./deploy.sh feature-x  # feature-Branch
```

Bei Datenbank-Änderungen zusätzlich die neuen Migrationen einspielen — siehe
[Abschnitt 3](#-3-datenbank-migrationen-anwenden) (rohes SQL in den DB-Container,
da der `app`-Container kein `drizzle-kit` enthält).

---

## 🐞 8. Troubleshooting

| Problem                                  | Lösung                                                                                  |
| ---------------------------------------- | --------------------------------------------------------------------------------------- |
| `knora.elmarhepp.de` lädt nicht          | DNS prüfen, Nginx-Konfiguration prüfen, `docker compose ps` auf Server                  |
| `/api/…` antwortet nicht, Frontend lädt  | `app`-Container prüfen (`docker compose ps`, Healthcheck), dann `docker compose logs app` |
| `/health` liefert 503                    | Datenbank nicht erreichbar – `docker ps` für `pg-shared`, Netz `hetzner-network` prüfen |
| YouTube-Import schlägt fehl              | Provider-Konfiguration prüfen (Apify/Supadata); auf Hetzner geht direktes YouTube nicht |
| LLM-Antworten kommen nicht               | `OPENAI_API_KEY` / `DEEPSEEK_API_KEY` in `.env` prüfen                                  |
| Datenbank-Fehler / fehlende Spalte/Tabelle | Migration fehlt – neue `.sql` via `psql` in den DB-Container spielen (Abschnitt 3)     |
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

# Kompletter Reset des App-Stacks
docker compose down
docker compose up -d
```

> **Zur Datenhaltung:** Die Datenbank gehört seit dem 1. August 2026 nicht mehr
> zu diesem Stack, sondern zu `/var/www/pg-shared`. `docker compose down` hier
> ist deshalb harmlos, und auch `down -v` löscht die knora-Daten **nicht** —
> das Volume `knora_data` ist dort als `external: true` eingebunden, und
> externe Volumes entfernt Compose nie. Umgekehrt gilt: ein
> `docker compose down` in `/var/www/pg-shared` legt vier Apps gleichzeitig
> lahm.

---

## 🔐 10. Sicherheit

- `JWT_SECRET` mit `openssl rand -base64 32` generieren
- `DB_PASSWORD` mit einem starken Passwort setzen
- `DB_USER`, `DB_PASSWORD` und `JWT_SECRET` sind in der Compose als
  Pflichtvariablen deklariert (`${VAR:?…}`). Fehlt eine, bricht der Start ab,
  statt still mit einem Default-Secret weiterzulaufen
- `.env` liegt **nur** auf dem Server, nicht im Repo, und hat Mode `600` —
  sie enthält DB-Passwort, JWT-Secret und die LLM-/Apify-Schlüssel
- Nur der Frontend-Port ist auf dem Host gemappt, und der an `127.0.0.1`.
  `app`, `parser` und die Datenbank sind ausschließlich im Docker-Netz erreichbar
