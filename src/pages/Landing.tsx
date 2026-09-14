/**
 * Public landing page — the web's public face.
 *
 * Web-only surface, rendered in two modes:
 *   1. Anonymous gate mode (no props): shown to anonymous web visitors when
 *      auth is mandatory and users exist. The hero copy is static; the demo
 *      frame embeds the real app UI with seeded demo data (no /api calls are
 *      needed to render it). The CTA buttons switch the auth surface.
 *   2. Authenticated route mode (`authenticated`, mounted at "/" on web
 *      inside the app Layout): a logged-in showcase page; CTAs navigate
 *      into the workspace at /app. The desktop app never shows this page.
 *
 * Landing copy is intentionally inline bilingual (RU / EN) and is NOT part
 * of the locale files.
 *
 * Deep Space glassmorphism, matching Login.tsx / AuthLoadingSplash.
 */

/* eslint-disable i18next/no-literal-string -- Landing copy is deliberately
    inline bilingual (RU/EN) marketing text; it never goes through the
    locale files (product decision for the public page). */

import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  Terminal,
  Github,
  Send,
  LogIn,
  ArrowRight,
  Sparkles,
  Users,
  Bot,
  Fingerprint,
  Gauge,
  Wrench,
  MailCheck,
  ShieldCheck,
  Ghost,
  Network,
  Waypoints,
  Clapperboard,
  CalendarClock,
  Lock,
  Download,
  CreditCard,
  Radar as RadarIcon,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useAuthStore } from '../stores/auth';
import { cn } from '../lib/utils';
import { Badge } from '../components/ui/Badge';
import { ButtonBase } from '../components/ui/ButtonBase';
import { IconButton } from '../components/ui/IconButton';
import { DemoAppFrame } from '../components/landing/DemoAppFrame';

const GITHUB_URL = 'https://github.com/StitchWB/Stitch-Manager';
const TELEGRAM_URL = 'https://t.me/whitebite_stitch_bot';
const DOWNLOAD_URL = 'https://github.com/StitchWB/Stitch-Manager/releases/latest';

const PROVIDERS = [
  'Kiro',
  'Windsurf',
  'Trae',
  'Qoder',
  'GitHub',
  'Bitbucket',
  'AWS Builder ID',
  'OpenAI',
  'Copilot',
  'Claude',
  'Gemini',
  'Antigravity',
  'Fireworks',
  'v0.dev',
  'Z.AI',
] as const;

interface Feature {
  icon: LucideIcon;
  ru: string;
  en: string;
  descRu: string;
  descEn: string;
  /** Spans two columns on md+ grids (flagship cards). */
  wide?: boolean;
}

