const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { URL } = require("url");

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, "data");
const DB_FILE = path.join(DATA_DIR, "db.json");
const PUBLIC = path.join(ROOT, "public");

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const defaultDb = {
  users: [],
  services: [],
  slots: [],
  bookings: [],
  sessions: []
};

function loadDb() {
  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify(defaultDb, null, 2));
  }
  try { return JSON.parse(fs.readFileSync(DB_FILE, "utf8")); }
  catch { return structuredClone(defaultDb); }
}
let db = loadDb();
function saveDb() {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

const demoPassword = "demo123";
function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return { salt, hash };
}
function verifyPassword(password, salt, hash) {
  return crypto.scryptSync(password, salt, 64).toString("hex") === hash;
}
function id(prefix) {
  return prefix + "_" + crypto.randomBytes(8).toString("hex");
}
function json(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(data),
    "Cache-Control": "no-store"
  });
  res.end(data);
}
function parseCookies(req) {
  const out = {};
  (req.headers.cookie || "").split(";").forEach(part => {
    const i = part.indexOf("=");
    if (i > -1) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  });
  return out;
}
function currentUser(req) {
  const sid = parseCookies(req).timeslot_sid;
  if (!sid) return null;
  const session = db.sessions.find(s => s.id === sid && s.expiresAt > Date.now());
  return session ? db.users.find(u => u.id === session.userId) || null : null;
}
function safeUser(u) {
  if (!u) return null;
  return { id:u.id, name:u.name, email:u.email, role:u.role, slug:u.slug, bio:u.bio, avatar:u.avatar, createdAt:u.createdAt };
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", c => { raw += c; if (raw.length > 1e6) req.destroy(); });
    req.on("end", () => {
      try { resolve(raw ? JSON.parse(raw) : {}); } catch { reject(new Error("invalid_json")); }
    });
    req.on("error", reject);
  });
}
function sendSession(res, userId) {
  const sid = id("sess");
  db.sessions = db.sessions.filter(s => s.expiresAt > Date.now());
  db.sessions.push({ id:sid, userId, expiresAt:Date.now() + 1000*60*60*24*14 });
  saveDb();
  res.setHeader("Set-Cookie", `timeslot_sid=${encodeURIComponent(sid)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${60*60*24*14}`);
}
function logout(res, req) {
  const sid = parseCookies(req).timeslot_sid;
  db.sessions = db.sessions.filter(s => s.id !== sid);
  saveDb();
  res.setHeader("Set-Cookie", "timeslot_sid=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0");
}
function slugify(s) {
  return String(s).toLowerCase().trim().replace(/[^a-zа-яё0-9]+/gi,"-").replace(/^-+|-+$/g,"").slice(0,60) || id("user");
}

function seed() {
  if (db.users.length) return;
  const people = [
    ["Анна Кузнецова","anna@example.com","Репетитор по английскому","Помогаю уверенно говорить по-английски и готовиться к экзаменам.","anna"],
    ["Иван Петров","ivan@example.com","Репетитор по математике","Разбираем сложные темы простым языком.","ivan"],
    ["Мария Волкова","maria@example.com","Мастер маникюра","Маникюр, дизайн и аккуратная работа по записи.","maria"],
    ["Дмитрий Соколов","dmitry@example.com","Персональный тренер","Индивидуальные тренировки онлайн и офлайн.","dmitry"]
  ];
  people.forEach((p,i) => {
    const ph = hashPassword(demoPassword);
    const uid = id("usr");
    db.users.push({id:uid,name:p[0],email:p[1],role:"specialist",slug:p[4],bio:p[3],avatar:p[0].split(" ").map(x=>x[0]).join("").slice(0,2),password:ph,createdAt:Date.now()});
    const sid = id("svc");
    const prices=[700,600,1200,1000];
    db.services.push({id:sid,userId:uid,title:p[2],description:p[3],price:prices[i],duration:60,active:true});
    for(let d=1; d<=5; d++){
      const date = new Date(Date.now()+d*86400000);
      const iso = date.toISOString().slice(0,10);
      ["10:00","12:00","15:00","17:00","18:00"].forEach(time=>{
        db.slots.push({id:id("slot"),userId:uid,serviceId:sid,date:iso,time,booked:false});
      });
    }
  });
  saveDb();
}
seed();

