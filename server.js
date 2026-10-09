import express from "express";
import { Telegraf, Markup } from "telegraf";

const token = process.env.BOT_TOKEN;
if (!token) throw new Error("BOT_TOKEN environment variable is required");

const bot = new Telegraf(token);
const app = express();
app.get("/", (_req, res) => res.status(200).send("VEXORA BOT is running"));
app.get("/health", (_req, res) => res.status(200).json({ ok: true }));

const mainMenu = () => Markup.inlineKeyboard([
  [Markup.button.callback("📢 SMM BOT", "menu_smm")],
  [Markup.button.callback("📥 VIDEO DOWNLOAD BOT", "menu_video")],
  [Markup.button.callback("🎬 KINO BOT", "menu_kino")]
]);

bot.start(async (ctx) => {
  await ctx.reply("👋 Xush kelibsiz! VEXORA BOT — 3-in-1 xizmatlar botiga xush kelibsiz.\n\nKerakli bo‘limni tanlang:", mainMenu());
});

bot.action("home", async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.reply("Asosiy menyu:", mainMenu());
});

bot.action("menu_smm", async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.reply(
    "📢 SMM BOT\n\nBu bo‘limda ijtimoiy tarmoqlar uchun xizmatlar bo‘ladi. Buyurtma berishni yoqish uchun SMM provayder API manzili va API kalitini Render Environment Variables bo‘limiga qo‘shish kerak.",
    Markup.inlineKeyboard([[Markup.button.callback("⬅️ Asosiy menyu", "home")]])
  );
});

bot.action("menu_video", async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.reply(
    "📥 VIDEO DOWNLOAD BOT\n\nVideo havolasini keyingi bosqichda qo‘shamiz. Yuklab olish faqat ruxsat etilgan manbalar va ularning qoidalari doirasida ishlaydi.",
    Markup.inlineKeyboard([[Markup.button.callback("⬅️ Asosiy menyu", "home")]])
  );
});

bot.action("menu_kino", async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.reply(
    "🎬 KINO BOT\n\nFilm nomini yuboring — TMDB API kaliti sozlangan bo‘lsa, film haqida ma’lumot qidiraman. Bu bot film fayllarini noqonuniy tarqatmaydi.",
    Markup.inlineKeyboard([[Markup.button.callback("⬅️ Asosiy menyu", "home")]])
  );
});

bot.on("text", async (ctx) => {
  const query = ctx.message.text.trim();
  if (query.startsWith("/")) return;
  const apiKey = process.env.TMDB_API_KEY;
  if (!apiKey) {
    await ctx.reply("🎬 Kino qidiruvi hozircha sozlanmagan. Admin TMDB_API_KEY ni Render Environment Variables bo‘limiga qo‘shishi kerak.", mainMenu());
    return;
  }
  try {
    const url = new URL("https://api.themoviedb.org/3/search/movie");
    url.searchParams.set("api_key", apiKey);
    url.searchParams.set("query", query);
    url.searchParams.set("language", "ru-RU");
    const response = await fetch(url);
    if (!response.ok) throw new Error("TMDB request failed");
    const data = await response.json();
    const results = (data.results || []).slice(0, 5);
    if (!results.length) {
      await ctx.reply("Bu nom bo‘yicha film topilmadi. Boshqa nom bilan urinib ko‘ring.", mainMenu());
      return;
    }
    for (const movie of results) {
      const title = movie.title || "Nomsiz film";
      const year = movie.release_date ? movie.release_date.slice(0, 4) : "Yili noma’lum";
      const overview = movie.overview || "Tavsif mavjud emas.";
      await ctx.reply("🎬 " + title + " (" + year + ")\n\n" + overview.slice(0, 800));
    }
    await ctx.reply("Boshqa bo‘limni tanlang:", mainMenu());
  } catch {
    await ctx.reply("Film qidirishda xatolik yuz berdi. Keyinroq urinib ko‘ring.", mainMenu());
  }
});

bot.catch((err) => console.error("Telegram bot error:", err.message));
const port = Number(process.env.PORT || 3000);
app.listen(port, () => console.log("HTTP server listening on", port));
bot.launch().then(() => console.log("VEXORA BOT started")).catch((err) => {
  console.error("Bot startup failed:", err.message);
  process.exitCode = 1;
});
process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
