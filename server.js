import express from "express";
import { Telegraf, Markup } from "telegraf";

const TOKEN = process.env.BOT_TOKEN;
const ADMIN_IDS = (process.env.ADMIN_IDS || "")
  .split(",").map((v) => Number(v.trim())).filter(Number.isFinite);
const TMDB_API_KEY = process.env.TMDB_API_KEY;
const PORT = Number(process.env.PORT || 10000);

if (!TOKEN) {
  console.error("BOT_TOKEN is missing. Add it in Render Environment.");
  process.exit(1);
}

const bot = new Telegraf(TOKEN);
const app = express();
app.get("/", (_req, res) => res.status(200).send("VEXORA BOT is running."));
app.get("/health", (_req, res) => res.status(200).json({ ok: true }));

const mainMenu = () => Markup.inlineKeyboard([
  [Markup.button.callback("📢 SMM BOT", "menu_smm")],
  [Markup.button.callback("📥 VIDEO DOWNLOAD BOT", "menu_video")],
  [Markup.button.callback("🎬 KINO BOT", "menu_kino")]
]);

const sessions = new Map();
const homeText = "✨ VEXORA BOT\n\nBitta bot ichida uchta xizmat. Kerakli bo‘limni tanlang:";

bot.start(async (ctx) => {
  sessions.delete(ctx.from.id);
  await ctx.reply(homeText, mainMenu());
});

bot.command("menu", async (ctx) => ctx.reply(homeText, mainMenu()));
bot.action("home", async (ctx) => {
  sessions.delete(ctx.from.id);
  await ctx.answerCbQuery();
  await ctx.reply(homeText, mainMenu());
});

bot.action("menu_smm", async (ctx) => {
  await ctx.answerCbQuery();
  sessions.set(ctx.from.id, { type: "smm", step: "details" });
  await ctx.reply(
    "📢 SMM BOT\n\nBuyurtmangizni bitta xabarda yozing: xizmat turi, sahifa havolasi va miqdor. Masalan: Instagram obunachi — https://instagram.com/username — 100 ta.\n\nBu MVP hozircha buyurtma so‘rovini adminga yuboradi; avtomatik SMM panel ulangan emas.",
    Markup.inlineKeyboard([[Markup.button.callback("⬅️ Menyu", "home")]])
  );
});

bot.action("menu_video", async (ctx) => {
  await ctx.answerCbQuery();
  sessions.set(ctx.from.id, { type: "video", step: "url" });
  await ctx.reply(
    "📥 VIDEO DOWNLOAD BOT\n\nOchiq va to‘g‘ridan-to‘g‘ri MP4 video havolasini yuboring. Bot uni Telegram orqali yuborishga urinadi. YouTube, TikTok yoki Instagram kabi platformalardan cheklovlarni aylanib o‘tib yuklab olish qo‘llab-quvvatlanmaydi.",
    Markup.inlineKeyboard([[Markup.button.callback("⬅️ Menyu", "home")]])
  );
});

bot.action("menu_kino", async (ctx) => {
  await ctx.answerCbQuery();
  sessions.set(ctx.from.id, { type: "kino", step: "search" });
  await ctx.reply(
    "🎬 KINO BOT\n\nFilm nomini yuboring — TMDB API kaliti sozlangan bo‘lsa, film haqida ma’lumot qidiraman. Bot noqonuniy film nusxalarini tarqatmaydi.",
    Markup.inlineKeyboard([[Markup.button.callback("⬅️ Menyu", "home")]])
  );
});

