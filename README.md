# Stitch Manager

Менеджер аккаунтов для AI IDE (Kiro, Windsurf, Trae). Позволяет управлять несколькими аккаунтами, переключаться между ними и автоматически инжектить токены в IDE.

## Возможности

- 🔐 **Управление аккаунтами** — добавление, удаление, обновление токенов
- 🔄 **Быстрое переключение** — активация аккаунта одним кликом с автоматической записью токена в IDE
- 🌍 **Мультиязычность** — English / Русский
- 🎨 **Современный UI** — glassmorphism, анимации, тёмная тема
- 🤖 **Авто-регистрация** — автоматическая регистрация аккаунтов через браузер (DrissionPage)
- 🔧 **IDE Патчер** — патчинг расширений IDE
- 🖥️ **LLM API Сервер** — OpenAI-совместимый прокси

## Технологии

- **Frontend**: React 18, TypeScript, TailwindCSS, Zustand
- **Backend**: Tauri 2.x (Rust), SQLite
- **Automation**: Python, DrissionPage

## Установка

```bash
# Клонирование
git clone <repo-url>
cd stitch-manager

# Установка зависимостей
npm install

# Установка Python зависимостей (для авто-регистрации)
pip install -r python/requirements.txt
```

## Запуск

```bash
# Разработка (Vite + Tauri вместе)
npm run dev

# Только фронтенд (для отладки в браузере)
npm run dev:web

# Сборка
npm run build
```

## Структура проекта

```
├── src/                    # React frontend
│   ├── components/         # UI компоненты
│   ├── pages/              # Страницы приложения
│   ├── stores/             # Zustand stores
│   ├── lib/                # Утилиты, i18n, Tauri API
│   └── types/              # TypeScript типы
├── src-tauri/              # Rust backend
│   ├── src/
│   │   ├── commands.rs     # Tauri команды
│   │   ├── services/       # Бизнес-логика
│   │   └── database.rs     # SQLite
│   └── tauri.conf.json     # Конфигурация Tauri
└── python/                 # Python скрипты
    └── autoreg/            # Авто-регистрация
```

## Как работает активация аккаунта

1. Пользователь нажимает "Start" на аккаунте
2. Backend читает токен из SQLite
3. Токен записывается в `~/.aws/sso/cache/kiro-auth-token.json`
4. Kiro IDE читает этот файл при запуске/обновлении

## Скриншоты

*Coming soon*

## Лицензия

MIT