const FEATURES: readonly Feature[] = [
  {
    icon: Users,
    ru: 'Мульти-аккаунты',
    en: 'Multi-account',
    descRu: 'Переключение между аккаунтами Kiro, Windsurf, Trae и других IDE в один клик — без перезапуска.',
    descEn: 'Switch between Kiro, Windsurf, Trae and more in one click — no IDE restart.',
    wide: true,
  },
  {
    icon: Fingerprint,
    ru: 'Machine ID',
    en: 'Machine ID rotation',
    descRu: 'Уникальный Machine ID на каждый аккаунт, автоматическая ротация при активации.',
    descEn: 'Unique Machine ID per account, rotated automatically on activation.',
  },
  {
    icon: Gauge,
    ru: 'Квоты и здоровье',
    en: 'Quotas & health',
    descRu: 'Использование, здоровье и статистика по каждому аккаунту в реальном времени.',
    descEn: 'Real-time usage, health and stats for every account.',
  },
  {
    icon: Bot,
    ru: 'Авто-регистрация',
    en: 'Auto-registration',
    descRu:
      'Пайплайны под каждого провайдера: браузерная автоматизация создаёт и подтверждает аккаунты сама.',
    descEn: 'Per-provider pipelines: browser automation creates and verifies accounts for you.',
    wide: true,
  },
  {
    icon: Wrench,
    ru: 'IDE-патчер',
    en: 'IDE patcher',
    descRu: 'Включает мульти-аккаунты в расширениях Kiro / Windsurf / Trae — с бэкапом и откатом.',
    descEn: 'Enables multi-account in Kiro / Windsurf / Trae extensions — with backup & restore.',
  },
  {
    icon: MailCheck,
    ru: 'Email-стратегии',
    en: 'Email strategies',
    descRu: 'IMAP-верификация, алиасы, одноразовые ящики и пул iCloud для регистрации.',
    descEn: 'IMAP verify, aliases, disposable boxes and an iCloud pool for sign-ups.',
  },
  {
    icon: ShieldCheck,
    ru: 'Обход капчи',
    en: 'Captcha solving',
    descRu: 'Автоматическое решение Turnstile и других капч прямо в пайплайнах регистрации.',
    descEn: 'Turnstile and other captchas solved automatically inside registration pipelines.',
  },
  {
    icon: Ghost,
    ru: 'Анти-фингерпринт',
    en: 'Anti-fingerprint',
    descRu: '25+ спуферов: браузерные профили не выглядят как один и тот же компьютер.',
    descEn: '25+ spoofers: browser profiles never look like the same machine.',
  },
  {
    icon: Network,
    ru: 'Прокси-библиотека',
    en: 'Proxy library',
    descRu: 'Массовый импорт прокси и шаг proxy.switch прямо в сценариях воспроизведения.',
    descEn: 'Bulk proxy import and a proxy.switch step right inside replay scenarios.',
  },
  {
    icon: Waypoints,
    ru: 'AI Hub',
    en: 'AI Hub gateway',
    descRu: 'Пул ключей, маршрутизация моделей и авто-переключение при исчерпании кредитов.',
    descEn: 'Key pool, model routing and auto-switch when credits run out.',
  },
  {
    icon: Clapperboard,
    ru: 'Сценарии',
    en: 'Scenarios',
    descRu: 'Запись и воспроизведение сценариев, оверлей-рекордер и расширение для Chrome.',
    descEn: 'Record & replay scenarios, an overlay recorder and a Chrome extension.',
  },
  {
    icon: CalendarClock,
    ru: 'Планировщик',
    en: 'Scheduler',
    descRu: 'Расписания задач и авто-пополнение флота аккаунтов до целевых значений.',
    descEn: 'Task schedules and auto-replenishment of the fleet to target levels.',
  },
  {
    icon: Send,
    ru: 'Telegram-вход и бот',
    en: 'Telegram login & bot',
    descRu: 'Вход по коду из бота, роли и уровни доступа для команды на веб-версии.',
    descEn: 'Bot-code login, roles and access tiers for your team on the web.',
  },
  {
    icon: Lock,
    ru: 'Безопасность',
    en: 'Security',
    descRu: 'Fernet-шифрование секретов, OS keyring и пер-пользовательский scope данных.',
    descEn: 'Fernet-encrypted secrets, OS keyring and per-user data scope.',
  },
  {
    icon: CreditCard,
    ru: 'Инструменты',
    en: 'Card tools',
    descRu: 'BIN-пресеты, генерация и массовая проверка карт live/dead.',
    descEn: 'BIN presets, card generation and bulk live/dead checks.',
  },
  {
    icon: RadarIcon,
    ru: 'AiApiRadar',
    en: 'Community radar',
    descRu: 'Лента офферов сообщества: фильтры, статистика и найденные ключи.',
    descEn: 'Community offers feed with filters, stats and found keys.',
  },
];

const STEPS = [
  {
    ru: 'Зарегистрируй',
    en: 'Register',
    descRu: 'Пайплайны сами создают и подтверждают аккаунты.',
    descEn: 'Pipelines create and verify accounts for you.',
  },
  {
    ru: 'Активируй',
    en: 'Activate',
    descRu: 'Токен и Machine ID записываются в IDE в один клик.',
    descEn: 'Token and Machine ID injected into the IDE in one click.',
  },
  {
    ru: 'Следи за квотами',
    en: 'Track quotas',
    descRu: 'Здоровье и использование флота — в реальном времени.',
    descEn: 'Fleet health and usage, in real time.',
  },
  {
    ru: 'Авто-переключение и пополнение',
    en: 'Auto-switch & replenish',
    descRu: 'Система сама ротирует аккаунты и пополняет флот.',
    descEn: 'The system rotates accounts and replenishes the fleet itself.',
  },
] as const;

