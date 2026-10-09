import express from "express";
import { Telegraf, Markup } from "telegraf";

const TOKEN = process.env.BOT_TOKEN;
const ADMIN_IDS = (process.env.ADMIN_IDS || "")
  .split(",")
  .map((value) => value.trim())
  .filter((value) => /^\d+$/.test(value))
  .map(Number);
const PORT = Number(process.env.PORT || 10000);

if (!TOKEN) {
  console.error("BOT_TOKEN is missing. Add it in Render Environment.");
  process.exit(1);
}

const bot = new Telegraf(TOKEN);
const app = express();

// MVP state is kept in memory. It resets if Render restarts/redeploys.
const sessions = new Map();
const balances = new Map();
const createdBots = new Map();

app.get("/", (_req, res) => res.status(200).send("NEXBOT is running."));
app.get("/health", (_req, res) => res.status(200).json({ ok: true }));

const mainKeyboard = () =>
  Markup.keyboard([
    ["🤖 BOT YARATISH"],
    ["💰 BALANS", "👤 PROFIL"],
    ["➕ BALANS TO‘LDIRISH", "🆘 YORDAM"]
  ]).resize();

const typeKeyboard = () =>
  Markup.inlineKeyboard([
    [Markup.button.callback("🎬 KINO BOT", "create_kino")],
    [Markup.button.callback("📥 DOWNLOAD BOT", "create_download")],
    [Markup.button.callback("📢 SMM BOT", "create_smm")],
    [Markup.button.callback("⬅️ Bekor qilish", "cancel_create")]
  ]);

const money = (amount) => new Intl.NumberFormat("uz-UZ").format(amount) + " so‘m";
const userBalance = (userId) => balances.get(userId) || 0;
const userBots = (userId) => createdBots.get(userId) || [];

bot.start(async (ctx) => {
  sessions.delete(ctx.from.id);
  await ctx.reply(
    "⚡ NEXBOT platformasiga xush kelibsiz!\n\nBot yaratish, balans va profilingizni quyidagi tugmalardan boshqaring.",
    mainKeyboard()
  );
});

bot.command("menu", async (ctx) => {
  sessions.delete(ctx.from.id);
  await ctx.reply("Asosiy menyu:", mainKeyboard());
});

bot.hears("🤖 BOT YARATISH", async (ctx) => {
  sessions.set(ctx.from.id, { step: "choose_type" });
  await ctx.reply("🤖 Qanday bot yaratmoqchisiz? Quyidagi inline tugmalardan birini tanlang:", typeKeyboard());
});

bot.hears("💰 BALANS", async (ctx) => {
  await ctx.reply(
    `💰 Sizning balansingiz: ${money(userBalance(ctx.from.id))}\n\nBu MVP versiyada balans haqiqiy to‘lov bilan avtomatik to‘ldirilmaydi.`,
    mainKeyboard()
  );
});

bot.hears("👤 PROFIL", async (ctx) => {
  const list = userBots(ctx.from.id);
  const botList = list.length
    ? list.map((item, index) => `${index + 1}. @${item.username} — ${item.typeLabel}`).join("\n")
    : "Hali bot yaratmagansiz.";
  await ctx.reply(
    `👤 PROFIL\nIsm: ${ctx.from.first_name || "Foydalanuvchi"}\nTelegram ID: ${ctx.from.id}\n💰 Balans: ${money(userBalance(ctx.from.id))}\n🤖 Yaratilgan botlar: ${list.length}\n\n${botList}`,
    mainKeyboard()
  );
});

bot.hears("➕ BALANS TO‘LDIRISH", async (ctx) => {
  sessions.set(ctx.from.id, { step: "topup_amount" });
  await ctx.reply(
    "➕ Balans to‘ldirish\n\nQancha so‘m to‘ldirmoqchisiz? Faqat summani yuboring (masalan, 20000). Hozircha bu admin orqali qo‘lda ko‘rib chiqiladigan so‘rov; avtomatik to‘lov tizimi ulanmagan.",
    Markup.keyboard([["⬅️ MENYUGA QAYTISH"]]).resize()
  );
});

