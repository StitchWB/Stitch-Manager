"""TG-bot DM invite notification — fire-and-forget, all failures swallowed.

When a group owner invites a user by username, the backend resolves the
user's ``telegram_id`` and, if the stitch_bot is configured (token set),
sends a one-way DM via aiogram.  This is a best-effort notification —
every failure (no user, no telegram_id, no token, aiogram not installed,
Telegram API error) is swallowed at ``logger.debug`` so the invite flow
is never blocked by the notification.

The bot instance is created on-demand from ``stitch_bot.config.Settings``
and closed immediately after the send.  The stitch_bot process (if
running) is not touched — this is a separate ephemeral Bot instance
sharing the same token.

P2.15 rationale — separate-session: ``notify_group_invite`` opens its
own short-lived DB session via ``get_session_factory()`` rather than
accepting a session parameter.  This is deliberate: the caller (group
invite command) is already inside a ``run_in_session`` write session
(pool_size=1, max_overflow=0).  Passing that session in would either
hold it open for the entire Telegram HTTP call (blocking all writes for
~2 s) or require the caller to commit before the notification (breaking
transactional atomicity of the invite).  A separate session lets the
notification fail independently without affecting the invite's commit.
"""

from __future__ import annotations

import logging

logger = logging.getLogger(__name__)

_INVITE_DM_TEXT = (
    "Вас пригласили в группу «{group_name}» в Stitch Manager — "
    "примите приглашение в AI Hub → Группы"
)


async def notify_group_invite(
    invitee_username: str,
    group_name: str,
    inviter_username: str,
) -> None:
    """Send a fire-and-forget TG DM about a group invite.

    All failures are swallowed (``logger.debug``).  Never raises.
    """
    try:
        from sqlalchemy import select

        from stitch_backend.database import get_session_factory
        from stitch_backend.domains.auth.models import User

        factory = get_session_factory()
        async with factory() as db:
            result = await db.execute(
                select(User).where(User.username == invitee_username)
            )
            user = result.scalar_one_or_none()

        if user is None or user.telegram_id is None:
            logger.debug(
                "Invite DM skipped: no user/telegram_id for %s",
                invitee_username,
            )
            return

        await _send_dm(user.telegram_id, group_name)
    except Exception:
        logger.debug(
            "Invite DM failed for %s (group=%s, inviter=%s)",
            invitee_username, group_name, inviter_username,
            exc_info=True,
        )


async def _send_dm(telegram_id: int, group_name: str) -> None:
    """Create an ephemeral aiogram Bot and send the DM."""
    try:
        from aiogram import Bot
        from aiogram.client.default import DefaultBotProperties
        from aiogram.enums import ParseMode

        from stitch_bot.config import get_settings as _get_bot_settings

        settings = _get_bot_settings()
        token = settings.tg_bot_token
        if not token:
            logger.debug("Invite DM skipped: TG_BOT_TOKEN not configured")
            return

        bot = Bot(
            token=token,
            default=DefaultBotProperties(parse_mode=ParseMode.HTML),
        )
        try:
            await bot.send_message(
                telegram_id,
                _INVITE_DM_TEXT.format(group_name=group_name),
            )
        finally:
            await bot.session.close()
    except Exception:
        logger.debug("Invite DM send failed", exc_info=True)
