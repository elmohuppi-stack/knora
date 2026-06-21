BUN := $(shell command -v bun 2>/dev/null || echo ~/.bun/bin/bun)
HOST ?= $(DEPLOY_HOST)

.PHONY: help start stop dev dev-all build migrate db-generate db-studio \
        seed shell-backend install deploy docker-build docker-up docker-down \
        logs status

help: ## 📖 Zeigt diese Hilfe an
	@echo ""
	@echo "╔══════════════════════════════════════╗"
	@echo "║        Wiki-Chat — Makefile          ║"
	@echo "╚══════════════════════════════════════╝"
	@echo ""
	@echo "📦  Installation"
	@echo "  make install         Alle Abhängigkeiten installieren"
	@echo ""
	@echo "🚀  Entwicklung (lokal — Backend + Frontend nativ)"
	@echo "  make start           Docker-Services starten (DB, Redis, Parser)"
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
	@echo "  make shell-backend   Backend-Container-Shell (für DB-Queries)"
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

start: ## 🚀 Docker-Services starten (DB, Redis, Parser)
	@echo "🚀 Starte Docker-Services..."
	docker compose -f docker-compose.dev.yml up -d
	@echo "   DB:      postgresql://localhost:5432"
	@echo "   Redis:   localhost:6379"
	@echo "   Parser:  http://localhost:8001/parse"

stop: ## 🛑 Docker-Services stoppen
	@echo "🛑 Stoppe Docker-Services..."
	docker compose -f docker-compose.dev.yml down

dev: ## 🔥 Backend starten (Bun, Port 3000, Hot-Reload)
	@echo "🔥 Starte Backend auf http://localhost:3000 ..."
	cd backend && $(BUN) run dev

dev-frontend: ## 💻 Frontend starten (Vite, Port 5173, HMR)
	@echo "💻 Starte Frontend auf http://localhost:5173 ..."
	cd frontend && $(BUN) run dev

dev-all: start ## 🚀🔥 Alles starten (Services + Backend + Frontend)
	@echo "🔥 Starte Backend + Frontend..."
	$(BUN) run --cwd backend dev &
	cd frontend && $(BUN) run dev

logs: ## 📋 Docker-Services Logs anzeigen
	docker compose -f docker-compose.dev.yml logs -f

status: ## 🔍 Docker-Services Status prüfen
	@echo "🔍 Status:"
	docker compose -f docker-compose.dev.yml ps
	@echo ""
	@echo "PostgreSQL:"
	@docker compose -f docker-compose.dev.yml exec db pg_isready -U wikichat 2>/dev/null || echo "   ❌ Nicht erreichbar"
	@echo "Redis:"
	@docker compose -f docker-compose.dev.yml exec redis redis-cli ping 2>/dev/null || echo "   ❌ Nicht erreichbar"
	@echo "Parser:"
	@curl -s http://localhost:8001/health 2>/dev/null || echo "   ❌ Nicht erreichbar"

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
	cd backend && $(BUN) run src/db/seed.ts
	@echo "✅ Seed abgeschlossen!"

shell-backend: ## 🐚 Backend-Container-Shell
	docker compose -f docker-compose.dev.yml exec db psql -U wikichat wikichat

# === Docker (Produktion) ===

build: ## 🐳 Docker-Images bauen
	@echo "🐳 Baue Docker-Images..."
	docker compose build
	@echo "✅ Build abgeschlossen!"

up: ## 🐳 Docker-Services starten (Produktion)
	@echo "🐳 Starte Produktions-Services..."
	docker compose up -d
	@echo "✅ Services gestartet!"

down: ## 🐳 Docker-Services stoppen (Produktion)
	@echo "🐳 Stoppe Produktions-Services..."
	docker compose down
	@echo "✅ Services gestoppt!"

# === Deployment ===

deploy: ## 🚢 Auf Hetzner deployen (make deploy HOST=user@server)
	@if [ -z "$(HOST)" ]; then \
		echo "❌ Bitte HOST angeben: make deploy HOST=user@server"; \
		exit 1; \
	fi
	./deploy.sh $(HOST)
