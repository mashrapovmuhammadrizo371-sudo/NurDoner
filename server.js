import express from "express";
import mongoose from "mongoose";
import crypto from "crypto";
import { Telegraf, Markup } from "telegraf";

const app=express(); app.use(express.json()); app.use(express.static("public"));
const PORT=process.env.PORT||3000, APP_URL=(process.env.MINI_APP_URL||"").replace(/\/$/,""), WEBHOOK_PATH="/telegram/webhook";
const SMM_API_URL="https://cheap-smm.uz/api/v2";

const userSchema=new mongoose.Schema({telegramId:{type:String,unique:true,index:true},username:String,firstName:String,createdAt:{type:Date,default:Date.now}});
const orderSchema=new mongoose.Schema({telegramId:{type:String,index:true},orderId:{type:String,index:true},serviceId:String,serviceName:String,category:String,link:String,quantity:Number,charge:Number,currency:String,status:{type:String,default:"Pending"},createdAt:{type:Date,default:Date.now}});
const User=mongoose.model("User",userSchema), Order=mongoose.model("Order",orderSchema);

function admins(){return(process.env.ADMIN_TELEGRAM_IDS||"").split(",").map(x=>x.trim()).filter(Boolean)}
function isAdmin(id){return admins().includes(String(id))}
function validateTelegram(initData){
 if(!initData||!process.env.BOT_TOKEN)return null;
 const p=new URLSearchParams(initData),hash=p.get("hash");p.delete("hash");
 const data=[...p.entries()].sort().map(([k,v])=>`${k}=${v}`).join("\n");
 const secret=crypto.createHmac("sha256","WebAppData").update(process.env.BOT_TOKEN).digest();
 const check=crypto.createHmac("sha256",secret).update(data).digest("hex");
 if(!hash||hash.length!==check.length||!crypto.timingSafeEqual(Buffer.from(hash),Buffer.from(check)))return null;
 const u=p.get("user");return u?JSON.parse(u):null;
}
async function currentUser(req,res){
 const u=validateTelegram(req.headers["x-telegram-init-data"]);
 if(!u){res.status(401).json({error:"Telegram session required"});return null}
 return User.findOneAndUpdate({telegramId:String(u.id)},{$set:{username:u.username||"",firstName:u.first_name||""}},{upsert:true,new:true,setDefaultsOnInsert:true});
}
async function smm(params){
 if(!process.env.CHEAP_SMM_API_KEY)throw new Error("CHEAP_SMM_API_KEY is not configured");
 const body=new URLSearchParams({key:process.env.CHEAP_SMM_API_KEY,...params});
 const r=await fetch(SMM_API_URL,{method:"POST",body}); if(!r.ok)throw new Error(`CheapSMM HTTP ${r.status}`);
 const data=await r.json(); if(data?.error)throw new Error(data.error); return data;
}
let servicesCache={data:[],expires:0};
async function getServices(){
 if(servicesCache.expires>Date.now()&&servicesCache.data.length)return servicesCache.data;
 const data=await smm({action:"services"}); if(!Array.isArray(data))throw new Error("Invalid services response");
 servicesCache={data,expires:Date.now()+300000};return data;
}

app.get("/",(req,res)=>res.sendFile("index.html",{root:"public"}));
app.get("/health",(req,res)=>res.json({ok:true,service:"SMM Bot"}));
app.get("/api/me",async(req,res)=>{try{const u=await currentUser(req,res);if(u)res.json(u)}catch(e){res.status(500).json({error:e.message})}});
app.get("/api/services",async(req,res)=>{try{res.json(await getServices())}catch(e){res.status(502).json({error:e.message})}});
app.get("/api/orders",async(req,res)=>{try{const u=await currentUser(req,res);if(!u)return;res.json(await Order.find({telegramId:u.telegramId}).sort({createdAt:-1}).limit(50))}catch(e){res.status(500).json({error:e.message})}});

