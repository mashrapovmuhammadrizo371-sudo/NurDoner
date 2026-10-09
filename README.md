# VEXORA BOT

Telegram 3-in-1 bot starter: SMM request intake, direct public MP4 link handling, and movie search through TMDB.

## Setup

1. Create a Telegram bot with @BotFather and copy its token.
2. In Render, set `BOT_TOKEN`.
3. Set `ADMIN_IDS` to comma-separated numeric Telegram user IDs for SMM request notifications.
4. Optional: set `TMDB_API_KEY` to enable movie search.
5. Deploy as a Render Web Service with build command `npm install` and start command `npm start`.

## Current MVP limits

- SMM requests are forwarded to admins; no paid SMM provider is connected.
- Video handling accepts only direct HTTPS links ending in `.mp4`; it does not bypass platform restrictions.
- Movie search returns TMDB metadata only; it does not distribute copyrighted films.
- User conversation state is in memory and resets when the service restarts.
