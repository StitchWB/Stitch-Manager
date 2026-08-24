<p align="center">
  <img src="resources/branding/stitch-ide-logo.png" alt="Stitch Manager Logo" width="200">
</p>

<h1 align="center">Stitch Manager</h1>

<p align="center">
  <strong>🇺🇸 Universal Account Manager for AI-Powered IDEs</strong><br>
  <strong>🇷🇺 Универсальный менеджер аккаунтов для AI IDE</strong>
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

**Stitch Manager** is a powerful cross-platform desktop app for managing multiple accounts across AI-powered IDEs like **Kiro**, **Windsurf**, and **Trae**.

### Why use it?

- 🔄 **Switch accounts instantly** — No IDE restart required
- 🤖 **Auto-registration** — Create accounts automatically with browser automation
- 🔧 **IDE Patcher** — Enable multi-account support in IDE extensions
- 📊 **Quota tracking** — Monitor usage across all accounts
- 🎨 **Beautiful UI** — Modern Deep Space theme with glassmorphism

---

## ✨ Features

| Feature            | Kiro | Windsurf | Trae |
| ------------------ | :--: | :------: | :--: |
| Account Management |  ✅  |    ✅    |  🚧  |
| Auto-Registration  |  ✅  |    ✅    |  🚧  |
| Token Injection    |  ✅  |    ✅    |  🚧  |
| Extension Patcher  |  ✅  |    ✅    |  🚧  |

### 🧭 Proxy Library + Scenario proxy.switch

- **Proxy Library** in Settings with bulk import (`host:port` and `host:port:user:pass`)
- Link profile default proxy to a **library entry** instead of raw manual URL
- Recorder overlay supports **proxy.switch** step recording and apply+continue flow
- Replay handles `proxy.switch` as **session restart boundary** (expected page state reset)
- Preflight validates missing/disabled proxy targets before replay start

#### Important semantics

- `proxy.switch` does **not** hot-swap network in existing Playwright context.
- It restarts browser session with a new proxy and continues replay from current URL.
- In-page transient state/forms can be reset after switch.

#### Safety model

- Proxy credentials are stored using keyring-backed references with fallback migration path.
- Recorder avoids leaking direct proxy secrets via console fallback channel.
- Delete/disable of in-use proxy entries is guarded; force mode clears references.

### 🧩 Identity Graph + Google Sheets

Stitch Manager can ingest an **Identity Graph** dataset from a Google Spreadsheet (service account JWT flow) and show:

- Graph view: which service accounts are authorized via which identity (e.g. Gmail → TikTok/Facebook/...)
- Sheets explorer: browse `SVC_*` sheets in-app

Schema reference: `docs/google-sheets-graph-schema.md`

### 🔐 Account Management

- Secure local storage with SQLite
- One-click account activation
- Real-time quota monitoring
- Import/export accounts
- **Automatic Machine ID management per account**
- **Usage statistics and health monitoring**
- **Session persistence for faster login**
- **Registration data preservation**

### 🤖 Auto-Registration

- Browser automation via DrissionPage
- IMAP integration for email verification
- Proxy support
- Customizable email patterns

### 🔧 IDE Patcher

- Patch extensions for multi-account support
- Automatic backup & restore
- Safe patching with validation

---

## 🤖 AI Providers

### Supported Providers

- **ProxyStitch** — Built-in AI proxy (default)
- **FreeModel** — External provider with Claude & OpenAI models
  - [Setup Guide](docs/freemodel-setup.md)
  - Claude models via bridge (port 3456) — управляется через **AI Hub → FreeModel**
  - OpenAI models directly
- **Z.AI / GLM** — Initial web-session adapter seam for GLM models
  - [Setup and current runtime limitations](docs/zai-glm-setup.md)

### FreeModel Bridge

Запускай Claude модели напрямую из Stitch через AI Hub → FreeModel таб:
- Автоматический запуск bridge процесса
- Управление портом и API ключом
- Тестирование соединения
- Поддержка моделей с префиксом `FM-*`

---

## 🆕 Machine ID Management

### What is Machine ID?

Machine ID is a unique identifier used by AI IDEs (like Kiro) to identify your installation. Stitch Manager now automatically manages Machine IDs per account, enabling true multi-account support.

### Key Features

#### 🔄 Automatic Machine ID Switching

- Each account gets its own unique Machine ID
- Machine ID automatically switches when you activate an account
- No manual configuration needed
- No IDE restart required

#### 📊 Usage Statistics

Track account health and usage:

- **Use Count**: How many times the account was activated
- **Login Count**: Total successful logins
- **Success Rate**: Percentage of successful operations
- **Error Tracking**: Last error message and error count
- **Health Indicators**: Visual indicators (🟢 Good, 🟡 Fair, 🔴 Poor)

#### 💾 Registration Data Preservation

- Saves registration password for AWS accounts
- Tracks registration method (manual, auto, OAuth)
- Stores registration date and metadata
- Preserves AWS account ID and Kiro account ID

#### ⚡ Session Management

