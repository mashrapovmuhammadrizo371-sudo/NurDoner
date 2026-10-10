import express from "express";
import { Telegraf, Markup } from "telegraf";
import { MongoClient } from "mongodb";
import crypto from "node:crypto";

const TOKEN = process.env.BOT_TOKEN;
const MONGODB_URI = process.env.MONGODB_URI;
const ADMIN_IDS = (process.env.ADMIN_IDS || "")
  .split(",").map((value) => value.trim())
  .filter((value) => /^\d+$/.test(value)).map(Number);
const PORT = Number(process.env.PORT || 10000);
const BASE_URL = (process.env.RENDER_EXTERNAL_URL || "https://nurdoner.onrender.com").replace(/\/+$/, "");

if (!TOKEN) {
  console.error("BOT_TOKEN is missing. Add it in Render Environment.");
  process.exit(1);
}
if (!MONGODB_URI) {
  console.error("MONGODB_URI is missing. Add it in Render Environment.");
  process.exit(1);
}

const bot = new Telegraf(TOKEN);
const app = express();
app.use(express.json({ limit: "1mb" }));

// MongoDB keeps bot registrations across Render restarts. Tokens are encrypted before storage.
const mongo = new MongoClient(MONGODB_URI);
let botRecords;
let userRecords;
const sessions = new Map();
const balances = new Map();
const createdBots = new Map();
const activeBots = new Map();
const mainWebhookSecret = crypto.randomBytes(32).toString("base64url");
const encryptionKey = crypto.createHash("sha256").update(TOKEN + ":NEXBOT-token-encryption-v1").digest();

function encryptToken(token) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey, iv);
  const encrypted = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return { iv: iv.toString("base64"), data: encrypted.toString("base64"), tag: cipher.getAuthTag().toString("base64") };
}
function decryptToken(value) {
  const decipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey, Buffer.from(value.iv, "base64"));
  decipher.setAuthTag(Buffer.from(value.tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(value.data, "base64")), decipher.final()]).toString("utf8");
}
function safeRecord(record) {
  return { id: record.id, name: record.name, username: record.username, type: record.type, typeLabel: record.typeLabel, createdAt: record.createdAt };
}
const money = (amount) => new Intl.NumberFormat("uz-UZ").format(amount) + " so‘m";
const userBalance = (userId) => balances.get(userId) || 0;
const userBots = (userId) => createdBots.get(userId) || [];

app.get("/", (_req, res) => res.status(200).send("NEXBOT is running."));
app.get("/health", (_req, res) => res.status(200).json({ ok: true }));

// Telegram webhook requests are authenticated with the secret token configured per bot.
app.post("/telegram/main", async (req, res) => {
  if (req.get("x-telegram-bot-api-secret-token") !== mainWebhookSecret) return res.sendStatus(401);
  res.sendStatus(200);
  try { await bot.handleUpdate(req.body); }
  catch (error) { console.error("Main bot update failed:", error?.message || "unknown error"); }
});
app.post("/telegram/bots/:id", async (req, res) => {
  const entry = activeBots.get(req.params.id);
  if (!entry || req.get("x-telegram-bot-api-secret-token") !== entry.secretToken) return res.sendStatus(401);
  res.sendStatus(200);
  try { await entry.bot.handleUpdate(req.body); }
  catch (error) { console.error("Created bot update failed:", error?.message || "unknown error"); }
});

const mainKeyboard = () => Markup.keyboard([
  ["🤖 BOT YARATISH"], ["💰 BALANS", "👤 PROFIL"],
  ["➕ BALANS TO‘LDIRISH", "🆘 YORDAM"]
]).resize();
const typeKeyboard = () => Markup.inlineKeyboard([
  [Markup.button.callback("🎬 KINO BOT", "create_kino")],
  [Markup.button.callback("📥 DOWNLOAD BOT", "create_download")],
  [Markup.button.callback("📢 SMM BOT", "create_smm")],
  [Markup.button.callback("⬅️ Bekor qilish", "cancel_create")]
]);

