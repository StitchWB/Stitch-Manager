<p align="center">
  <img src="resources/branding/stitch-ide-logo.png" alt="Stitch Manager Logo" width="200">
</p>

<h1 align="center">Stitch Manager</h1>

<p align="center">
  <strong>🇺🇸 Universal Account Manager for AI IDEs and AI Providers</strong><br>
  <strong>🇷🇺 Универсальный менеджер аккаунтов для AI IDE и AI-провайдеров</strong>
</p>

<p align="center">
  <a href="#-english">English</a> •
  <a href="#-русский">Русский</a>
</p>

<p align="center">
  <img src="https://img.shields.io/github/v/release/StitchWB/Stitch-Manager?style=flat-square&color=6366f1" alt="Release">
  <img src="https://img.shields.io/badge/Python-FastAPI-009688?style=flat-square&logo=fastapi" alt="Python FastAPI">
  <img src="https://img.shields.io/badge/Python-3.11+-3776AB?style=flat-square&logo=python&logoColor=white" alt="Python 3.11+">
  <img src="https://img.shields.io/badge/React-18-61DAFB?style=flat-square&logo=react" alt="React 18">
  <img src="https://img.shields.io/github/license/StitchWB/Stitch-Manager?style=flat-square&color=green" alt="License">
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Windows-0078D6?style=flat-square&logo=windows&logoColor=white" alt="Windows">
  <img src="https://img.shields.io/badge/Linux-FCC624?style=flat-square&logo=linux&logoColor=black" alt="Linux">
</p>

---

> ⚠️ **Disclaimer / Отказ от ответственности**
>
> This project is provided **as is** for educational and personal account
> management purposes. Users are solely responsible for complying with the
> Terms of Service of any target application or service. The authors assume
> no liability for account suspensions, API blocks, IP bans, or any other
> consequences arising from use of this software.
>
> Проект предоставляется **«как есть»** в образовательных целях и для
> управления личными аккаунтами. Пользователь несёт полную ответственность
> за соблюдение условий использования (ToS) целевых приложений и сервисов.
> Авторы не несут ответственности за блокировки аккаунтов, API, IP или иные
> последствия использования данного ПО.

---

# 🇺🇸 English

## 🎯 What is Stitch Manager?

**Stitch Manager** is a cross-platform desktop app for managing multiple accounts across AI-powered IDEs and AI inference providers. It features a plugin-driven architecture with a marketplace for community extensions.

### Why use it?

- 🔄 **Switch accounts instantly** — No IDE restart required
- 🤖 **Auto-registration** — Create accounts automatically with browser automation
- 🔧 **IDE Patcher** — Enable multi-account support in IDE extensions
- 📊 **Quota tracking** — Monitor usage across all accounts
- 🎨 **Beautiful UI** — Modern Deep Space theme with glassmorphism

---

## ✨ Features

### Provider Matrix

Built-in providers from `python/autoreg/providers/registry.py`:

| Category | Provider | AutoReg | Quota Tracking | AI Proxy |
|----------|----------|:------:|:--------------:|:--------:|
| **IDE autoreg** | Kiro | ✅ | ✅ | ✅ |
| | Kiro v2 | ✅ | ✅ | ✅ |
| | Windsurf | ✅ | ✅ | ✅ |
| | Trae | ✅ | ❌ | ❌ |
| | Qoder | ✅ | ❌ | ❌ |
| **Git auth** | GitHub | ❌ | ❌ | ❌ |
| | Bitbucket | ❌ | ❌ | ❌ |
| **Cloud** | AWS | ❌ | ❌ | ❌ |
| | AWS Builder ID | ❌ | ❌ | ❌ |
| **AI inference** | OpenAI | ❌ | ❌ | ✅ |
| | Copilot | ❌ | ❌ | ✅ |
| | Claude | ❌ | ❌ | ✅ |
| | Anthropic | ❌ | ❌ | ✅ |
| | Gemini | ❌ | ❌ | ✅ |
| | Antigravity | ❌ | ❌ | ✅ |
| | Z.AI | ❌ | ❌ | ✅ |
| | Fireworks | ✅ | ❌ | ✅ |
| | v0.dev | ✅ | ❌ | ❌ |

### Feature Bullets

