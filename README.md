<p align="center">
  <img src="app-icon.png" alt="Stitch Manager Logo" width="128" height="128">
</p>

<h1 align="center">Stitch Manager</h1>

<p align="center">
  <strong>Universal Account Manager for AI-Powered IDEs</strong>
</p>

<p align="center">
  <a href="#features">Features</a> •
  <a href="#installation">Installation</a> •
  <a href="#usage">Usage</a> •
  <a href="#supported-ides">Supported IDEs</a> •
  <a href="#tech-stack">Tech Stack</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Tauri-2.x-blue?logo=tauri" alt="Tauri 2.x">
  <img src="https://img.shields.io/badge/React-18-61DAFB?logo=react" alt="React 18">
  <img src="https://img.shields.io/badge/Rust-Backend-orange?logo=rust" alt="Rust">
  <img src="https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript" alt="TypeScript">
  <img src="https://img.shields.io/badge/License-MIT-green" alt="MIT License">
</p>

---

## 🎯 What is Stitch Manager?

**Stitch Manager** is a powerful desktop application for managing multiple accounts across AI-powered IDEs like **Kiro**, **Windsurf**, and **Trae**. Switch between accounts instantly, auto-register new ones, and patch IDE extensions — all from a beautiful, modern interface.

Perfect for developers who:
- Work with multiple AI coding assistants
- Need to manage team accounts
- Want automated account registration
- Require quick account switching without IDE restarts

---

## ✨ Features

### 🔐 Account Management
- Add, edit, and delete accounts for multiple IDE providers
- Secure token storage with SQLite encryption
- Real-time quota tracking and status monitoring
- One-click account activation with automatic token injection

### 🤖 Auto-Registration
- Automated account creation using browser automation (DrissionPage)
- Support for Kiro (AWS Cognito) and Windsurf (Firebase Auth)
- IMAP integration for email verification
- Proxy support for registration

### 🔧 IDE Patcher
- Patch IDE extensions to enable multi-account support
- Automatic backup before patching
- One-click restore from backup
- Support for Kiro, Windsurf, and VS Code extensions

### 🖥️ LLM API Server
- OpenAI-compatible API proxy
- Route requests through your managed accounts
- Load balancing across multiple tokens
- Real-time request monitoring

### 🎨 Modern UI/UX
- Deep Space dark theme with glassmorphism effects
- Smooth animations and transitions
- Command palette (Ctrl+K) for quick actions
- Multi-language support (English, Русский)

---

## 🖥️ Supported IDEs

| IDE | Account Management | Auto-Registration | Patcher |
|-----|-------------------|-------------------|---------|
| **Kiro** | ✅ Full Support | ✅ AWS Cognito | ✅ Ready |
| **Windsurf** | ✅ Full Support | ✅ Firebase Auth | ✅ Ready |
| **Trae** | 🚧 Coming Soon | 🚧 Planned | 🚧 Planned |

---

## 🚀 Installation

### Prerequisites

- **Node.js** 18+ 
- **Rust** (for Tauri backend)
- **Python** 3.11+ (for auto-registration)

### Quick Start

```bash
# Clone the repository
git clone https://github.com/your-username/stitch-manager.git
cd stitch-manager

# Install Node.js dependencies
npm install

# Install Python dependencies (optional, for auto-registration)
pip install -r python/requirements.txt

# Run in development mode
npm run dev
```

### Build for Production

```bash
# Build the application
npm run build

# The installer will be in src-tauri/target/release/bundle/
```

---

## 📖 Usage

### Adding an Account

1. Navigate to **Accounts** page
2. Click **Add Account**
3. Select provider (Kiro/Windsurf)
4. Enter email and password
5. Click **Save**

### Activating an Account

1. Find the account in the list
2. Click the **Start** button
3. The token is automatically injected into the IDE
4. Restart your IDE to use the new account

### Auto-Registration

1. Go to **Auto-Reg** page
2. Select target provider (Kiro/Windsurf)
3. Configure IMAP settings for email verification
4. Set email pattern and count
5. Click **START**

---

## 🛠️ Tech Stack

### Frontend
- **React 18** — UI library
- **TypeScript** — Type safety
- **TailwindCSS** — Utility-first styling
- **Zustand** — State management
- **React Router** — Navigation
- **Sonner** — Toast notifications
- **cmdk** — Command palette

### Backend
- **Tauri 2.x** — Desktop framework
- **Rust** — Backend logic
- **SQLite** — Local database
- **SQLx** — Async database driver

### Automation
- **Python 3.11+** — Scripting
- **DrissionPage** — Browser automation
- **IMAPClient** — Email verification

---

## 📁 Project Structure

```
stitch-manager/
├── src/                      # React frontend
│   ├── components/           # Reusable UI components
│   │   ├── layout/           # Layout components (Sidebar, Header)
│   │   └── ui/               # UI primitives (Terminal, ModuleCard)
│   ├── pages/                # Application pages
│   ├── stores/               # Zustand state stores
│   ├── lib/                  # Utilities, i18n, Tauri API
│   ├── constants/            # App constants and theme
│   └── types/                # TypeScript definitions
├── src-tauri/                # Rust backend
│   ├── src/
│   │   ├── commands.rs       # Tauri IPC commands
│   │   ├── services/         # Business logic services
│   │   └── database/         # SQLite migrations & queries
│   └── tauri.conf.json       # Tauri configuration
├── python/                   # Python automation
│   └── autoreg/              # Auto-registration module
└── docs/                     # Documentation
```

---

## ⚙️ Configuration

Create a `.env` file based on `.env.example`:

```env
# IMAP Configuration (for auto-registration)
IMAP_SERVER=imap.example.com
IMAP_PORT=993
IMAP_EMAIL=user@example.com
IMAP_PASSWORD=your-password

# Email domain for catch-all
EMAIL_DOMAIN=example.com
```

---

## 🔒 Security

- Tokens are stored locally in SQLite with optional encryption
- Passwords are never logged or transmitted
- All network requests use HTTPS
- No telemetry or data collection

---

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

---

## 📄 License

This project is licensed under the MIT License — see the [LICENSE](LICENSE) file for details.

---

## 🙏 Acknowledgments

- [Tauri](https://tauri.app/) — For the amazing desktop framework
- [DrissionPage](https://github.com/g1879/DrissionPage) — For browser automation
- [Lucide Icons](https://lucide.dev/) — For beautiful icons

---

<p align="center">
  Made with ❤️ by the Stitch Team
</p>
