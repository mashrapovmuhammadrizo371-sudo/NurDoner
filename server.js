import express from "express";
import mongoose from "mongoose";
import crypto from "crypto";
import QRCode from "qrcode";
import { Telegraf, Markup } from "telegraf";

const app=express();
app.use(express.json());
app.use(express.static("public"));
const PORT=process.env.PORT||3000;
const APP_URL=(process.env.MINI_APP_URL||"").replace(/\/$/,"");
const WEBHOOK_PATH="/telegram/webhook";

const userSchema=new mongoose.Schema({
 telegramId:{type:String,unique:true,index:true}, username:String, firstName:String,
 points:{type:Number,default:0}, favorites:{type:[String],default:[]}, createdAt:{type:Date,default:Date.now}
});
const productSchema=new mongoose.Schema({name:String,description:String,price:Number,image:String,category:String,active:{type:Boolean,default:true}});
const promoSchema=new mongoose.Schema({title:String,text:String,active:{type:Boolean,default:true},createdAt:{type:Date,default:Date.now}});
const visitSchema=new mongoose.Schema({telegramId:String,points:Number,createdAt:{type:Date,default:Date.now}});
const rewardSchema=new mongoose.Schema({title:String,cost:Number,active:{type:Boolean,default:true}});
const User=mongoose.model("User",userSchema), Product=mongoose.model("Product",productSchema),
Promo=mongoose.model("Promo",promoSchema), Visit=mongoose.model("Visit",visitSchema), Reward=mongoose.model("Reward",rewardSchema);

function admins(){return (process.env.ADMIN_TELEGRAM_IDS||"").split(",").map(x=>x.trim()).filter(Boolean)}
function isAdmin(id){return admins().includes(String(id))}
function validateTelegram(initData){
 if(!initData||!process.env.BOT_TOKEN) return null;
 const p=new URLSearchParams(initData), hash=p.get("hash"); p.delete("hash");
 const data=[...p.entries()].sort().map(([k,v])=>`${k}=${v}`).join("\n");
 const secret=crypto.createHmac("sha256","WebAppData").update(process.env.BOT_TOKEN).digest();
 const check=crypto.createHmac("sha256",secret).update(data).digest("hex");
 if(!hash||hash.length!==check.length||!crypto.timingSafeEqual(Buffer.from(hash),Buffer.from(check))) return null;
 const u=p.get("user"); return u?JSON.parse(u):null;
}
async function currentUser(req,res){
 const u=validateTelegram(req.headers["x-telegram-init-data"]);
 if(!u) return res.status(401).json({error:"Telegram session required"});
 const user=await User.findOneAndUpdate({telegramId:String(u.id)},
  {$set:{username:u.username||"",firstName:u.first_name||""}},{upsert:true,new:true,setDefaultsOnInsert:true});
 return user;
}

app.get("/",(req,res)=>res.sendFile("index.html",{root:"public"}));
app.get("/health",(req,res)=>res.json({ok:true,service:"NurDoner"}));

app.get("/api/me",async(req,res)=>{try{const u=await currentUser(req,res);if(!u)return;res.json(u)}catch(e){res.status(500).json({error:e.message})}});
app.get("/api/products",async(req,res)=>{try{res.json(await Product.find({active:true}).sort({category:1,name:1}))}catch(e){res.status(500).json({error:e.message})}});
app.get("/api/promos",async(req,res)=>{try{res.json(await Promo.find({active:true}).sort({createdAt:-1}).limit(10))}catch(e){res.status(500).json({error:e.message})}});
app.get("/api/rewards",async(req,res)=>{try{res.json(await Reward.find({active:true}).sort({cost:1}))}catch(e){res.status(500).json({error:e.message})}});
app.post("/api/favorite/:id",async(req,res)=>{try{const u=await currentUser(req,res);if(!u)return;const id=req.params.id;u.favorites=u.favorites.includes(id)?u.favorites.filter(x=>x!==id):[...u.favorites,id];await u.save();res.json(u)}catch(e){res.status(500).json({error:e.message})}});
app.get("/api/qr",async(req,res)=>{try{const u=await currentUser(req,res);if(!u)return;res.type("text/plain").send(await QRCode.toDataURL(`NURDONER:${u.telegramId}`))}catch(e){res.status(500).json({error:e.message})}});

