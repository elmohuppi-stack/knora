BUN := $(shell command -v bun 2>/dev/null || echo ~/.bun/bin/bun)
HOST ?= $(DEPLOY_HOST)

.PHONY: help start stop dev dev-frontend dev-all build migrate db-generate \
        seed shell-backend install deploy docker-build docker-up docker-down \
        logs status

help: ## 📖 Zeigt diese Hilfe an
	@echo ""
	@echo "╔══════════════════════════════════════╗"
	@echo "║           Knora — Makefile           ║"
	@echo "╚══════════════════════════════════════╝"
	@echo ""
	@echo "📦  Installation"
	@echo "  make install         Alle Abhängigkeiten installieren"
	@echo ""
	@echo "🚀  Entwicklung (lokal — Backend + Frontend nativ)"
	@echo "  make start           Docker-Services starten (PostgreSQL)"
	@echo "  make dev             Backend starten (Bun, Port 3000, Hot-Reload)"
	@echo "  make dev-frontend    Frontend starten (Vite, Port 5173, HMR)"
	@echo "  make dev-all         Services + Backend + Frontend starten"
	@echo "  make stop            Docker-Services stoppen"
	@echo "  make logs            Docker-Services Logs anzeigen"
	@echo "  make status          Docker-Services Status prüfen"
	@echo ""
	@echo "🗄️  Datenbank"
	@echo "  make db-generate     Drizzle Migration generieren (nach Schema-Änderung)"
	@echo "  make migrate         Migration ausführen"
	@echo "  make seed            Datenbank mit Testdaten füllen"
	@echo "  make shell-db        PostgreSQL-Shell öffnen"
	@echo ""
	@echo "🐳  Docker (Produktion)"
	@echo "  make build           Docker-Images bauen"
	@echo "  make up              Docker-Services starten (Produktion)"
	@echo "  make down            Docker-Services stoppen (Produktion)"
	@echo ""
	@echo "🚢  Deployment (Hetzner)"
	@echo "  make deploy HOST=user@server   Auf Hetzner deployen"
	@echo ""
	@echo "⚙️  Config: BUN=$(BUN)  |  HOST=$(HOST)"
	@echo ""

# === Installation ===

install: ## 📦 Alle Abhängigkeiten installieren
	@echo "📦 Installiere Abhängigkeiten..."
	cd packages/shared && $(BUN) install
	cd backend && $(BUN) install
	cd frontend && $(BUN) install
	$(BUN) install
	@echo "✅ Fertig!"

# === Entwicklung (lokal) ===

start: ## 🚀 Docker-Services starten (PostgreSQL)
	@echo "🚀 Starte PostgreSQL..."
	docker compose -f docker-compose.dev.yml up -d db
	@echo "   DB:  postgresql://localhost:5432/knora (User: knora)"
	@echo ""
	@echo "💡 Parser (optional): docker compose -f docker-compose.dev.yml --profile parser up -d"

stop: ## 🛑 Docker-Services stoppen
	@echo "🛑 Stoppe Docker-Services..."
	docker compose -f docker-compose.dev.yml down

dev: ## 🔥 Backend starten (Bun, Port 3000, Hot-Reload)
	@echo "🔥 Starte Backend auf http://localhost:3000 ..."
	cd backend && $(BUN) run dev

dev-frontend: ## 💻 Frontend starten (Vite, Port 5173, HMR)
	@echo "💻 Starte Frontend auf http://localhost:5173 ..."
	cd frontend && $(BUN) run dev

dev-all: ## 🚀🔥 Alles starten (Services + Backend + Frontend)
	@echo "🚀 Starte PostgreSQL (falls nicht bereits laufend)..."
	@docker compose -f docker-compose.dev.yml up -d db 2>/dev/null || true
	@echo ""
	@if lsof -i:3000 >/dev/null 2>&1; then \
		echo "⚠️  Backend läuft bereits auf Port 3000 (überspringe)"; \
	else \
		echo "🔥 Starte Backend (Port 3000)..."; \
		cd backend && $(BUN) run dev & \
		sleep 2; \
	fi
	@echo ""
	@if lsof -i:5173 >/dev/null 2>&1; then \
		echo "⚠️  Frontend läuft bereits auf Port 5173 (überspringe)"; \
	else \
		echo "💻 Starte Frontend (Port 5173)..."; \
		cd frontend && $(BUN) run dev; \
	fi

logs: ## 📋 Docker-Services Logs anzeigen
	docker compose -f docker-compose.dev.yml logs -f

status: ## 🔍 Docker-Services Status prüfen
	@echo "🔍 Status:"
	docker compose -f docker-compose.dev.yml ps
	@echo ""
	@echo "PostgreSQL:"
	@docker compose -f docker-compose.dev.yml exec db pg_isready -U knora 2>/dev/null || echo "   ❌ Nicht erreichbar"
	@echo "Parser:"
	@curl -s http://localhost:8001/ 2>/dev/null && echo "   ✅ Laufend" || echo "   ❌ Nicht gestartet (optional: --profile parser)"

# === Datenbank ===

db-generate: ## 🗄️ Drizzle Migration generieren (nach Schema-Änderung)
	@echo "🗄️ Generiere Migration..."
	cd backend && $(BUN) run db:generate
	@echo "✅ Migration generiert in backend/drizzle/"

migrate: ## 🗄️ Migration ausführen
	@echo "🗄️ Führe Migration aus..."
	cd backend && $(BUN) run db:migrate
	@echo "✅ Migration ausgeführt!"

seed: ## 🌱 Datenbank mit Testdaten füllen
	@echo "🌱 Fülle Datenbank mit Testdaten..."
	cd backend && $(BUN) run db:seed
	@echo "✅ Seed abgeschlossen!"

shell-db: ## 🐚 PostgreSQL-Shell öffnen
	docker compose -f docker-compose.dev.yml exec db psql -U knora knora