// ── Small helpers ────────────────────────────────────────────────────────────

function openExternal(url: string): void {
  window.open(url, '_blank', 'noopener,noreferrer');
}

const GRADIENT_CTA =
  'flex items-center gap-2 rounded-lg font-semibold text-white bg-gradient-to-r from-indigo-500 to-indigo-600 shadow-lg shadow-indigo-900/40 hover:from-indigo-400 hover:to-indigo-500 active:scale-[0.98] transition-all';

// ── Component ────────────────────────────────────────────────────────────────

interface LandingProps {
  /**
   * True when mounted at "/" on web for a logged-in user (inside the
   * app Layout). CTAs become "Open app" and the Telegram-login CTA is hidden.
   * Default false = anonymous gate mode (setAuthView surfaces).
   */
  authenticated?: boolean;
}

export default function Landing({ authenticated = false }: LandingProps) {
  const setAuthView = useAuthStore(s => s.setAuthView);
  const navigate = useNavigate();

  const primaryAction = authenticated ? () => navigate('/app') : () => setAuthView('login');
  const primaryLabel = authenticated ? 'Открыть приложение / Open app' : 'Войти / Log in';
  const PrimaryIcon = authenticated ? ArrowRight : LogIn;

  return (
    <div
      className={cn(
        'relative w-full bg-vsc-bg text-slate-200',
        // Anonymous gate mode: the page IS the document (body scrolls).
        // Authenticated mode: mounted inside <main> (overflow-hidden),
        // so this element is the scroll container.
        authenticated ? 'h-full overflow-y-auto' : 'min-h-screen'
      )}
    >
      {/* ── Hero + product mockup (ambient gradient lives here) ─────────── */}
      <section className="relative overflow-hidden">
        {/* Ambient gradient mesh — Deep Space atmosphere */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background:
              'radial-gradient(ellipse 80% 60% at 50% 0%, rgba(99,102,241,0.18), transparent 60%), radial-gradient(ellipse 60% 50% at 20% 100%, rgba(139,92,246,0.12), transparent 60%), radial-gradient(ellipse 60% 50% at 80% 100%, rgba(59,130,246,0.10), transparent 60%)',
          }}
        />
        <div
          className="absolute inset-0 pointer-events-none opacity-[0.015]"
          style={{
            backgroundImage:
              'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'160\' height=\'160\'%3E%3Cfilter id=\'n\'%3E%3CfeTurbulence type=\'fractalNoise\' baseFrequency=\'0.9\' numOctaves=\'2\'/%3E%3C/filter%3E%3Crect width=\'100%25\' height=\'100%25\' filter=\'url(%23n)\'/%3E%3C/svg%3E")',
          }}
        />

        <div className="relative mx-auto w-full max-w-7xl 2xl:max-w-[90rem] px-6 lg:px-8 pb-10 md:pb-14">
          {/* Top nav */}
          <header className="flex items-center justify-between py-5">
            <div className="flex items-center gap-3">
              <div className="rounded-xl w-10 h-10 flex items-center justify-center bg-gradient-to-br from-indigo-500 to-indigo-700 shadow-lg shadow-indigo-900/40">
                <Terminal className="w-5 h-5 text-white" />
              </div>
              <span className="text-white font-black tracking-tight uppercase text-lg">Stitch Manager</span>
            </div>
            <nav className="flex items-center gap-1.5">
              <IconButton
                onClick={() => openExternal(GITHUB_URL)}
                aria-label="GitHub"
                className="text-slate-400 w-10 h-10"
              >
                <Github className="w-5 h-5" />
              </IconButton>
              <IconButton
                onClick={() => openExternal(TELEGRAM_URL)}
                aria-label="Telegram"
                className="text-slate-400 w-10 h-10"
              >
                <Send className="w-5 h-5" />
              </IconButton>
              <IconButton
                onClick={() => openExternal(DOWNLOAD_URL)}
                aria-label="Скачать / Download"
                className="text-slate-400 w-10 h-10"
              >
                <Download className="w-5 h-5" />
              </IconButton>
              <ButtonBase onClick={primaryAction} className={cn(GRADIENT_CTA, 'ml-2 h-10 px-5 text-sm')}>
                <PrimaryIcon className="w-4 h-4" />
                {primaryLabel}
              </ButtonBase>
            </nav>
          </header>

          {/* Hero copy */}
          <motion.div
            className="text-center pt-8 pb-10 md:pt-10 md:pb-12"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: 'easeOut' }}
          >
            <Badge
              variant="indigo"
              className="border border-indigo-500/30 px-3 py-1 text-[11px] md:text-xs normal-case tracking-normal mb-5"
            >
              <Sparkles className="w-3 h-3" />
              Universal account manager for AI IDEs
            </Badge>
            <h1 className="text-4xl md:text-5xl xl:text-6xl font-black tracking-tight text-white leading-[1.05]">
              Один менеджер —{' '}
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 to-violet-400">
                все AI IDE
              </span>
            </h1>
            <p className="text-slate-400 mt-4 max-w-3xl mx-auto text-sm md:text-base leading-relaxed">
              Управляйте флотом аккаунтов Kiro, Windsurf, Trae и десятков других AI-сервисов:
              квоты, авто-регистрация, ротация и пополнение — в одном месте.
              <span className="block text-slate-500 text-xs md:text-sm mt-1.5">
                Manage a fleet of AI-IDE accounts — quotas, auto-registration, rotation and
                replenishment in one place.
              </span>
            </p>
            <div className="flex items-center justify-center gap-3 mt-7 flex-wrap">
              <ButtonBase onClick={primaryAction} className={cn(GRADIENT_CTA, 'h-11 px-6 text-sm')}>
                <PrimaryIcon className="w-4 h-4" />
                {primaryLabel}
              </ButtonBase>
              {!authenticated && (
                <ButtonBase
                  onClick={() => setAuthView('telegram')}
                  className="flex items-center gap-2 h-11 px-6 rounded-lg text-sm font-medium border border-white/10 bg-white/[0.03] text-slate-200 hover:bg-white/[0.06] active:scale-[0.98] transition-all"
                >
                  <Send className="w-4 h-4" />
                  Войти через Telegram
                </ButtonBase>
              )}
              <ButtonBase
                onClick={() => openExternal(DOWNLOAD_URL)}
                className="flex items-center gap-2 h-11 px-6 rounded-lg text-sm font-medium border border-white/10 bg-white/[0.03] text-slate-200 hover:bg-white/[0.06] active:scale-[0.98] transition-all"
              >
                <Download className="w-4 h-4" />
                Скачать / Download
              </ButtonBase>
            </div>
          </motion.div>

          {/* Product demo — the REAL app UI (sidebar + header + dashboard),
              seeded with demo data and rendered as a live-looking frame. */}
          <motion.div
            className="relative hidden md:block"
            initial={{ opacity: 0, y: 32 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.15, ease: 'easeOut' }}
          >
            <DemoAppFrame />
          </motion.div>
        </div>
      </section>

      {/* ── Providers row ─────────────────────────────────────────────────── */}
      <motion.section
        className="mx-auto w-full max-w-7xl 2xl:max-w-[90rem] px-6 lg:px-8 py-14 md:py-20"
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: '-60px' }}
        transition={{ duration: 0.5, ease: 'easeOut' }}
      >
        <p className="text-center text-xs md:text-sm uppercase tracking-[0.25em] text-slate-500 font-semibold">
          Поддерживаемые провайдеры / Supported providers
        </p>
        <div className="flex flex-wrap justify-center gap-2.5 md:gap-3 mt-8">
          {PROVIDERS.map(p => (
            <span
              key={p}
              className="px-4 py-2 rounded-full border border-white/10 bg-white/[0.03] text-sm text-slate-300"
            >
              {p}
            </span>
          ))}
        </div>
      </motion.section>

      {/* ── Bento feature grid ────────────────────────────────────────────── */}
      <section className="mx-auto w-full max-w-7xl 2xl:max-w-[90rem] px-6 lg:px-8 py-14 md:py-24">
        <div className="text-center mb-12 md:mb-16">
          <h2 className="text-3xl xl:text-4xl font-black tracking-tight text-white">
            Что внутри / What&apos;s inside
          </h2>
          <p className="text-slate-400 mt-4 max-w-2xl mx-auto text-base md:text-lg">
            Полный цикл жизни флота — от регистрации до авто-пополнения.
            <span className="block text-slate-500 text-sm md:text-base mt-1.5">
              The full fleet lifecycle — from registration to auto-replenishment.
            </span>
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 lg:gap-5">
          {FEATURES.map((f, i) => (
            <motion.div
              key={f.en}
              className={cn(
                'rounded-2xl border border-white/[0.06] bg-white/[0.03] p-6 md:p-7 hover:bg-white/[0.05] hover:border-indigo-500/20 transition-colors',
                f.wide && 'md:col-span-2'
              )}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-60px' }}
              transition={{ duration: 0.4, delay: (i % 4) * 0.06, ease: 'easeOut' }}
            >
              <div className="w-11 h-11 rounded-xl flex items-center justify-center mb-4 bg-indigo-500/15 text-indigo-300">
                <f.icon className="w-5 h-5" />
              </div>
              <div className="text-base md:text-lg font-bold text-white">
                {f.ru} <span className="text-slate-500 font-medium">/ {f.en}</span>
              </div>
              <p className="text-sm text-slate-400 mt-2 leading-relaxed">{f.descRu}</p>
              <p className="text-xs text-slate-500 mt-1.5 leading-relaxed">{f.descEn}</p>
            </motion.div>
          ))}
        </div>
      </section>

      {/* ── How it works ──────────────────────────────────────────────────── */}
      <section className="mx-auto w-full max-w-7xl 2xl:max-w-[90rem] px-6 lg:px-8 py-14 md:py-24">
        <div className="text-center mb-12 md:mb-16">
          <h2 className="text-3xl xl:text-4xl font-black tracking-tight text-white">
            Как это работает / How it works
          </h2>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 lg:gap-5">
          {STEPS.map((s, i) => (
            <motion.div
              key={s.en}
              className="rounded-2xl border border-white/[0.06] bg-white/[0.03] p-6 md:p-7"
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-60px' }}
              transition={{ duration: 0.4, delay: i * 0.08, ease: 'easeOut' }}
            >
              <div className="w-10 h-10 rounded-full flex items-center justify-center bg-gradient-to-br from-indigo-500 to-violet-600 text-white font-black text-base mb-5 shadow-lg shadow-indigo-900/40">
                {i + 1}
              </div>
              <div className="text-base md:text-lg font-bold text-white">
                {s.ru} <span className="text-slate-500 font-medium">/ {s.en}</span>
              </div>
              <p className="text-sm text-slate-400 mt-2 leading-relaxed">{s.descRu}</p>
              <p className="text-xs text-slate-500 mt-1.5 leading-relaxed">{s.descEn}</p>
            </motion.div>
          ))}
        </div>
      </section>

      {/* ── Footer ────────────────────────────────────────────────────────── */}
      <footer className="border-t border-white/[0.06]">
        <div className="mx-auto w-full max-w-7xl 2xl:max-w-[90rem] px-6 lg:px-8 py-10 flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="flex items-center gap-3 text-xs text-slate-500">
            <div className="rounded-lg w-7 h-7 flex items-center justify-center bg-gradient-to-br from-indigo-500 to-indigo-700">
              <Terminal className="w-3.5 h-3.5 text-white" />
            </div>
            © {new Date().getFullYear()} Stitch Manager
          </div>
          <div className="flex items-center gap-2 flex-wrap justify-center">
            <ButtonBase
              onClick={() => openExternal(GITHUB_URL)}
              className="flex items-center gap-2 h-10 px-4 rounded-lg text-sm text-slate-400 hover:text-white hover:bg-white/[0.05] transition-colors"
            >
              <Github className="w-4 h-4" /> GitHub
            </ButtonBase>
            <ButtonBase
              onClick={() => openExternal(TELEGRAM_URL)}
              className="flex items-center gap-2 h-10 px-4 rounded-lg text-sm text-slate-400 hover:text-white hover:bg-white/[0.05] transition-colors"
            >
              <Send className="w-4 h-4" /> Telegram
            </ButtonBase>
            <ButtonBase onClick={primaryAction} className={cn(GRADIENT_CTA, 'h-10 px-5 text-sm')}>
              <PrimaryIcon className="w-4 h-4" />
              {primaryLabel}
            </ButtonBase>
          </div>
        </div>
      </footer>
    </div>
  );
}
