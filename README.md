# VEXORA BOT — 3-in-1 Telegram bot

Starter project for a single Telegram bot with inline menu sections:
- 📢 SMM BOT
- 📥 VIDEO DOWNLOAD BOT
- 🎬 KINO BOT

## Run
1. Copy `.env.example` to `.env` and fill in `BOT_TOKEN`.
2. Install dependencies with `npm install`.
3. Run with `npm start`.

Set environment variables in Render rather than committing `.env` or real secrets.

## Current status
The inline menu, health endpoint, and TMDB movie search integration are starter features. SMM ordering and video downloading require a selected provider/API and should only be enabled for services and media you are authorized to use. No real API keys are included.
