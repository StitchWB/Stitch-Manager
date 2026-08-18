/**
 * External links — single source of truth.
 *
 * Centralized so a real URL can replace the placeholder in one place without
 * touching components. Consumed by the sidebar footer Telegram button and any
 * other surface that needs to open the main Telegram channel.
 */
export const MAIN_TELEGRAM_URL = 'https://t.me/whitebite_devsoft';

/** Stitch login bot — issues one-time codes via /login (TelegramLogin page). */
export const STITCH_BOT_URL = 'https://t.me/whitebite_stitch_bot';

/** Deep link: opens the bot and issues a login code right after Start. */
export const STITCH_BOT_LOGIN_URL = `${STITCH_BOT_URL}?start=login`;