function routeApi(req,res,url) {
  const user = currentUser(req);
  const send = (s,b)=>json(res,s,b);

  if (req.method==="GET" && url.pathname==="/api/me") return send(200,{user:safeUser(user)});
  if (req.method==="POST" && url.pathname==="/api/logout") { logout(res,req); return send(200,{ok:true}); }

  if (req.method==="POST" && url.pathname==="/api/register") return readBody(req).then(b=>{
    const name=String(b.name||"").trim(), email=String(b.email||"").trim().toLowerCase(), password=String(b.password||"");
    const role=b.role==="specialist"?"specialist":"client";
    if(name.length<2 || !email.includes("@") || password.length<6) return send(400,{error:"Введите имя, корректный email и пароль минимум из 6 символов."});
    if(db.users.some(u=>u.email===email)) return send(409,{error:"Пользователь с таким email уже существует."});
    const ph=hashPassword(password), base=slugify(name);
    let slug=base, n=2; while(db.users.some(u=>u.slug===slug)) slug=base+"-"+n++;
    const u={id:id("usr"),name,email,role,slug,bio:"",avatar:name.split(/\s+/).map(x=>x[0]).join("").slice(0,2).toUpperCase(),password:ph,createdAt:Date.now()};
    db.users.push(u); saveDb(); sendSession(res,u.id);
    return send(201,{user:safeUser(u)});
  }).catch(()=>send(400,{error:"Некорректные данные."}));

  if (req.method==="POST" && url.pathname==="/api/login") return readBody(req).then(b=>{
    const email=String(b.email||"").trim().toLowerCase(), password=String(b.password||"");
    const u=db.users.find(x=>x.email===email);
    if(!u || !verifyPassword(password,u.password.salt,u.password.hash)) return send(401,{error:"Неверный email или пароль."});
    sendSession(res,u.id); return send(200,{user:safeUser(u)});
  }).catch(()=>send(400,{error:"Некорректные данные."}));

  if (req.method==="GET" && url.pathname==="/api/specialists") {
    const list=db.users.filter(u=>u.role==="specialist").map(u=>{
      const service=db.services.find(s=>s.userId===u.id&&s.active);
      const slots=db.slots.filter(s=>s.userId===u.id&&!s.booked);
      return {...safeUser(u),service:service?{id:service.id,title:service.title,price:service.price,duration:service.duration}:null,availableSlots:slots.length};
    });
    return send(200,{specialists:list});
  }

  const specMatch=url.pathname.match(/^\/api\/specialists\/([^/]+)$/);
  if(req.method==="GET" && specMatch){
    const u=db.users.find(x=>x.slug===specMatch[1]);
    if(!u) return send(404,{error:"Специалист не найден."});
    const services=db.services.filter(s=>s.userId===u.id&&s.active);
    const slots=db.slots.filter(s=>s.userId===u.id&&!s.booked).sort((a,b)=>(a.date+a.time).localeCompare(b.date+b.time));
    return send(200,{specialist:safeUser(u),services,slots});
  }

  if(!user) return send(401,{error:"Требуется вход."});

  if(req.method==="PUT" && url.pathname==="/api/profile") return readBody(req).then(b=>{
    user.name=String(b.name||user.name).trim().slice(0,80);
    user.bio=String(b.bio||"").trim().slice(0,500);
    saveDb(); return send(200,{user:safeUser(user)});
  });

  if(req.method==="GET" && url.pathname==="/api/dashboard"){
    const services=db.services.filter(s=>s.userId===user.id);
    const slots=db.slots.filter(s=>s.userId===user.id);
    const bookings=db.bookings.filter(b=>b.specialistId===user.id||b.clientId===user.id).sort((a,b)=>b.createdAt-a.createdAt);
    return send(200,{user:safeUser(user),services,slots,bookings});
  }

  if(req.method==="POST" && url.pathname==="/api/services") return readBody(req).then(b=>{
    if(user.role!=="specialist") return send(403,{error:"Только специалист может создавать услуги."});
    const title=String(b.title||"").trim(), price=Number(b.price), duration=Number(b.duration||60);
    if(title.length<2 || !Number.isFinite(price) || price<0) return send(400,{error:"Укажите название и корректную цену."});
    const service={id:id("svc"),userId:user.id,title,description:String(b.description||"").trim().slice(0,300),price,duration,active:true};
    db.services.push(service); saveDb(); return send(201,{service});
  });

  if(req.method==="DELETE" && url.pathname.startsWith("/api/services/")){
    const sid=url.pathname.split("/").pop(), s=db.services.find(x=>x.id===sid&&x.userId===user.id);
    if(!s) return send(404,{error:"Услуга не найдена."});
    s.active=false; saveDb(); return send(200,{ok:true});
  }

  if(req.method==="POST" && url.pathname==="/api/slots") return readBody(req).then(b=>{
    if(user.role!=="specialist") return send(403,{error:"Только специалист может добавлять время."});
    const service=db.services.find(s=>s.id===b.serviceId&&s.userId===user.id&&s.active);
    const date=String(b.date||""), time=String(b.time||"");
    if(!service || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return send(400,{error:"Проверьте услугу, дату и время."});
    if(db.slots.some(s=>s.userId===user.id&&s.date===date&&s.time===time&&!s.booked)) return send(409,{error:"Такое время уже добавлено."});
    const slot={id:id("slot"),userId:user.id,serviceId:service.id,date,time,booked:false};
    db.slots.push(slot); saveDb(); return send(201,{slot});
  });

  if(req.method==="DELETE" && url.pathname.startsWith("/api/slots/")){
    const sid=url.pathname.split("/").pop(), s=db.slots.find(x=>x.id===sid&&x.userId===user.id);
    if(!s) return send(404,{error:"Слот не найден."});
    if(s.booked) return send(409,{error:"Нельзя удалить уже забронированный слот."});
    db.slots=db.slots.filter(x=>x.id!==sid); saveDb(); return send(200,{ok:true});
  }

  if(req.method==="POST" && url.pathname==="/api/bookings") return readBody(req).then(b=>{
    const slot=db.slots.find(s=>s.id===b.slotId&&!s.booked);
    if(!slot) return send(409,{error:"Это время уже занято или больше недоступно."});
    const specialist=db.users.find(u=>u.id===slot.userId);
    const service=db.services.find(s=>s.id===slot.serviceId);
    if(!specialist||!service) return send(404,{error:"Услуга не найдена."});
    const clientName=String(b.clientName||user.name||"").trim();
    const contact=String(b.contact||user.email||"").trim();
    if(clientName.length<2||contact.length<3) return send(400,{error:"Укажите имя и контакт."});
    slot.booked=true;
    const booking={id:id("book"),slotId:slot.id,specialistId:specialist.id,clientId:user.id,serviceId:service.id,clientName,contact,date:slot.date,time:slot.time,status:"confirmed",createdAt:Date.now()};
    db.bookings.push(booking); saveDb();
    return send(201,{booking,service,specialist:safeUser(specialist)});
  });

  return send(404,{error:"API route not found"});
}

const mime = {".html":"text/html; charset=utf-8",".css":"text/css; charset=utf-8",".js":"text/javascript; charset=utf-8",".json":"application/json; charset=utf-8",".svg":"image/svg+xml"};
function serveStatic(req,res){
  let pathname=decodeURIComponent(new URL(req.url,"http://localhost").pathname);
  if(pathname==="/") pathname="/index.html";
  const file=path.join(PUBLIC,pathname);
  if(!file.startsWith(PUBLIC) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return json(res,404,{error:"Not found"});
  res.writeHead(200,{"Content-Type":mime[path.extname(file)]||"application/octet-stream"});
  fs.createReadStream(file).pipe(res);
}

const server=http.createServer(async (req,res)=>{
  const url=new URL(req.url,`http://${req.headers.host||"localhost"}`);
  if(url.pathname.startsWith("/api/")){
    try { await routeApi(req,res,url); } catch(e) { console.error(e); json(res,500,{error:"Ошибка сервера."}); }
  } else serveStatic(req,res);
});
server.listen(PORT,"0.0.0.0",()=>console.log(`TimeSlot running on port ${PORT}`));
