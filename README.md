# NEXBOT

NEXBOT is a Telegram bot-maker MVP. A user submits a Telegram BotFather token, selects a template, and NEXBOT validates and starts that bot.

## Render setup

1. Create the NEXBOT controller bot with @BotFather.
2. Add `BOT_TOKEN` to Render Environment (never paste it into GitHub or chat).
3. Add `ADMIN_IDS` as comma-separated numeric Telegram user IDs. This enables balance top-up request notifications and the admin `/credit USER_ID AMOUNT` command.
4. Deploy as a Render Web Service with build command `npm install` and start command `npm start`.

## Included menu

- 🤖 BOT YARATISH — asks for a user-owned bot token, validates it with Telegram, then offers Kino, Download, or SMM templates.
- 💰 BALANS — shows the in-memory balance.
- 👤 PROFIL — shows Telegram ID and bots created in the current run.
- ➕ BALANS TO‘LDIRISH — sends a manual top-up request to configured admins.
- 🆘 YORDAM — explains the controls.

## Templates

- **Kino:** bot owner can add entries with `/addmovie Title | Description | https://link`; users can search with `/search title` or list with `/movies`. Use only lawful links/content.
- **Download:** handles direct HTTPS links ending in `.mp4`; it does not bypass platform restrictions.
- **SMM:** forwards user order messages to the bot owner; no paid SMM provider is connected.

## MVP limitations (important)

- User bot tokens, created-bot records, movie lists, balances, and pending sessions are kept in memory only. They are lost when the Render service restarts or redeploys. Re-add tokens after a restart.
- Balance top-ups are manual requests, not automatic payments. No payment provider is connected.
- Each user must own or be authorized to administer the bot whose token they submit.
- Run a proper security review and add persistent encrypted storage before using this with real customers or money.