async function admin(req,res,next){
 const u=validateTelegram(req.headers["x-telegram-init-data"]);
 if(!u||!isAdmin(u.id)) return res.status(403).json({error:"Admin access denied"});
 req.admin=u; next();
}
app.get("/api/admin/stats",admin,async(req,res)=>res.json({
 users:await User.countDocuments(), products:await Product.countDocuments({active:true}),
 visits:await Visit.countDocuments(), points:(await User.aggregate([{$group:{_id:null,total:{$sum:"$points"}}}]))[0]?.total||0
}));
app.get("/api/admin/users",admin,async(req,res)=>res.json(await User.find().sort({createdAt:-1}).limit(500)));
app.post("/api/admin/visit",admin,async(req,res)=>{
 const telegramId=String(req.body.telegramId||"").replace("NURDONER:","");
 if(!telegramId)return res.status(400).json({error:"QR invalid"});
 const user=await User.findOne({telegramId}); if(!user)return res.status(404).json({error:"Customer not found"});
 const add=Math.max(0,Number(req.body.points||1)); user.points+=add; await user.save(); await Visit.create({telegramId,points:add});
 res.json({ok:true,user});
});
app.post("/api/admin/products",admin,async(req,res)=>res.json(await Product.create(req.body)));
app.delete("/api/admin/products/:id",admin,async(req,res)=>{await Product.findByIdAndUpdate(req.params.id,{active:false});res.json({ok:true})});
app.post("/api/admin/promos",admin,async(req,res)=>res.json(await Promo.create(req.body)));
app.post("/api/admin/rewards",admin,async(req,res)=>res.json(await Reward.create(req.body)));
app.post("/api/admin/broadcast",admin,async(req,res)=>{
 const text=req.body.text?.trim(); if(!text||!bot)return res.status(400).json({error:"Text required"});
 const users=await User.find({}, {telegramId:1}); let sent=0;
 for(const u of users){try{await bot.telegram.sendMessage(u.telegramId,text);sent++}catch{}}
 res.json({sent});
});

let bot=null;
if(process.env.BOT_TOKEN){
 bot=new Telegraf(process.env.BOT_TOKEN);
 bot.start(ctx=>ctx.reply("🍔 NurDoner Mini App",Markup.keyboard([[Markup.button.webApp("🍔 Mini App'ni ochish",APP_URL||"https://example.com")]]).resize()));
 bot.command("menu",ctx=>ctx.reply("🍔 Mini App'ni oching:",Markup.inlineKeyboard([[Markup.button.webApp("Ochish",APP_URL||"https://example.com")]])));
 app.use(WEBHOOK_PATH,bot.webhookCallback(WEBHOOK_PATH));
}

app.listen(PORT,async()=>{
 console.log("NurDoner running on "+PORT);
 if(bot&&APP_URL){
  try{
   const webhookUrl=APP_URL+WEBHOOK_PATH;
   await bot.telegram.setWebhook(webhookUrl);
   console.log("Telegram webhook enabled: "+webhookUrl);
  }catch(e){console.error("Telegram webhook error:",e.message)}
 }
});

mongoose.connect(process.env.MONGODB_URI).then(async()=>{
 if(await Product.countDocuments()===0) await Product.insertMany([
  {name:"Doner",description:"Yangi non, go'sht, sabzavot va maxsus sous",price:30000,category:"Doner"},
  {name:"Mini Doner",description:"Yengil va mazali",price:22000,category:"Doner"},
  {name:"Fri",description:"Qarsildoq kartoshka",price:15000,category:"Snacks"},
  {name:"Cola",description:"Sovuq ichimlik",price:8000,category:"Drinks"}
 ]);
 console.log("MongoDB connected");
}).catch(e=>console.error("MongoDB error:",e.message));

process.once("SIGINT",()=>bot?.stop("SIGINT"));
process.once("SIGTERM",()=>bot?.stop("SIGTERM"));