bot.hears("🆘 YORDAM", async (ctx) => {
  await ctx.reply(
    "🆘 NEXBOT YORDAM\n\n🤖 BOT YARATISH — BotFather tokenini yuboring va bot turini tanlang.\n💰 BALANS — balansingizni ko‘ring.\n👤 PROFIL — profilingiz va yaratilgan botlar.\n➕ BALANS TO‘LDIRISH — admin ko‘rib chiqishi uchun so‘rov yuboring.\n\nTokeningizni hech kimga, hatto admin deb tanishtirgan notanish odamga ham bermang.",
    mainKeyboard()
  );
});

bot.hears("⬅️ MENYUGA QAYTISH", async (ctx) => {
  sessions.delete(ctx.from.id);
  await ctx.reply("Asosiy menyu:", mainKeyboard());
});

bot.action("cancel_create", async (ctx) => {
  sessions.delete(ctx.from.id);
  await ctx.answerCbQuery("Bekor qilindi");
  await ctx.reply("Bot yaratish bekor qilindi.", mainKeyboard());
});

bot.action(/^create_(kino|download|smm)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const session = sessions.get(ctx.from.id);
  if (!session?.token) {
    sessions.set(ctx.from.id, { step: "bot_token", type: ctx.match[1] });
    const labels = { kino: "🎬 KINO BOT", download: "📥 DOWNLOAD BOT", smm: "📢 SMM BOT" };
    await ctx.reply(
      `Siz ${labels[ctx.match[1]]}ni tanladingiz. Endi @BotFather orqali yaratgan o‘zingizga tegishli bot tokenini yuboring. Token maxfiy; uni hech kim bilan ulashmang.`,
      Markup.keyboard([["⬅️ MENYUGA QAYTISH"]]).resize()
    );
    return;
  }
  const types = {
    kino: { label: "Kino bot", emoji: "🎬" },
    download: { label: "Download bot", emoji: "📥" },
    smm: { label: "SMM bot", emoji: "📢" }
  };
  const type = ctx.match[1];
  await ctx.reply(`⏳ ${types[type].label} sozlanmoqda. Token tekshiriladi...`);
  try {
    const record = await launchUserBot({
      token: session.token,
      ownerId: ctx.from.id,
      type,
      typeLabel: types[type].label
    });
    const list = userBots(ctx.from.id);
    list.push(record);
    createdBots.set(ctx.from.id, list);
    sessions.delete(ctx.from.id);
    await ctx.reply(
      `✅ Bot ishga tushdi!\n\nNomi: ${record.name}\nUsername: @${record.username}\nTuri: ${types[type].label}\n\nSinash uchun @${record.username} ni ochib /start bosing.\n\nEslatma: bu sinov versiyasida botlar xotirada ishlaydi; NEXBOT qayta ishga tushsa, tokenni qayta ulash kerak bo‘ladi.`,
      mainKeyboard()
    );
  } catch (error) {
    console.error("User bot setup failed:", error?.message || "unknown error");
    sessions.set(ctx.from.id, { step: "bot_token" });
    await ctx.reply(
      "❌ Botni ishga tushirib bo‘lmadi. Token noto‘g‘ri bo‘lishi, bot allaqachon boshqa joyda polling qilayotgani yoki Telegram ulanishida muammo bo‘lishi mumkin. Tokenni tekshirib, qayta yuboring.",
      Markup.keyboard([["⬅️ MENYUGA QAYTISH"]]).resize()
    );
  }
});