bot.start(async (ctx) => {
  sessions.delete(ctx.from.id);
  await ctx.reply("⚡ NEXBOT platformasiga xush kelibsiz!\n\nBot yaratish, balans va profilingizni quyidagi tugmalardan boshqaring.", mainKeyboard());
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
  await ctx.reply("💰 Sizning balansingiz: " + money(userBalance(ctx.from.id)) + "\n\nBu MVP versiyada balans haqiqiy to‘lov bilan avtomatik to‘ldirilmaydi.", mainKeyboard());
});
bot.hears("👤 PROFIL", async (ctx) => {
  const list = userBots(ctx.from.id);
  const botList = list.length ? list.map((item, index) => (index + 1) + ". @" + item.username + " — " + item.typeLabel).join("\n") : "Hali bot yaratmagansiz.";
  await ctx.reply("👤 PROFIL\nIsm: " + (ctx.from.first_name || "Foydalanuvchi") + "\nTelegram ID: " + ctx.from.id + "\n💰 Balans: " + money(userBalance(ctx.from.id)) + "\n🤖 Yaratilgan botlar: " + list.length + "\n\n" + botList, mainKeyboard());
});
bot.hears("➕ BALANS TO‘LDIRISH", async (ctx) => {
  sessions.set(ctx.from.id, { step: "topup_amount" });
  await ctx.reply("➕ Balans to‘ldirish\n\nQancha so‘m to‘ldirmoqchisiz? Faqat summani yuboring (masalan, 20000). Hozircha bu admin orqali qo‘lda ko‘rib chiqiladigan so‘rov; avtomatik to‘lov tizimi ulanmagan.", Markup.keyboard([["⬅️ MENYUGA QAYTISH"]]).resize());
});
bot.hears("🆘 YORDAM", async (ctx) => {
  await ctx.reply("🆘 NEXBOT YORDAM\n\n🤖 BOT YARATISH — BotFather tokenini yuboring va bot turini tanlang.\n💰 BALANS — balansingizni ko‘ring.\n👤 PROFIL — profilingiz va yaratilgan botlar.\n➕ BALANS TO‘LDIRISH — admin ko‘rib chiqishi uchun so‘rov yuboring.\n\nTokeningizni hech kimga, hatto admin deb tanishtirgan notanish odamga ham bermang.", mainKeyboard());
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

function registerChildHandlers(child, { token, ownerId, type, id, secretToken, record }) {
  const me = { first_name: record.name, username: record.username };
  const movies = Array.isArray(record.movies) ? record.movies : [];
  child.start(async (ctx) => {
    const descriptions = {
      kino: "🎬 Kino botga xush kelibsiz!\n\nBuyruqlar:\n/movies — barcha kinolar\n/search nom — kino qidirish\n/help — yordam\n\nBot egasi kino qo‘shishi:\n/addmovie Nom | Tavsif | https://havola",
      download: "📥 Download botga xush kelibsiz!\n\nOchiq, to‘g‘ridan-to‘g‘ri video havolasini yuboring. HTTPS havola bo‘lishi kerak va video Telegram tomonidan olinishi mumkin bo‘lishi kerak.\n/help — yordam",
      smm: "📢 SMM botga xush kelibsiz!\n\nBuyurtma yuborish uchun xizmat turi, sahifa havolasi va miqdorni yozing. Masalan:\nInstagram obunachi | https://instagram.com/... | 100\n/help — yordam"
    };
    await ctx.reply(descriptions[type] || "Bot ishga tayyor.");
  });
  child.command("help", async (ctx) => {
    const help = {
      kino: "🎬 Kino buyruqlari:\n/movies — kino ro‘yxati\n/search nom — qidirish\n/addmovie Nom | Tavsif | https://havola — kino qo‘shish (faqat egasi)",
      download: "📥 Video yuklash:\nOchiq HTTPS video havolasini yuboring. Havola login talab qilmasligi va Telegram tomonidan ochilishi kerak. Bu bot yopiq saytlar cheklovini aylanib o‘tmaydi.",
      smm: "📢 SMM buyurtmasi:\nXizmat turi | Sahifa havolasi | Miqdor\nMisol: Instagram obunachi | https://instagram.com/example | 100"
    };
    await ctx.reply(help[type] || "Yordam uchun bot egasiga murojaat qiling.");
  });

  if (type === "kino") {
    child.command("addmovie", async (ctx) => {
      if (ctx.from.id !== ownerId) return ctx.reply("Kino qo‘shish faqat bot egasiga ruxsat etilgan.");
      const parts = ctx.message.text.replace(/^\/addmovie(?:@\w+)?\s*/i, "").split("|").map((part) => part.trim());
      if (parts.length < 3 || !parts[0] || !parts[1]) return ctx.reply("Format:\n/addmovie Kino nomi | Tavsif | https://havola");
      let parsed;
      try { parsed = new URL(parts.slice(2).join(" | ")); } catch {}
      if (!parsed || parsed.protocol !== "https:") return ctx.reply("Havola https:// bilan boshlanishi kerak.");
      const existing = movies.findIndex((movie) => movie.title.toLowerCase() === parts[0].toLowerCase());
      const movie = { title: parts[0], description: parts[1], url: parsed.href };
      if (existing >= 0) movies[existing] = movie;
      else movies.push(movie);
      await botRecords.updateOne({ id }, { $set: { movies } });
      return ctx.reply("✅ “" + movie.title + "” " + (existing >= 0 ? "yangilandi." : "kinolar ro‘yxatiga qo‘shildi."));
    });
    child.command("movies", async (ctx) => {
      if (!movies.length) return ctx.reply("Hozircha kino qo‘shilmagan.\nBot egasidan kino qo‘shishni so‘rang.");
      const lines = movies.map((movie, index) => (index + 1) + ". " + movie.title);
      return ctx.reply("🎬 Kinolar (" + movies.length + "):\n\n" + lines.join("\n") + "\n\nKino qidirish: /search nom");
    });
    child.command("search", async (ctx) => {
      const query = ctx.message.text.replace(/^\/search(?:@\w+)?\s*/i, "").trim().toLocaleLowerCase();
      if (!query) return ctx.reply("Qidirish uchun: /search kino nomi");
      const found = movies.filter((movie) => movie.title.toLocaleLowerCase().includes(query)).slice(0, 5);
      if (!found.length) return ctx.reply("🔎 Kino topilmadi. Nomini boshqacha yozib ko‘ring.");
      for (const movie of found) {
        const keyboard = Markup.inlineKeyboard([[Markup.button.url("▶️ Ko‘rish", movie.url)]]);
        await ctx.reply("🎬 " + movie.title + "\n\n" + movie.description, keyboard);
      }
    });
  }

  if (type === "download") {
    child.on("text", async (ctx) => {
      const input = ctx.message.text.trim();
      if (input.startsWith("/")) return;
      let url;
      try { url = new URL(input); } catch { return ctx.reply("Video havolasini to‘liq yuboring (https://...)."); }
      if (url.protocol !== "https:") return ctx.reply("Xavfsizlik uchun faqat HTTPS havolalar qabul qilinadi.");
      if (!/\.(mp4|m4v|mov|webm)$/i.test(url.pathname)) {
        return ctx.reply("Bu havola to‘g‘ridan-to‘g‘ri video faylga o‘xshamayapti. .mp4, .m4v, .mov yoki .webm fayl havolasini yuboring. YouTube/TikTok kabi sahifa havolalari bevosita yuklanmasligi mumkin.");
      }
      await ctx.reply("⏳ Video tekshirilmoqda...");
      try {
        await ctx.replyWithVideo({ url: url.href }, { supports_streaming: true });
      } catch (error) {
        console.error("Download bot video error:", error?.message || "unknown error");
        await ctx.reply("❌ Telegram bu videoni havoladan ola olmadi. Havola ochiq, to‘g‘ridan-to‘g‘ri video fayl ekanini va hajmi Telegram cheklovidan oshmasligini tekshiring.");
      }
    });
  }

  if (type === "smm") {
    child.on("text", async (ctx) => {
      const input = ctx.message.text.trim();
      if (input.startsWith("/")) return;
      if (input.length < 8) return ctx.reply("Buyurtmani batafsilroq yozing:\nXizmat turi | Sahifa havolasi | Miqdor");
      const request = "📢 Yangi SMM so‘rovi\nBot: @" + me.username +
        "\nFoydalanuvchi ID: " + ctx.from.id +
        "\nUsername: @" + (ctx.from.username || "yo‘q") +
        "\n\nSo‘rov:\n" + input;
      try {
        await child.telegram.sendMessage(ownerId, request);
        await ctx.reply("✅ So‘rovingiz bot egasiga yuborildi. Javobni kuting.");
      } catch (error) {
        console.error("SMM owner notification failed:", error?.message || "unknown error");
        await ctx.reply("❌ Buyurtmani egasiga yuborib bo‘lmadi. Bot egasi ushbu botni Telegram’da bir marta ochib /start bosganini tekshirsin.");
      }
    });
  }
  child.catch((error) => console.error("Created bot error:", error?.message || "unknown error"));
  return { bot: child, secretToken, token, id, ownerId, type };
}
async function startSavedBot(record, token) {
  const child = new Telegraf(token);
  const entry = registerChildHandlers(child, {
    token, ownerId: record.ownerId, type: record.type, id: record.id,
    secretToken: record.webhookSecret, record
  });
  activeBots.set(record.id, entry);
  await child.telegram.setWebhook(BASE_URL + "/telegram/bots/" + record.id, { secret_token: record.webhookSecret, drop_pending_updates: false });
  const safe = safeRecord(record);
  const list = createdBots.get(record.ownerId) || [];
  if (!list.some((item) => item.id === safe.id)) list.push(safe);
  createdBots.set(record.ownerId, list);
  return entry;
}

async function launchUserBot({ token, ownerId, type, typeLabel }) {
  const child = new Telegraf(token);
  const me = await child.telegram.getMe();
  const id = crypto.randomUUID();
  const webhookSecret = crypto.randomBytes(32).toString("base64url");
  const record = {
    id, ownerId, type, typeLabel, name: me.first_name, username: me.username,
    encryptedToken: encryptToken(token), webhookSecret, movies: [], createdAt: new Date().toISOString()
  };
  await botRecords.insertOne(record);
  try {
    const entry = await startSavedBot(record, token);
    return { ...safeRecord(record), bot: entry.bot };
  } catch (error) {
    activeBots.delete(id);
    await botRecords.deleteOne({ id });
    try { await child.telegram.deleteWebhook({ drop_pending_updates: false }); } catch {}
    throw error;
  }
}

async function createSelectedBot(ctx, session, type) {
  const types = { kino: { label: "Kino bot" }, download: { label: "Download bot" }, smm: { label: "SMM bot" } };
  const selected = types[type];
  if (!selected || !session?.token) {
    sessions.set(ctx.from.id, { step: "choose_type" });
    return ctx.reply("Avval bot turini tanlang.", typeKeyboard());
  }
  await ctx.reply("⏳ " + selected.label + " ishga tushirilmoqda. Token tekshirilmoqda...");
  try {
    const record = await launchUserBot({ token: session.token, ownerId: ctx.from.id, type, typeLabel: selected.label });
    sessions.delete(ctx.from.id);
    await ctx.reply("✅ Bot muvaffaqiyatli ishga tushdi!\n\nNomi: " + record.name + "\nUsername: @" + record.username + "\nTuri: " + selected.label + "\n\nSinash uchun @" + record.username + " ni ochib /start bosing.", mainKeyboard());
  } catch (error) {
    console.error("User bot setup failed:", error?.message || "unknown error");
    sessions.set(ctx.from.id, { step: "bot_token", type, token: undefined });
    await ctx.reply("❌ Bot ishga tushmadi. Token noto‘g‘ri bo‘lishi yoki boshqa sozlamada muammo bo‘lishi mumkin. Tokenni tekshirib qayta yuboring. Tokenni hech kimga bermang.", Markup.keyboard([["⬅️ MENYUGA QAYTISH"]]).resize());
  }
}
bot.action(/^create_(kino|download|smm)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const type = ctx.match[1];
  const session = sessions.get(ctx.from.id);
  if (!session?.token) {
    sessions.set(ctx.from.id, { step: "bot_token", type });
    const labels = { kino: "🎬 KINO BOT", download: "📥 DOWNLOAD BOT", smm: "📢 SMM BOT" };
    await ctx.reply("Siz " + labels[type] + "ni tanladingiz. Endi @BotFather orqali yaratgan o‘zingizga tegishli bot tokenini yuboring. Token maxfiy; uni hech kim bilan ulashmang.", Markup.keyboard([["⬅️ MENYUGA QAYTISH"]]).resize());
    return;
  }
  return createSelectedBot(ctx, session, type);
});

bot.on("text", async (ctx) => {
  const session = sessions.get(ctx.from.id);
  if (!session) return;
  const input = ctx.message.text.trim();
  if (input.startsWith("/")) return;
  if (session.step === "bot_token") {
    try { await ctx.deleteMessage(); } catch {}
    if (input.length < 30 || !input.includes(":")) return ctx.reply("Token formati noto‘g‘ri ko‘rinadi. @BotFather bergan tokenni qayta tekshiring va yuboring.");
    session.token = input;
    const selectedType = session.type;
    if (!selectedType) {
      sessions.set(ctx.from.id, { step: "choose_type", token: input });
      return ctx.reply("Token qabul qilindi. Endi bot turini tanlang:", typeKeyboard());
    }
    return createSelectedBot(ctx, session, selectedType);
  }
  if (session.step === "topup_amount") {
    const amount = Number(input.replace(/[\s,]/g, ""));
    if (!Number.isSafeInteger(amount) || amount < 1000 || amount > 100000000) return ctx.reply("Summani raqam bilan yuboring (kamida 1000 so‘m).", mainKeyboard());
    sessions.delete(ctx.from.id);
    const message = "💳 Balans to‘ldirish so‘rovi\nIsm: " + (ctx.from.first_name || "Foydalanuvchi") + "\nTelegram ID: " + ctx.from.id + "\nUsername: @" + (ctx.from.username || "yo‘q") + "\nSumma: " + money(amount);
    if (!ADMIN_IDS.length) return ctx.reply("So‘rov saqlandi faqat joriy sessiya ichida, lekin admin xabari yuborilmadi. Render Environment’da ADMIN_IDS sozlang.", mainKeyboard());
    for (const id of ADMIN_IDS) {
      try { await bot.telegram.sendMessage(id, message); }
      catch (error) { console.error("Could not notify admin:", error?.message || "unknown error"); }
    }
    return ctx.reply("✅ Balans to‘ldirish so‘rovingiz adminga yuborildi. To‘lov avtomatik olinmaydi.", mainKeyboard());
  }
});

bot.command("credit", async (ctx) => {
  if (!ADMIN_IDS.includes(ctx.from.id)) return ctx.reply("Bu buyruq faqat admin uchun.");
  const parts = ctx.message.text.split(/\s+/);
  const userId = Number(parts[1]);
  const amount = Number(parts[2]);
  if (!Number.isSafeInteger(userId) || !Number.isSafeInteger(amount) || amount <= 0) return ctx.reply("Format: /credit USER_ID AMOUNT");
  balances.set(userId, userBalance(userId) + amount);
  return ctx.reply("✅ " + userId + " foydalanuvchi balansi " + money(amount) + " ga oshirildi.");
});

bot.catch((error) => console.error("NEXBOT error:", error?.message || "unknown error"));

const server = app.listen(PORT, "0.0.0.0", () => console.log("HTTP server listening on " + PORT));

async function startApp() {
  await mongo.connect();
  const db = mongo.db();
  botRecords = db.collection("nexbot_created_bots");
  userRecords = db.collection("nexbot_users");
  await botRecords.createIndex({ id: 1 }, { unique: true });
  await botRecords.createIndex({ ownerId: 1 });
  await userRecords.createIndex({ userId: 1 }, { unique: true });

  const saved = await botRecords.find({}).toArray();
  for (const record of saved) {
    try {
      const token = decryptToken(record.encryptedToken);
      await startSavedBot(record, token);
      console.log("Restored created bot: @" + record.username);
    } catch (error) {
      console.error("Could not restore bot " + (record.username || record.id) + ":", error?.message || "unknown error");
    }
  }
  await bot.telegram.setWebhook(BASE_URL + "/telegram/main", { secret_token: mainWebhookSecret, drop_pending_updates: false });
  console.log("NEXBOT webhook configured");
}
startApp().catch((error) => {
  console.error("Startup failed:", error?.message || "unknown error");
});

const shutdown = async (signal) => {
  console.log(signal + " received; stopping bots");
  // Keep webhooks registered during deploy/restart; deleting them here can race with the new instance.
  server.close(async () => {
    try { await mongo.close(); } catch {}
    process.exit(0);
  });
};
process.once("SIGINT", () => shutdown("SIGINT"));
process.once("SIGTERM", () => shutdown("SIGTERM"));