- Saves browser session data for faster login
- Stores cookies and browser profile path
- Enables session reuse without re-entering credentials
- Reduces login time significantly

#### 🏷️ Account Organization

- Add custom notes to accounts
- Tag accounts for easy filtering
- Filter by registration method, tags, or health status
- Sort by usage, login count, or last activity

### How It Works

1. **Account Creation**: When you create or register an account, a unique Machine ID is automatically generated
2. **Account Activation**: When you activate an account, its Machine ID is written to the IDE's config file
3. **Automatic Switching**: Switch between accounts seamlessly - Machine ID updates automatically
4. **Statistics Tracking**: Every activation, login, and error is tracked for monitoring
5. **Session Reuse**: Browser sessions are saved and reused for faster subsequent logins

### Benefits

✅ **True Multi-Account Support**: Each account operates independently with its own Machine ID  
✅ **No Manual Configuration**: Everything is automatic - just activate and use  
✅ **Better Monitoring**: Track which accounts are working well and which need attention  
✅ **Faster Logins**: Session reuse eliminates repetitive credential entry  
✅ **Better Organization**: Notes, tags, and filters help manage large account collections  
✅ **Data Preservation**: Never lose registration credentials or account metadata

---

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

| Script                          | Purpose                                                                     |
| ------------------------------- | --------------------------------------------------------------------------- |
| `scripts/deploy-vds.ps1`        | One-shot VDS deploy, key-based SSH, creds from `~/.secrets/ssh-vps-password` |
| `scripts/start-bot.ps1`         | Start bot with `-Token` and `-Proxy` flags                                  |
| `scripts/toggle-local-role.ps1` | Toggle local user role for testing                                           |
| `scripts/proxy_autopilot.py`    | Refresh free-proxy list for the bot                                          |
| `scripts/release-public.ps1`    | Local open-core export and publish                                           |

---

## 📥 Installation

### Download

Get the latest release for your platform:

| Platform | Download                                                                                                                                                            |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Windows  | [`stitch-setup-X.Y.Z.exe`](https://github.com/StitchWB/Stitch-Manager/releases/latest) (installer) or [`stitch-portable-X.Y.Z.zip`](https://github.com/StitchWB/Stitch-Manager/releases/latest) (portable) |
| Linux    | [`stitch-linux-X.Y.Z`](https://github.com/StitchWB/Stitch-Manager/releases/latest) (standalone binary)                                                              |

### Build from Source

```bash
# Clone
git clone https://github.com/StitchWB/Stitch-Manager.git
cd Stitch-Manager

# Install dependencies
npm install

# Development
npm run dev

# Build
npm run build
```

**Requirements:**

- Node.js 18+ (for the frontend build)
- Python 3.11+ (backend + auto-registration)

---

## 🛠️ Tech Stack

```
Frontend:  React 18 • TypeScript • TailwindCSS • Zustand
Backend:   Python • FastAPI • SQLite • SQLAlchemy
Automation: Python • DrissionPage • IMAPClient
```

## 🏗️ Architecture

Stitch Manager uses a fully Python-based architecture:

- **LiteLLM Router** — key rotation and request routing
- **FastAPI** — HTTP API for account management
- **Built-in Security** — Python-based prompt injection & jailbreak defense
- **SQLite** — local database

All components run as Python processes, without external binaries.

---

## 📄 License

MIT License — see [LICENSE](LICENSE)

---

# 🇷🇺 Русский

## 🎯 Что такое Stitch Manager?

**Stitch Manager** — мощное кроссплатформенное приложение для управления аккаунтами в AI IDE: **Kiro**, **Windsurf** и **Trae**.

### Зачем это нужно?

- 🔄 **Мгновенное переключение** — Без перезапуска IDE
- 🤖 **Авто-регистрация** — Создание аккаунтов через браузерную автоматизацию
- 🔧 **Патчер IDE** — Включение мульти-аккаунтов в расширениях
- 📊 **Отслеживание квот** — Мониторинг использования всех аккаунтов
- 🎨 **Красивый UI** — Современная тема Deep Space с glassmorphism

---

## ✨ Возможности

| Функция               | Kiro | Windsurf | Trae |
| --------------------- | :--: | :------: | :--: |
| Управление аккаунтами |  ✅  |    ✅    |  🚧  |
| Авто-регистрация      |  ✅  |    ✅    |  🚧  |
| Инъекция токенов      |  ✅  |    ✅    |  🚧  |
| Патчер расширений     |  ✅  |    ✅    |  🚧  |

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

## 🆕 Управление Machine ID

### Что такое Machine ID?

Machine ID — это уникальный идентификатор, используемый AI IDE (например, Kiro) для идентификации вашей установки. Stitch Manager теперь автоматически управляет Machine ID для каждого аккаунта, обеспечивая настоящую мульти-аккаунтную поддержку.

### Ключевые возможности

#### 🔄 Автоматическое переключение Machine ID

- Каждый аккаунт получает свой уникальный Machine ID
- Machine ID автоматически переключается при активации аккаунта
- Не требуется ручная настройка
- Не требуется перезапуск IDE

#### 📊 Статистика использования

Отслеживание здоровья и использования аккаунтов:

- **Счётчик использований**: Сколько раз аккаунт был активирован
- **Счётчик входов**: Общее количество успешных входов
- **Процент успеха**: Процент успешных операций
- **Отслеживание ошибок**: Последнее сообщение об ошибке и счётчик ошибок
- **Индикаторы здоровья**: Визуальные индикаторы (🟢 Хорошо, 🟡 Удовлетворительно, 🔴 Плохо)

#### 💾 Сохранение данных регистрации

- Сохраняет пароль регистрации для AWS аккаунтов
- Отслеживает метод регистрации (ручной, авто, OAuth)
- Хранит дату регистрации и метаданные
- Сохраняет AWS account ID и Kiro account ID

#### ⚡ Управление сессиями

- Сохраняет данные браузерной сессии для быстрого входа
- Хранит cookies и путь к профилю браузера
- Позволяет переиспользовать сессию без повторного ввода учётных данных
- Значительно сокращает время входа

#### 🏷️ Организация аккаунтов

- Добавление пользовательских заметок к аккаунтам
- Теги для аккаунтов для удобной фильтрации
- Фильтрация по методу регистрации, тегам или статусу здоровья
- Сортировка по использованию, количеству входов или последней активности

### Как это работает

1. **Создание аккаунта**: При создании или регистрации аккаунта автоматически генерируется уникальный Machine ID
2. **Активация аккаунта**: При активации аккаунта его Machine ID записывается в конфигурационный файл IDE
3. **Автоматическое переключение**: Переключайтесь между аккаунтами без проблем - Machine ID обновляется автоматически
4. **Отслеживание статистики**: Каждая активация, вход и ошибка отслеживаются для мониторинга
5. **Переиспользование сессий**: Браузерные сессии сохраняются и переиспользуются для более быстрых последующих входов

### Преимущества

✅ **Настоящая мульти-аккаунтная поддержка**: Каждый аккаунт работает независимо со своим Machine ID  
✅ **Без ручной настройки**: Всё автоматически - просто активируйте и используйте  
✅ **Лучший мониторинг**: Отслеживайте, какие аккаунты работают хорошо, а какие требуют внимания  
✅ **Быстрые входы**: Переиспользование сессий устраняет повторный ввод учётных данных  
✅ **Лучшая организация**: Заметки, теги и фильтры помогают управлять большими коллекциями аккаунтов  
✅ **Сохранение данных**: Никогда не теряйте учётные данные регистрации или метаданные аккаунтов

---

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

| Скрипт                          | Назначение                                                                  |
| ------------------------------- | --------------------------------------------------------------------------- |
| `scripts/deploy-vds.ps1`        | Одношотный деплой VDS, key-based SSH, учётные данные из `~/.secrets/ssh-vps-password` |
| `scripts/start-bot.ps1`         | Запуск бота с флагами `-Token` и `-Proxy`                                   |
| `scripts/toggle-local-role.ps1` | Переключение локальной роли пользователя для тестирования                   |
| `scripts/proxy_autopilot.py`    | Обновление списка free-proxy для бота                                        |
| `scripts/release-public.ps1`     | Локальный экспорт и публикация open-core                                    |

---

## 📥 Установка

### Скачать

Последний релиз для вашей платформы:

| Платформа | Скачать                                                                                                                                                              |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Windows   | [`stitch-setup-X.Y.Z.exe`](https://github.com/StitchWB/Stitch-Manager/releases/latest) (установщик) или [`stitch-portable-X.Y.Z.zip`](https://github.com/StitchWB/Stitch-Manager/releases/latest) (portable) |
| Linux     | [`stitch-linux-X.Y.Z`](https://github.com/StitchWB/Stitch-Manager/releases/latest) (автономный бинарник)                                                            |

### Сборка из исходников

```bash
# Клонировать
git clone https://github.com/StitchWB/Stitch-Manager.git
cd Stitch-Manager

# Установить зависимости
npm install

# Разработка
npm run dev

# Сборка
npm run build
```

**Требования:**

- Node.js 18+ (для сборки фронтенда)
- Python 3.11+ (бэкенд + авто-регистрация)

---

## 🛠️ Технологии

```
Frontend:  React 18 • TypeScript • TailwindCSS • Zustand
Backend:   Python • FastAPI • SQLite • SQLAlchemy
Автоматизация: Python • DrissionPage • IMAPClient
```

## 🏗️ Архитектура

Stitch Manager использует полностью Python-based архитектуру:

- **LiteLLM Router** — ротация ключей и маршрутизация запросов
- **FastAPI** — HTTP API для управления аккаунтами
- **Встроенная защита** — Python модуль безопасности (без внешних бинарников)
- **SQLite** — локальная база данных

Все компоненты работают как Python процессы, без внешних бинарников.

---

## 📄 Лицензия

MIT License — см. [LICENSE](LICENSE)

---

<p align="center">
  <strong>Made with ❤️ by <a href="https://github.com/WhiteBite">WhiteBite</a></strong>
</p>