async function launchUserBot({ token, ownerId, type, typeLabel }) {
  const child = new Telegraf(token);
  // Validate token before starting long polling. Do not log the token.
  const me = await child.telegram.getMe();
  const movies = [];

  child.start(async (ctx) => {
    const descriptions = {
      kino: "🎬 Kino botga xush kelibsiz!\n\nKinolarni qidirish: /search nom\nKinolar ro‘yxati: /movies\nBot egasi kino qo‘shishi: /addmovie Nom | Tavsif | Havola",
      download: "📥 Download botga xush kelibsiz!\n\nOchiq, to‘g‘ridan-to‘g‘ri HTTPS MP4 havolasini yuboring. Platforma cheklovlarini aylanib o‘tish qo‘llab-quvvatlanmaydi.",
      smm: "📢 SMM botga xush kelibsiz!\n\nBuyurtma yuborish uchun xizmat turi, sahifa havolasi va miqdorni bitta xabarda yozing."
    };
    await ctx.reply(descriptions[type] || "Bot ishga tayyor.");
  });

  if (type === "kino") {
    child.command("addmovie", async (ctx) => {
      if (ctx.from.id !== ownerId) {
        return ctx.reply("Kino qo‘shish faqat bot egasiga ruxsat etilgan.");
      }
      const raw = ctx.message.text.replace(/^\/addmovie\s*/i, "");
      const parts = raw.split("|").map((part) => part.trim());
      if (parts.length < 3 || !parts[0] || !parts[1] || !/^https:\/\//i.test(parts[2])) {
        return ctx.reply("Format: /addmovie Kino nomi | Tavsif | https://havola");
      }
      movies.push({ title: parts[0], description: parts[1], url: parts.slice(2).join(" | ") });
      return ctx.reply(`✅ “${parts[0]}” ro‘yxatga qo‘shildi.`);
    });
    child.command("movies", async (ctx) => {
      if (!movies.length) return ctx.reply("Hozircha kino qo‘shilmagan.");
      return ctx.reply(movies.map((movie, index) => `${index + 1}. ${movie.title}`).join("\n"));
    });
    child.command("search", async (ctx) => {
      const query = ctx.message.text.replace(/^\/search\s*/i, "").trim().toLowerCase();
      if (!query) return ctx.reply("Qidirish uchun: /search kino nomi");
      const found = movies.filter((movie) => movie.title.toLowerCase().includes(query)).slice(0, 5);
      if (!found.length) return ctx.reply("Kino topilmadi.");
      for (const movie of found) {
        await ctx.reply(`🎬 ${movie.title}\n\n${movie.description}\n\nHavola: ${movie.url}`);
      }
    });
  }

  if (type === "download") {
    child.on("text", async (ctx) => {
      const input = ctx.message.text.trim();
      if (input.startsWith("/")) return;
      let url;
      try { url = new URL(input); } catch {
        return ctx.reply("To‘liq HTTPS MP4 havolasini yuboring.");
      }
      if (url.protocol !== "https:" || !/\.mp4$/i.test(url.pathname)) {
        return ctx.reply("Faqat ochiq, to‘g‘ridan-to‘g‘ri HTTPS .mp4 havolasi qabul qilinadi.");
      }
      try {
        await ctx.replyWithVideo(url.href);
      } catch {
        await ctx.reply("Videoni olishning iloji bo‘lmadi. Havola to‘g‘ridan-to‘g‘ri ochilishini tekshiring.");
      }
    });
  }

  if (type === "smm") {
    child.on("text", async (ctx) => {
      const input = ctx.message.text.trim();
      if (input.startsWith("/")) return;
      try {
        await child.telegram.sendMessage(
          ownerId,
          `📢 Yangi SMM so‘rovi\nBot: @${me.username}\nFoydalanuvchi ID: ${ctx.from.id}\nUsername: @${ctx.from.username || "yo‘q"}\n\nSo‘rov: ${input}`
        );
        await ctx.reply("✅ So‘rovingiz bot egasiga yuborildi.");
      } catch {
        await ctx.reply("So‘rovni yuborib bo‘lmadi. Keyinroq urinib ko‘ring.");
      }
    });
  }

  child.catch((error) => console.error("Created bot error:", error?.message || "unknown error"));
  await child.launch();
  return { name: me.first_name, username: me.username, type, typeLabel, bot: child };
}