- Machine ID management per account
- Session reuse for faster login
- Proxy library + `proxy.switch` workflow
- Identity graph / Google Sheets ingestion
- Roles & tiers (`user` → `vip` → `premium` → `elite` → `admin`)
- Per-user encryption (Fernet at rest, OS keyring for proxy creds)
- Marketplace with rich plugin metadata (manifest v2 categories, status, features, changelog)
- AI Hub gateway — routing engine with circuit breakers and credential pools
- Automation scenarios + scheduler
- Mail inbox profiles
- TOTP / 2FA vault
- Friends / referrals
- AiApiRadar offers
- Plugin sandbox isolation (isolated subprocesses over stdio JSON-RPC, declarative contributions via `stitch.plugin/v2` schema)

### 🧭 Proxy Library + Scenario proxy.switch

- **Proxy Library** in Settings with bulk import (`host:port` and `host:port:user:pass`)
- Link profile default proxy to a **library entry** instead of raw manual URL
- Recorder overlay supports **proxy.switch** step recording; replay handles it as **session restart boundary**
- `proxy.switch` restarts browser session with a new proxy (not hot-swap)
- Proxy credentials stored via keyring-backed references; delete/disable guarded

### 🧩 Identity Graph + Google Sheets

Ingest an **Identity Graph** from a Google Spreadsheet (service account JWT flow):

- Graph view: which service accounts are authorized via which identity
- Sheets explorer: browse `SVC_*` sheets in-app

Schema reference: `docs/google-sheets-graph-schema.md`

---

## 🤖 AI Gateway

Built-in AI gateway (`python/stitch_backend/domains/ai_gateway/routing_engine.py`) routes requests across inference providers registered in the provider registry. Supports capability-aware routing, circuit breakers, credential pools, and group quotas.

- **FreeModel bridge** ([setup](docs/freemodel-setup.md)) — Claude models via local bridge process (port 3456), managed through **AI Hub → FreeModel**.
- **Z.AI / GLM** ([setup](docs/zai-glm-setup.md)) — web-session adapter seam for GLM models.
- **LiteLLM** remains only as an executor adapter (`python/stitch_backend/domains/ai_proxy/litellm_gateway.py`), NOT the router.

---

## 🏗️ Architecture

- **Backend:** Python FastAPI + SQLite + SQLAlchemy
- **Frontend:** React 18 + TypeScript + TailwindCSS + Zustand
- **Plugins:** isolated subprocesses communicating over stdio JSON-RPC with declarative contributions (`stitch.plugin/v2` schema)
- **Engine-pack:** ships captcha solvers including a bundled vendor service
- Compiled (Nuitka) provider artifacts supported

---

## 🧩 Plugin Ecosystem

**17 official plugins** = 9 service plugins + engine-pack + 7 autoreg provider plugins + github-autoreg legacy v1.

### Service Plugins (9)