app.post("/api/orders",async(req,res)=>{
 try{
  const u=await currentUser(req,res);if(!u)return;
  const serviceId=String(req.body.serviceId||""),link=String(req.body.link||"").trim(),quantity=Number(req.body.quantity);
  if(!serviceId||!link||!Number.isInteger(quantity)||quantity<=0)return res.status(400).json({error:"Xizmat, link va miqdorni to‘g‘ri kiriting"});
  const services=await getServices(),service=services.find(s=>String(s.service)===serviceId);
  if(!service)return res.status(400).json({error:"Xizmat topilmadi"});
  const min=Number(service.min),max=Number(service.max);
  if(quantity<min||quantity>max)return res.status(400).json({error:`Miqdor ${min}–${max} oralig‘ida bo‘lishi kerak`});
  const result=await smm({action:"add",service:serviceId,link,quantity:String(quantity)});
  if(!result.order)throw new Error(result.error||"Buyurtma yaratilmadi");
  const charge=Number(service.rate)*quantity/1000;
  const order=await Order.create({telegramId:u.telegramId,orderId:String(result.order),serviceId,serviceName:service.name,category:service.category,link,quantity,charge:Number(charge.toFixed(6)),currency:"UZS",status:"Pending"});
  res.json(order);
 }catch(e){res.status(502).json({error:e.message})}
});

app.get("/api/orders/:id",async(req,res)=>{
 try{
  const u=await currentUser(req,res);if(!u)return;
  const order=await Order.findOne({telegramId:u.telegramId,orderId:String(req.params.id)});
  if(!order)return res.status(404).json({error:"Buyurtma topilmadi"});
  const result=await smm({action:"status",order:order.orderId});
  order.status=result.status||order.status;if(result.charge!=null)order.charge=Number(result.charge);if(result.currency)order.currency=result.currency;await order.save();
  res.json({...order.toObject(),provider:result});
 }catch(e){res.status(502).json({error:e.message})}
});

async function admin(req,res,next){const u=validateTelegram(req.headers["x-telegram-init-data"]);if(!u||!isAdmin(u.id))return res.status(403).json({error:"Admin access denied"});req.admin=u;next()}
app.get("/api/admin/stats",admin,async(req,res)=>res.json({users:await User.countDocuments(),orders:await Order.countDocuments(),completed:await Order.countDocuments({status:"Completed"}),pending:await Order.countDocuments({status:{$in:["Pending","In progress"]}})}));
app.get("/api/admin/balance",admin,async(req,res)=>{try{res.json(await smm({action:"balance"}))}catch(e){res.status(502).json({error:e.message})}});
app.get("/api/admin/orders",admin,async(req,res)=>res.json(await Order.find().sort({createdAt:-1}).limit(500)));

let bot=null;
const sessions=new Map();

function mainKeyboard(){
 return Markup.keyboard([
  ["🛒 Buyurtma berish","📦 Buyurtmalarim"],
  ["📋 Xizmatlar","💰 Balans"],
  ["👤 Profil","ℹ️ Yordam"]
 ]).resize();
}
function formatService(s){
 return `🔹 ${s.name}\nID: ${s.service}\nNarx: ${s.rate} UZS / 1000\nMin: ${s.min} | Max: ${s.max}`;
}
async function sendServices(ctx){
 const services=await getServices();
 if(!services.length)return ctx.reply("Hozircha xizmatlar topilmadi.");
 const categories=[...new Set(services.map(s=>s.category).filter(Boolean))];
 const buttons=categories.slice(0,40).map(c=>[Markup.button.callback(`📁 ${c}`,`cat:${encodeURIComponent(c)}`)]);
 await ctx.reply(`📋 Xizmatlar: ${services.length} ta\n\nKategoriya tanlang:`,Markup.inlineKeyboard(buttons));
}