bot.on("text", async (ctx) => {
  const session = sessions.get(ctx.from.id);
  if (!session) {
    return ctx.reply("Bo‘lim tanlash uchun /start bosing.", mainMenu());
  }

  const input = ctx.message.text.trim();
  if (input.startsWith("/")) return;

  if (session.type === "smm") {
    const name = [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(" ");
    const userLine = `SMM so‘rovi\nFoydalanuvchi: ${name}\nTelegram ID: ${ctx.from.id}\nUsername: @${ctx.from.username || "yo‘q"}\n\nSo‘rov: ${input}`;
    if (ADMIN_IDS.length) {
      for (const id of ADMIN_IDS) {
        try {
          await bot.telegram.sendMessage(id, userLine);
        } catch (err) {
          console.error("Could not notify admin", id, err.message);
        }
      }
      await ctx.reply("✅ So‘rovingiz adminga yuborildi. Javobni kuting.", mainMenu());
    } else {
      await ctx.reply("So‘rov qabul qilindi, lekin ADMIN_IDS sozlanmagani uchun adminga yuborilmadi. Admin Render sozlamasida ADMIN_IDS qo‘shishi kerak.", mainMenu());
    }
    sessions.delete(ctx.from.id);
    return;
  }

  if (session.type === "video") {
    sessions.delete(ctx.from.id);
    let url;
    try { url = new URL(input); } catch {
      return ctx.reply("Havola noto‘g‘ri. To‘liq https:// havolasini yuboring.", mainMenu());
    }
    if (url.protocol !== "https:" || !/\.mp4$/i.test(url.pathname)) {
      return ctx.reply("Faqat HTTPS orqali ochiladigan, yo‘li .mp4 bilan tugaydigan to‘g‘ridan-to‘g‘ri video havolasi qabul qilinadi.", mainMenu());
    }
    try {
      await ctx.replyWithVideo(url.href, { caption: "📥 Video" });
    } catch {
      await ctx.reply("Bu havoladan videoni olishning iloji bo‘lmadi. Havola ochiq, to‘g‘ridan-to‘g‘ri MP4 faylga olib borishini tekshiring.", mainMenu());
    }
    return;
  }

  if (session.type === "kino") {
    if (!TMDB_API_KEY) {
      sessions.delete(ctx.from.id);
      return ctx.reply("🎬 Kino qidiruvi uchun TMDB_API_KEY hali sozlanmagan. Render → Environment bo‘limida kalit qo‘shilgach ishlaydi.", mainMenu());
    }
    try {
      const endpoint = new URL("https://api.themoviedb.org/3/search/movie");
      endpoint.searchParams.set("api_key", TMDB_API_KEY);
      endpoint.searchParams.set("query", input);
      endpoint.searchParams.set("language", "uz-UZ");
      const response = await fetch(endpoint);
      if (!response.ok) throw new Error("TMDB request failed");
      const data = await response.json();
      const movies = (data.results || []).slice(0, 5);
      sessions.delete(ctx.from.id);
      if (!movies.length) return ctx.reply("Hech narsa topilmadi. Boshqa nom bilan urinib ko‘ring.", mainMenu());
      for (const movie of movies) {
        const year = movie.release_date ? movie.release_date.slice(0, 4) : "yili noma’lum";
        const overview = movie.overview || "Tavsif mavjud emas.";
        await ctx.reply(`🎬 ${movie.title || "Nomsiz"} (${year})\n⭐ Reyting: ${movie.vote_average ?? "—"}\n\n${overview.slice(0, 700)}`);
      }
      await ctx.reply("Yana qidirish yoki boshqa bo‘lim uchun menyuga qayting.", mainMenu());
    } catch (err) {
      console.error("Movie search error:", err.message);
      sessions.delete(ctx.from.id);
      await ctx.reply("Kino qidiruvida xatolik. API kalitini va internet ulanishini tekshiring.", mainMenu());
    }
  }
});

bot.catch((err) => console.error("Telegram bot error:", err));

const server = app.listen(PORT, "0.0.0.0", () => {
  console.log(`HTTP server listening on ${PORT}`);
});

bot.launch().then(() => console.log("VEXORA BOT started")).catch((err) => {
  console.error("Bot launch failed:", err);
  server.close(() => process.exit(1));
});

const shutdown = (signal) => {
  console.log(`${signal} received; stopping bot`);
  bot.stop(signal);
  server.close(() => process.exit(0));
};
process.once("SIGINT", () => shutdown("SIGINT"));
process.once("SIGTERM", () => shutdown("SIGTERM"));