bot.on("text", async (ctx) => {
  const session = sessions.get(ctx.from.id);
  if (!session) return;

  const input = ctx.message.text.trim();
  if (input.startsWith("/")) return;

  if (session.step === "bot_token") {
    // Best-effort removal so the token is not left visible in the chat.
    try { await ctx.deleteMessage(); } catch { /* Telegram may refuse message deletion. */ }
    if (input.length < 30 || !input.includes(":")) {
      return ctx.reply("Bu token formatiga o‘xshamaydi. @BotFather bergan tokenni qayta tekshiring.", mainKeyboard());
    }
    session.token = input;
    session.step = "bot_type";
    sessions.set(ctx.from.id, session);
    return ctx.reply("Qaysi turdagi bot yaratamiz?", typeKeyboard());
  }

  if (session.step === "topup_amount") {
    const amount = Number(input.replace(/[\s,]/g, ""));
    if (!Number.isSafeInteger(amount) || amount < 1000 || amount > 100000000) {
      return ctx.reply("Summani raqam bilan yuboring (kamida 1000 so‘m).", mainKeyboard());
    }
    sessions.delete(ctx.from.id);
    const message = `💳 Balans to‘ldirish so‘rovi\nIsm: ${ctx.from.first_name || "Foydalanuvchi"}\nTelegram ID: ${ctx.from.id}\nUsername: @${ctx.from.username || "yo‘q"}\nSumma: ${money(amount)}`;
    if (!ADMIN_IDS.length) {
      return ctx.reply("So‘rov saqlandi faqat joriy sessiya ichida, lekin admin xabari yuborilmadi. Render Environment’da ADMIN_IDS sozlang.", mainKeyboard());
    }
    for (const id of ADMIN_IDS) {
      try { await bot.telegram.sendMessage(id, message); }
      catch (error) { console.error("Could not notify admin:", error?.message || "unknown error"); }
    }
    return ctx.reply("✅ Balans to‘ldirish so‘rovingiz adminga yuborildi. To‘lov avtomatik olinmaydi.", mainKeyboard());
  }
});

// Admin can manually credit a balance in the current running session: /credit USER_ID AMOUNT
bot.command("credit", async (ctx) => {
  if (!ADMIN_IDS.includes(ctx.from.id)) return ctx.reply("Bu buyruq faqat admin uchun.");
  const parts = ctx.message.text.split(/\s+/);
  const userId = Number(parts[1]);
  const amount = Number(parts[2]);
  if (!Number.isSafeInteger(userId) || !Number.isSafeInteger(amount) || amount <= 0) {
    return ctx.reply("Format: /credit USER_ID AMOUNT");
  }
  balances.set(userId, userBalance(userId) + amount);
  return ctx.reply(`✅ ${userId} foydalanuvchi balansi ${money(amount)} ga oshirildi.`);
});

bot.catch((error) => console.error("NEXBOT error:", error?.message || "unknown error"));

const server = app.listen(PORT, "0.0.0.0", () => {
  console.log(`HTTP server listening on ${PORT}`);
});

bot.launch().then(() => console.log("NEXBOT started")).catch((error) => {
  console.error("NEXBOT launch failed:", error?.message || "unknown error");
  server.close(() => process.exit(1));
});

const shutdown = (signal) => {
  console.log(`${signal} received; stopping bots`);
  bot.stop(signal);
  for (const list of createdBots.values()) {
    for (const record of list) {
      try { record.bot.stop(signal); } catch { /* best-effort shutdown */ }
    }
  }
  server.close(() => process.exit(0));
};
process.once("SIGINT", () => shutdown("SIGINT"));
process.once("SIGTERM", () => shutdown("SIGTERM"));