if(process.env.BOT_TOKEN){
 bot=new Telegraf(process.env.BOT_TOKEN);

 bot.start(async ctx=>{
  sessions.delete(String(ctx.from.id));
  await ctx.reply("🚀 SMM Botga xush kelibsiz!\n\nXizmatni tanlang:",mainKeyboard());
 });

 bot.hears("📋 Xizmatlar",async ctx=>{
  try{await sendServices(ctx)}catch(e){await ctx.reply("❌ Xizmatlarni olishda xatolik: "+e.message)}
 });

 bot.hears("🛒 Buyurtma berish",async ctx=>{
  try{
   const services=await getServices();
   const categories=[...new Set(services.map(s=>s.category).filter(Boolean))];
   await ctx.reply("🛒 Buyurtma berish\n\nAvval kategoriya tanlang:",Markup.inlineKeyboard(categories.slice(0,40).map(c=>[Markup.button.callback(`📁 ${c}`,`ordercat:${encodeURIComponent(c)}`)])));
  }catch(e){await ctx.reply("❌ "+e.message)}
 });

 bot.action(/^cat:(.+)$/,async ctx=>{
  try{
   await ctx.answerCbQuery();
   const category=decodeURIComponent(ctx.match[1]);
   const services=(await getServices()).filter(s=>String(s.category||"")===category).slice(0,50);
   if(!services.length)return ctx.reply("Xizmat topilmadi.");
   await ctx.reply(`📁 ${category}\n\nXizmatni tanlang:`,Markup.inlineKeyboard(services.map(s=>[Markup.button.callback(String(s.name).slice(0,55),`service:${s.service}`)])));
  }catch(e){await ctx.reply("❌ "+e.message)}
 });

 bot.action(/^ordercat:(.+)$/,async ctx=>{
  try{
   await ctx.answerCbQuery();
   const category=decodeURIComponent(ctx.match[1]);
   const services=(await getServices()).filter(s=>String(s.category||"")===category).slice(0,50);
   await ctx.reply(`📁 ${category}\n\nBuyurtma uchun xizmatni tanlang:`,Markup.inlineKeyboard(services.map(s=>[Markup.button.callback(String(s.name).slice(0,55),`buyservice:${s.service}`)])));
  }catch(e){await ctx.reply("❌ "+e.message)}
 });

 bot.action(/^service:(.+)$/,async ctx=>{
  try{
   await ctx.answerCbQuery();
   const s=(await getServices()).find(x=>String(x.service)===String(ctx.match[1]));
   if(!s)return ctx.reply("Xizmat topilmadi.");
   await ctx.reply(formatService(s));
  }catch(e){await ctx.reply("❌ "+e.message)}
 });

 bot.action(/^buyservice:(.+)$/,async ctx=>{
  try{
   await ctx.answerCbQuery();
   const serviceId=String(ctx.match[1]),s=(await getServices()).find(x=>String(x.service)===serviceId);
   if(!s)return ctx.reply("Xizmat topilmadi.");
   sessions.set(String(ctx.from.id),{step:"link",serviceId});
   await ctx.reply(`🛒 ${s.name}\n\n🔗 Linkni yuboring:`);
  }catch(e){await ctx.reply("❌ "+e.message)}
 });

 bot.hears("📦 Buyurtmalarim",async ctx=>{
  try{
   const u=await User.findOne({telegramId:String(ctx.from.id)});
   if(!u)return ctx.reply("Sizda hali buyurtmalar yo‘q.",mainKeyboard());
   const orders=await Order.find({telegramId:u.telegramId}).sort({createdAt:-1}).limit(10);
   if(!orders.length)return ctx.reply("📦 Hali buyurtmalar yo‘q.",mainKeyboard());
   await ctx.reply("📦 Oxirgi buyurtmalar:\n\n"+orders.map(o=>`#${o.orderId} — ${o.status}\n${o.serviceName}\nMiqdor: ${o.quantity}`).join("\n\n"),mainKeyboard());
  }catch(e){await ctx.reply("❌ "+e.message)}
 });

 bot.hears("💰 Balans",async ctx=>{
  try{const b=await smm({action:"balance"});await ctx.reply(`💰 SMM balans: ${b.balance??"—"} ${b.currency||"UZS"}`,mainKeyboard())}catch(e){await ctx.reply("❌ "+e.message)}
 });

 bot.hears("👤 Profil",async ctx=>{
  const u=await User.findOne({telegramId:String(ctx.from.id)});
  await ctx.reply(`👤 Profil\n\nTelegram ID: ${ctx.from.id}\nUsername: @${ctx.from.username||"—"}\nBuyurtmalar: ${await Order.countDocuments({telegramId:String(ctx.from.id)})}`,mainKeyboard());
 });

 bot.hears("ℹ️ Yordam",ctx=>ctx.reply("ℹ️ Yordam\n\n🛒 Buyurtma berish — xizmat tanlab, link va miqdor yuborasiz.\n📦 Buyurtmalarim — buyurtmalaringiz.\n📋 Xizmatlar — mavjud xizmatlar.\n💰 Balans — SMM API balansini ko‘rsatadi.",mainKeyboard()));

 bot.on("text",async ctx=>{
  const id=String(ctx.from.id),session=sessions.get(id);
  if(!session)return;
  try{
   const text=ctx.message.text.trim();
   if(session.step==="link"){
    if(!/^https?:\/\//i.test(text))return ctx.reply("❌ To‘g‘ri link yuboring (https://...):");
    session.link=text;session.step="quantity";
    const s=(await getServices()).find(x=>String(x.service)===session.serviceId);
    return ctx.reply(`🔢 Miqdorni yuboring.\nMin: ${s?.min||1} | Max: ${s?.max||"—"}`);
   }
   if(session.step==="quantity"){
    const quantity=Number(text);
    if(!Number.isInteger(quantity)||quantity<=0)return ctx.reply("❌ Faqat butun musbat son yuboring.");
    const s=(await getServices()).find(x=>String(x.service)===session.serviceId);
    if(!s)return ctx.reply("❌ Xizmat topilmadi.");
    if(quantity<Number(s.min)||quantity>Number(s.max))return ctx.reply(`❌ Miqdor ${s.min}–${s.max} oralig‘ida bo‘lishi kerak.`);
    const result=await smm({action:"add",service:session.serviceId,link:session.link,quantity:String(quantity)});
    if(!result.order)throw new Error(result.error||"Buyurtma yaratilmadi");
    const u=await User.findOneAndUpdate({telegramId:id},{$set:{username:ctx.from.username||"",firstName:ctx.from.first_name||""}},{upsert:true,new:true,setDefaultsOnInsert:true});
    const order=await Order.create({telegramId:id,orderId:String(result.order),serviceId:session.serviceId,serviceName:s.name,category:s.category,link:session.link,quantity,charge:Number((Number(s.rate)*quantity/1000).toFixed(6)),currency:"UZS",status:"Pending"});
    sessions.delete(id);
    return ctx.reply(`✅ Buyurtma qabul qilindi!\n\n🆔 Order ID: ${order.orderId}\n📋 ${order.serviceName}\n🔢 Miqdor: ${quantity}\n📊 Status: Pending`,mainKeyboard());
   }
  }catch(e){sessions.delete(id);await ctx.reply("❌ Buyurtma xatosi: "+e.message,mainKeyboard())}
 });

 bot.command("menu",ctx=>ctx.reply("🚀 Asosiy menyu:",mainKeyboard()));
 // Use Telegram polling for the Reply Keyboard; clear any old webhook first.\n
}

app.listen(PORT,async()=>{console.log("SMM Bot running on "+PORT);if(bot){try{await bot.telegram.deleteWebhook({drop_pending_updates:false});await bot.launch();console.log("Telegram polling enabled")}catch(e){console.error("Telegram polling error:",e.message)}}});
mongoose.connect(process.env.MONGODB_URI).then(()=>console.log("MongoDB connected")).catch(e=>console.error("MongoDB error:",e.message));
process.once("SIGINT",()=>bot?.stop("SIGINT"));process.once("SIGTERM",()=>bot?.stop("SIGTERM"));
