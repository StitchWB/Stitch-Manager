# Stitch Manager

Universal AI Account Manager - десктопное приложение для управления аккаунтами AI IDE (Kiro, Windsurf, Trae).

## Возможности

- 🔐 **Управление аккаунтами AI IDE** - централизованное хранение и управление учетными записями
- 🤖 **Авторегистрация аккаунтов** - автоматическое создание аккаунтов с использованием браузерной автоматизации
- 🔧 **IDE Patcher** - модификация IDE для расширенной функциональности
- 🆔 **Machine ID Manager** - управление идентификаторами машины и телеметрией
- 📊 **Dashboard** - статистика использования и мониторинг квот

## Технологии

- **Frontend:** React 18, TypeScript, TailwindCSS, Zustand
- **Desktop:** Tauri 2.x (Rust)
- **Database:** SQLite (sqlx)
- **Browser Automation:** DrissionPage (Python CLI)

## Архитектура

Приложение использует нативный Rust backend через Tauri:
- **AccountService** - CRUD операции с аккаунтами
- **PatcherService** - патчинг IDE расширений
- **MachineIdService** - управление телеметрией и системными ID

Python используется только для авторегистрации (CLI утилита).

## Установка

### Требования

- Node.js 18+
- Rust 1.70+
- Python 3.10+ (только для авторегистрации)

### Запуск

```bash
# Установка зависимостей frontend
npm install

# Установка зависимостей Python (для авторегистрации)
pip install -r python/requirements.txt

# Запуск в dev режиме
npm run tauri dev
```

### Сборка

```bash
npm run tauri build
```

## Структура проекта

```
├── src/                     # React frontend
│   ├── components/          # UI компоненты
│   ├── pages/               # Страницы приложения
│   ├── stores/              # Zustand stores
│   └── types/               # TypeScript типы
│
├── src-tauri/               # Tauri/Rust backend
│   ├── src/
│   │   ├── database/        # SQLite с sqlx
│   │   ├── services/        # Бизнес-логика
│   │   │   ├── account_service.rs
│   │   │   ├── patcher_service.rs
│   │   │   └── machine_id_service.rs
│   │   ├── registration/    # OAuth, IMAP сервисы
│   │   ├── commands.rs      # Tauri commands
│   │   └── lib.rs           # Entry point
│   └── Cargo.toml
│
└── python/                  # Python CLI (только авторегистрация)
    └── autoreg/
        ├── core/            # Конфигурация, пути
        ├── registration/    # Стратегии регистрации
        ├── services/        # TokenService
        ├── spoofers/        # Антидетект для браузера
        └── cli_registration.py  # Entry point
```

## Поддерживаемые IDE

| IDE | Патчинг | Авторегистрация |
|-----|---------|-----------------|
| Kiro | ✅ | ✅ |
| Windsurf | ✅ | ✅ |
| Trae | ✅ | ✅ |

## Конфигурация

```bash
cp .env.example .env
```

## Лицензия

MIT