| Plugin | Description |
|--------|-------------|
| [`stitch-totp`](https://github.com/StitchWB/stitch-totp) | 2FA: TOTP keys, secrets, and time-based codes |
| [`stitch-mail`](https://github.com/StitchWB/stitch-mail) | Email inbox management: IMAP, wait-for-email, Mail.tm profiles |
| [`stitch-sheets`](https://github.com/StitchWB/stitch-sheets) | Identity Graph ingestion from Google Sheets |
| [`stitch-radar`](https://github.com/StitchWB/stitch-radar) | AiApiRadar offers tracking and usage statistics |
| [`stitch-opencode`](https://github.com/StitchWB/stitch-opencode) | OpenCode config management and API testing |
| [`stitch-notebooklm`](https://github.com/StitchWB/stitch-notebooklm) | NotebookLM notebooks, Q&A, and audio generation |
| [`stitch-cards`](https://github.com/StitchWB/stitch-cards) | Card tools for registration workflows |
| `stitch-freemodel` | FreeModel bridge: Claude models (FM-*) via local proxy |
| [`stitch-antigravity`](https://github.com/StitchWB/stitch-antigravity) | Antigravity: Google OAuth login (PKCE+loopback) and auth files |

### Autoreg Provider Plugins (7)

kiro · kiro-v2 · windsurf · trae · fireworks · qoder · v0-app

Plus **github-autoreg** legacy v1.

### Marketplace

Marketplace page surfaces categories, status, features, and changelog from manifest v2 rich metadata.

### Publishing

Official publishing runs exclusively through the [stitch-ci farm](https://github.com/StitchWB/stitch-ci) workflows: `gh workflow run publish-<kind>.yml --repo StitchWB/stitch-ci` (pin `-f version=` to the manifest semver for providers/engine-pack). `python -m stitch_plugin_tools publish-all --dry-run` is the local pipeline validation only. The `STITCH_SIGNING_KEY`, `STITCH_PUBLISH_URL`, `STITCH_ADMIN_KEY` secrets live in the farm, not in this repo.

### Authoring

[Service Plugins Guide](docs/service-plugins.md) · [Plugin Authoring Guide](docs/plugin-authoring.md) · [Plugin Template Repo](https://github.com/StitchWB/stitch-plugin-template) · [Community Plugin Catalog](https://github.com/StitchWB/stitch-plugin-catalog)

---

## 🗺️ Application Map

One line per sidebar page:

- **Dashboard** (`/app`) — overview
- **Accounts** (`/accounts`) — account list and management
- **Groups** (`/groups`) — user groups
- **AutoReg** (`/autoreg`) — automated registration flows
- **IDE Patch** (`/patcher`) — extension patching (desktop only)
- **AI Hub** (`/ai`) — AI gateway routing and provider management
- **AiApiRadar** (`/radar`) — offer tracking
- **Automation** (`/automation`) — scenario execution
- **Scheduler** — scheduled task management
- **Mail** (`/mail`) — inbox profiles
- **Tools** (`/tools`) — utility tools
- **2FA** (`/totp`) — TOTP vault
- **Friends** (`/friends`) — referrals
- **Marketplace** (`/marketplace`) — plugin store
- **Plugins admin** (`/plugins`) — plugin administration
- **Settings** (`/settings`) — configuration
- **Logs** (`/logs`) — activity logs
- **Users** (`/users`) — user management (admin)
- **Codes** (`/codes`) — license code management (admin)
- **Monitoring** (`/monitoring`) — health probes (admin)
- **Privileges** (`/privileges`) — permission management (admin)

## 🌐 Web, Roles & Operations

### Web version & authentication

- Web app served from your own domain alongside the desktop client
- Login by password or one-time Telegram code (bot `/login` command)
- Guest mode gated by the `enforce_login` flag
- First Telegram login from a bot-admin account is mirrored as web admin

### Roles & tiers

- Role ladder: `user` < `vip` < `premium` < `elite` < `admin`
- Admin zone exposes Users, Codes and Monitoring pages plus the admin API
- Roles are editable from the Users page
- Scenarios declare a `min_role` tier; below-tier users see a lock and badge

### Per-user data & encryption

- Per-user scope: accounts, proxy library, TOTP secrets, mail inbox profiles, settings overrides, AI gateway, profiles and flows
- Legacy rows remain shared for backward compatibility
- Secrets encrypted at rest with Fernet; proxy credentials stored via OS keyring

### Monitoring

- `/monitoring` admin page surfaces server, web and external probes
- Bot heartbeat and Telegram-proxy health tracked alongside
- Bot emits a heartbeat every 30 seconds

### Distribution & marketplace

- Official plugins require activation through entitlements
- Community plugins remain open
- Marketplace access on web requires authentication

### Ops scripts

| Script | Purpose |
|--------|---------|
| `scripts/deploy-vds.ps1` | One-shot VDS deploy, key-based SSH, creds from `~/.secrets/ssh-vps-password` |
| `scripts/start-bot.ps1` | Start bot with `-Token` and `-Proxy` flags |
| `scripts/toggle-local-role.ps1` | Toggle local user role for testing |
| `scripts/proxy_autopilot.py` | Refresh free-proxy list for the bot |
| `scripts/ci-local.ps1` | Local equivalent of CI checks — run CI locally for faster feedback |
| `scripts/compile_provider_plugin.py` | Assemble + Nuitka-compile a provider plugin package (CI step) |
| `scripts/build_encrypted_plugin.py` | Build ONE provider plugin into an ENCRYPTED artifact |
| `scripts/bump_service_plugins.py` | Advance plugins-src/ service-plugin submodules to their remote default branch |
| `scripts/export_public_zone.py` | Export Zone 1 (open-core) to the public app repo |

---

## 📥 Installation

### Download

Get the latest release for your platform:

| Platform | Download |
|----------|----------|
| Windows | [`stitch-setup-X.Y.Z.exe`](https://github.com/StitchWB/Stitch-Manager/releases/latest) (installer) or [`stitch-portable-X.Y.Z.zip`](https://github.com/StitchWB/Stitch-Manager/releases/latest) (portable) |
| Linux | [`stitch-linux-X.Y.Z`](https://github.com/StitchWB/Stitch-Manager/releases/latest) (standalone binary) |

### Build from Source

```bash
# Clone
git clone https://github.com/StitchWB/Stitch-Manager.git
cd Stitch-Manager

# Install dependencies (recommended - all-in-one)
python scripts/bootstrap.py

# OR install manually:
npm install                                    # Frontend dependencies
pip install -r python/requirements-dev.txt    # Python dev dependencies
# Note: use 'uv pip install' instead of 'pip install' for 10x faster installation

# Development mode (auto-installs missing Python deps)
.\start-dev.ps1

# Production mode
.\start.ps1
```

**Requirements:**

- Node.js 18+ (for the frontend build)
- Python 3.11+ (backend + auto-registration)
- Git (for cloning)

**Optional (recommended):**
- [uv](https://docs.astral.sh/uv/) — 10x faster Python package installer

### Сборка из исходников

```bash
# Clone
git clone https://github.com/StitchWB/Stitch-Manager.git
cd Stitch-Manager

# Install dependencies (recommended - all-in-one)
python scripts/bootstrap.py

# OR install manually:
npm install                                    # Frontend dependencies
pip install -r python/requirements-dev.txt    # Python dev dependencies
# Note: use 'uv pip install' instead of 'pip install' for 10x faster installation

# Development mode (auto-installs missing Python deps)
.\start-dev.ps1

# Production mode
.\start.ps1
```

---

## 🛠️ Tech Stack

```
Frontend:  React 18 • TypeScript • TailwindCSS • Zustand
Backend:   Python • FastAPI • SQLite • SQLAlchemy
Automation: Python • DrissionPage • IMAPClient
```

## 📚 Deep Dives

- [Features overview](docs/FEATURES.md)
- [Repo map](docs/REPO-MAP.md)
- [Development guide](docs/DEVELOPMENT.md)
- [Testing](docs/testing.md)
- [VPS deployment](docs/vps-deploy.md)
- [CI secrets setup](docs/ci-secrets-setup.md)
- [Custom providers UI](docs/CUSTOM_PROVIDERS_UI.md)
- [Key metrics & cost tracking](docs/KEY_METRICS.md)
- [Password handling guide](docs/PASSWORD-HANDLING-GUIDE.md)

## 📄 License

MIT License — see [LICENSE](LICENSE)

---

# 🇷🇺 Русский

## 🎯 Что такое Stitch Manager?

**Stitch Manager** — кроссплатформенное приложение для управления аккаунтами в AI IDE и AI-провайдерах. Плагинная архитектура с маркетплейсом для расширений сообщества.

### Зачем это нужно?

- 🔄 **Мгновенное переключение** — Без перезапуска IDE
- 🤖 **Авто-регистрация** — Создание аккаунтов через браузерную автоматизацию
- 🔧 **Патчер IDE** — Включение мульти-аккаунтов в расширениях
- 📊 **Отслеживание квот** — Мониторинг использования всех аккаунтов
- 🎨 **Красивый UI** — Современная тема Deep Space с glassmorphism

---

## ✨ Возможности

### Матрица провайдеров

Встроенные провайдеры из `python/autoreg/providers/registry.py`:

| Категория | Провайдер | Авторег | Квоты | AI-прокси |
|-----------|-----------|:------:|:-----:|:--------:|
| **IDE авторег** | Kiro | ✅ | ✅ | ✅ |
| | Kiro v2 | ✅ | ✅ | ✅ |
| | Windsurf | ✅ | ✅ | ✅ |
| | Trae | ✅ | ❌ | ❌ |
| | Qoder | ✅ | ❌ | ❌ |
| **Git auth** | GitHub | ❌ | ❌ | ❌ |
| | Bitbucket | ❌ | ❌ | ❌ |
| **Cloud** | AWS | ❌ | ❌ | ❌ |
| | AWS Builder ID | ❌ | ❌ | ❌ |
| **AI inference** | OpenAI | ❌ | ❌ | ✅ |
| | Copilot | ❌ | ❌ | ✅ |
| | Claude | ❌ | ❌ | ✅ |
| | Anthropic | ❌ | ❌ | ✅ |
| | Gemini | ❌ | ❌ | ✅ |
| | Antigravity | ❌ | ❌ | ✅ |
| | Z.AI | ❌ | ❌ | ✅ |
| | Fireworks | ✅ | ❌ | ✅ |
| | v0.dev | ✅ | ❌ | ❌ |

### Список возможностей

- Управление Machine ID для каждого аккаунта
- Переиспользование сессий для быстрого входа
- Библиотека прокси + рабочий процесс `proxy.switch`
- Загрузка Identity Graph из Google Sheets
- Роли и уровни (`user` → `vip` → `premium` → `elite` → `admin`)
- Шифрование на уровне пользователя (Fernet at rest, OS keyring для прокси)
- Маркетплейс с богатыми метаданными плагинов (manifest v2)
- AI Hub шлюз — движок маршрутизации с circuit breaker и пулами учётных данных
- Автоматизация сценариев + планировщик
- Профили почтовых ящиков
- Хранилище TOTP / 2FA
- Друзья / рефералы
- Офферы AiApiRadar
- Изоляция песочницы плагинов (изолированные подпроцессы через stdio JSON-RPC, схема `stitch.plugin/v2`)

### 🔐 Управление аккаунтами

- Безопасное локальное хранение в SQLite
- Активация аккаунта в один клик
- Мониторинг квот в реальном времени
- Импорт/экспорт аккаунтов
- **Автоматическое управление Machine ID для каждого аккаунта**
- **Статистика использования и мониторинг здоровья**
- **Сохранение сессий для быстрого входа**
- **Сохранение данных регистрации**

### 🤖 Авто-регистрация

- Браузерная автоматизация через DrissionPage
- IMAP интеграция для верификации email
- Поддержка прокси
- Настраиваемые паттерны email

### 🔧 Патчер IDE

- Патч расширений для мульти-аккаунтов
- Автоматический бэкап и восстановление
- Безопасный патчинг с валидацией

---

## 🤖 AI Шлюз

Встроенный AI шлюз (`python/stitch_backend/domains/ai_gateway/routing_engine.py`) маршрутизирует запросы между провайдерами инференса. Поддерживает маршрутизацию по возможностям, circuit breaker, пули учётных данных и групповые квоты.

- **Мост FreeModel** ([настройка](docs/freemodel-setup.md)) — модели Claude через локальный bridge (порт 3456), управляется через **AI Hub → FreeModel**.
- **Z.AI / GLM** ([настройка](docs/zai-glm-setup.md)) — адаптер веб-сессии для моделей GLM.
- **LiteLLM** остаётся только как executor-адаптер (`python/stitch_backend/domains/ai_proxy/litellm_gateway.py`), НЕ роутер.

---

## 🏗️ Архитектура

- **Бэкенд:** Python FastAPI + SQLite + SQLAlchemy
- **Фронтенд:** React 18 + TypeScript + TailwindCSS + Zustand
- **Плагины:** изолированные подпроцессы, общающиеся через stdio JSON-RPC с декларативными вкладками (`stitch.plugin/v2` схема)
- **Engine-pack:** включает решатели captcha, включая встроенный вендорный сервис
- Поддерживаются скомпилированные (Nuitka) артефакты провайдеров

---

## 🧩 Экосистема плагинов

**17 официальных плагинов** = 9 сервисных + engine-pack + 7 плагинов autoreg провайдеров + github-autoreg legacy v1.

### Сервисные плагины (9)

| Плагин | Описание |
|--------|----------|
| [`stitch-totp`](https://github.com/StitchWB/stitch-totp) | 2FA: TOTP-ключи, секреты и коды по времени |
| [`stitch-mail`](https://github.com/StitchWB/stitch-mail) | Управление почтовым ящиком: IMAP, wait-for-email, профили Mail.tm |
| [`stitch-sheets`](https://github.com/StitchWB/stitch-sheets) | Загрузка Identity Graph из Google Sheets |
| [`stitch-radar`](https://github.com/StitchWB/stitch-radar) | Отслеживание офферов AiApiRadar и статистика использования |
| [`stitch-opencode`](https://github.com/StitchWB/stitch-opencode) | Управление конфигурацией OpenCode и тестирование API |
| [`stitch-notebooklm`](https://github.com/StitchWB/stitch-notebooklm) | Ноутбуки NotebookLM, Q&A и генерация аудио |
| [`stitch-cards`](https://github.com/StitchWB/stitch-cards) | Карточные инструменты для рабочих процессов регистрации |
| `stitch-freemodel` | Мост FreeModel: Claude-модели (FM-*) через локальный прокси |
| [`stitch-antigravity`](https://github.com/StitchWB/stitch-antigravity) | Antigravity: вход через Google OAuth (PKCE+loopback) и auth-файлы |

### Плагины autoreg провайдеров (7)

kiro · kiro-v2 · windsurf · trae · fireworks · qoder · v0.dev

Плюс **github-autoreg** legacy v1.

### Маркетплейс

Страница маркетплейса показывает категории, статус, фичи и changelog из богатых метаданных manifest v2.

### Публикация

Официальная публикация идёт только через воркфлоу фермы [stitch-ci](https://github.com/StitchWB/stitch-ci): `gh workflow run publish-<kind>.yml --repo StitchWB/stitch-ci` (для провайдеров и engine-pack фиксируйте `-f version=` по semver манифеста). Локально `python -m stitch_plugin_tools publish-all --dry-run` — только валидация пайплайна. Секреты `STITCH_SIGNING_KEY`, `STITCH_PUBLISH_URL`, `STITCH_ADMIN_KEY` живут на ферме, не в этом репо.

### Создание плагинов

[Гайд сервисных плагинов](docs/service-plugins.md) · [Гайд создания плагинов](docs/plugin-authoring.md) · [Шаблон плагина](https://github.com/StitchWB/stitch-plugin-template) · [Каталог плагинов сообщества](https://github.com/StitchWB/stitch-plugin-catalog)

---

## 🗺️ Карта приложения

Одна строка на страницу сайдбара:

- **Dashboard** (`/app`) — обзор
- **Accounts** (`/accounts`) — список и управление аккаунтами
- **Groups** (`/groups`) — группы пользователей
- **AutoReg** (`/autoreg`) — потоки автоматической регистрации
- **IDE Patch** (`/patcher`) — патчинг расширений (только десктоп)
- **AI Hub** (`/ai`) — маршрутизация AI шлюза и управление провайдерами
- **AiApiRadar** (`/radar`) — отслеживание офферов
- **Automation** (`/automation`) — выполнение сценариев
- **Scheduler** — управление запланированными задачами
- **Mail** (`/mail`) — профили почтовых ящиков
- **Tools** (`/tools`) — утилиты
- **2FA** (`/totp`) — хранилище TOTP
- **Friends** (`/friends`) — рефералы
- **Marketplace** (`/marketplace`) — магазин плагинов
- **Plugins admin** (`/plugins`) — администрирование плагинов
- **Settings** (`/settings`) — конфигурация
- **Logs** (`/logs`) — журналы активности
- **Users** (`/users`) — управление пользователями (admin)
- **Codes** (`/codes`) — управление лицензионными кодами (admin)
- **Monitoring** (`/monitoring`) — проверки здоровья (admin)
- **Privileges** (`/privileges`) — управление правами (admin)

## 🌐 Веб, роли и операции

### Веб-версия и аутентификация

- Веб-приложение на вашем домене рядом с десктоп-клиентом
- Вход по паролю или одноразовому Telegram-коду (команда бота `/login`)
- Гостевой режим управляется флагом `enforce_login`
- Первый вход через Telegram от аккаунта бот-админа зеркалируется как веб-админ

### Роли и уровни

- Лестница ролей: `user` < `vip` < `premium` < `elite` < `admin`
- Админ-зона открывает страницы Users, Codes и Monitoring плюс admin API
- Роли редактируются на странице Users
- Сценарии объявляют уровень `min_role`; ниже уровня видят замок и бейдж

### Пользовательские данные и шифрование

- Пер-пользовательский scope: аккаунты, библиотека прокси, TOTP-секреты, профили ящиков, переопределения настроек, AI-шлюз, профили и потоки
- Устаревшие строки остаются общими для обратной совместимости
- Секреты шифруются at rest через Fernet; учётные данные прокси хранятся через OS keyring

### Мониторинг

- Админ-страница `/monitoring` показывает серверные, веб и внешние пробы
- Heartbeat бота и здоровье Telegram-прокси отслеживаются рядом
- Бот отправляет heartbeat каждые 30 секунд

### Дистрибуция и маркетплейс

- Официальные плагины требуют активации через entitlements
- Плагины сообщества остаются открытыми
- Доступ к маркетплейсу на веб требует аутентификации

### Скрипты операций

| Скрипт | Назначение |
|--------|------------|
| `scripts/deploy-vds.ps1` | Одношотный деплой VDS, key-based SSH, учётные данные из `~/.secrets/ssh-vps-password` |
| `scripts/start-bot.ps1` | Запуск бота с флагами `-Token` и `-Proxy` |
| `scripts/toggle-local-role.ps1` | Переключение локальной роли пользователя для тестирования |
| `scripts/proxy_autopilot.py` | Обновление списка free-proxy для бота |
| `scripts/ci-local.ps1` | Локальный аналог CI — запуск проверок локально для быстрой обратной связи |
| `scripts/compile_provider_plugin.py` | Сборка + Nuitka-компиляция пакета провайдера (шаг CI) |
| `scripts/build_encrypted_plugin.py` | Сборка ОДНОГО плагина провайдера в ЗАШИФРОВАННЫЙ артефакт |
| `scripts/bump_service_plugins.py` | Продвинуть сабмодули сервис-плагинов в plugins-src/ до remote-ветки по умолчанию |
| `scripts/export_public_zone.py` | Экспорт Zone 1 (open-core) в публичный репозиторий |

## 📥 Установка

### Скачать

Последний релиз для вашей платформы:

| Платформа | Скачать |
|-----------|---------|
| Windows | [`stitch-setup-X.Y.Z.exe`](https://github.com/StitchWB/Stitch-Manager/releases/latest) (установщик) или [`stitch-portable-X.Y.Z.zip`](https://github.com/StitchWB/Stitch-Manager/releases/latest) (portable) |
| Linux | [`stitch-linux-X.Y.Z`](https://github.com/StitchWB/Stitch-Manager/releases/latest) (автономный бинарник) |

### Сборка из исходников

```bash
# Clone
git clone https://github.com/StitchWB/Stitch-Manager.git
cd Stitch-Manager

# Install dependencies (recommended - all-in-one)
python scripts/bootstrap.py

# OR install manually:
npm install                                    # Frontend dependencies
pip install -r python/requirements-dev.txt    # Python dev dependencies
# Note: use 'uv pip install' instead of 'pip install' for 10x faster installation

# Development mode (auto-installs missing Python deps)
.\start-dev.ps1

# Production mode
.\start.ps1
```

**Requirements:**

- Node.js 18+ (for the frontend build)
- Python 3.11+ (backend + auto-registration)
- Git (for cloning)

**Optional (recommended):**
- [uv](https://docs.astral.sh/uv/) — 10x faster Python package installer

---

## 🛠️ Технологии

```
Frontend:  React 18 • TypeScript • TailwindCSS • Zustand
Backend:   Python • FastAPI • SQLite • SQLAlchemy
Автоматизация: Python • DrissionPage • IMAPClient
```

## 📚 Глубокое погружение

- [Обзор возможностей](docs/FEATURES.md)
- [Карта репозитория](docs/REPO-MAP.md)
- [Руководство по разработке](docs/DEVELOPMENT.md)
- [Тестирование](docs/testing.md)
- [Деплой на VPS](docs/vps-deploy.md)
- [Настройка CI secrets](docs/ci-secrets-setup.md)
- [UI кастомных провайдеров](docs/CUSTOM_PROVIDERS_UI.md)
- [Ключевые метрики и учёт затрат](docs/KEY_METRICS.md)
- [Гайд по обработке паролей](docs/PASSWORD-HANDLING-GUIDE.md)

## 📄 Лицензия

MIT License — см. [LICENSE](LICENSE)

---

<p align="center">
  <strong>Made with ❤️ by <a href="https://github.com/WhiteBite">WhiteBite</a></strong>
</p>
