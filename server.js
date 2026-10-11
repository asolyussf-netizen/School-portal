require("dotenv").config();
const express = require("express");
const session = require("express-session");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const bcrypt = require("bcryptjs");
const Database = require("better-sqlite3");
const path = require("path");
const fs = require("fs");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const dataDir = path.join(__dirname, "data");
fs.mkdirSync(dataDir, { recursive: true });
const db = new Database(path.join(dataDir, "school.db"));
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS users (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 name TEXT NOT NULL,
 username TEXT NOT NULL UNIQUE,
 password_hash TEXT NOT NULL,
 role TEXT NOT NULL CHECK(role IN ('director','technician','teacher','family')),
 subject TEXT DEFAULT '',
 phone TEXT DEFAULT '',
 whatsapp TEXT DEFAULT '',
 email TEXT DEFAULT '',
 active INTEGER NOT NULL DEFAULT 1,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS announcements (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 title TEXT NOT NULL,
 body TEXT NOT NULL,
 created_by INTEGER NOT NULL REFERENCES users(id),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS messages (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 sender_id INTEGER NOT NULL REFERENCES users(id),
 recipient_id INTEGER NOT NULL REFERENCES users(id),
 body TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 read_at TEXT
);
CREATE TABLE IF NOT EXISTS school_settings (
 key TEXT PRIMARY KEY,
 value TEXT NOT NULL
);
`);

const setting = db.prepare("INSERT OR IGNORE INTO school_settings(key,value) VALUES(?,?)");
setting.run("school_name", process.env.SCHOOL_NAME || "مدرستي");
setting.run("director_name", process.env.DIRECTOR_NAME || "مدير المدرسة");
setting.run("school_description", "موقع المدرسة الرسمي للتواصل مع الإدارة والكادر التدريسي.");

const existingDirector = db.prepare("SELECT id FROM users WHERE role='director' LIMIT 1").get();
if (!existingDirector) {
  const username = (process.env.DIRECTOR_EMAIL || "director@example.com").trim().toLowerCase();
  const password = process.env.DIRECTOR_PASSWORD || "ChangeThisPassword123!";
  db.prepare("INSERT INTO users(name,username,password_hash,role,email) VALUES(?,?,?,?,?)")
    .run(process.env.DIRECTOR_NAME || "مدير المدرسة", username, bcrypt.hashSync(password, 12), "director", username);
}

app.disable("x-powered-by");
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: "30kb" }));
app.use(express.urlencoded({ extended: false, limit: "30kb" }));
app.use(session({
  name: "school.sid",
  secret: process.env.SESSION_SECRET || "development-only-change-this-secret-before-deploying",
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 1000 * 60 * 60 * 8
  }
}));
app.use(express.static(path.join(__dirname, "public")));

const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false });
const safeUser = u => u && ({ id:u.id, name:u.name, username:u.username, role:u.role, subject:u.subject, phone:u.phone, whatsapp:u.whatsapp, email:u.email, active:!!u.active });
function auth(req,res,next) {
  if (!req.session.userId) return res.status(401).json({ error:"يرجى تسجيل الدخول أولاً." });
  const user = db.prepare("SELECT * FROM users WHERE id=? AND active=1").get(req.session.userId);
  if (!user) { req.session.destroy(()=>{}); return res.status(401).json({error:"انتهت الجلسة أو أن الحساب معطل."}); }
  req.user = user; next();
}
function roles(...allowed) {
  return (req,res,next) => {
    if (!req.user || !allowed.includes(req.user.role)) return res.status(403).json({error:"ليست لديك صلاحية لتنفيذ هذا الإجراء."});
    next();
  };
}
function cleanText(value, max=500) {
  return String(value ?? "").trim().slice(0,max);
}
function personPayload(body) {
  return {
    name: cleanText(body.name,100),
    username: cleanText(body.username,120).toLowerCase(),
    role: cleanText(body.role,20),
    subject: cleanText(body.subject,100),
    phone: cleanText(body.phone,30),
    whatsapp: cleanText(body.whatsapp,40).replace(/[^\d+]/g,""),
    email: cleanText(body.email,120),
    password: String(body.password || "")
  };
}

app.get("/api/me", (req,res) => {
  if (!req.session.userId) return res.json({user:null});
  const u = db.prepare("SELECT * FROM users WHERE id=? AND active=1").get(req.session.userId);
  res.json({user:safeUser(u)});
});
app.post("/api/login", loginLimiter, (req,res) => {
  const username = cleanText(req.body.username,120).toLowerCase();
  const password = String(req.body.password || "");
  const u = db.prepare("SELECT * FROM users WHERE username=? AND active=1").get(username);
  if (!u || !bcrypt.compareSync(password, u.password_hash)) return res.status(401).json({error:"اسم المستخدم أو كلمة المرور غير صحيحة."});
  req.session.regenerate(err => {
    if (err) return res.status(500).json({error:"تعذر بدء الجلسة."});
    req.session.userId = u.id;
    res.json({user:safeUser(u)});
  });
});
app.post("/api/logout", (req,res) => req.session.destroy(() => {
  res.clearCookie("school.sid"); res.json({ok:true});
}));

app.get("/api/public", (req,res) => {
  const settings = Object.fromEntries(db.prepare("SELECT key,value FROM school_settings").all().map(x=>[x.key,x.value]));
  const announcements = db.prepare("SELECT a.id,a.title,a.body,a.created_at,u.name AS author FROM announcements a JOIN users u ON u.id=a.created_by ORDER BY a.id DESC LIMIT 8").all();
  const staff = db.prepare("SELECT id,name,role,subject FROM users WHERE active=1 AND role IN ('director','teacher') ORDER BY CASE role WHEN 'director' THEN 0 ELSE 1 END, name").all();
  res.json({settings,announcements,staff});
});

app.get("/api/teachers", auth, roles("family","director","technician"), (req,res) => {
  const teachers = db.prepare("SELECT id,name,subject,phone,whatsapp,email FROM users WHERE role='teacher' AND active=1 ORDER BY name").all();
  res.json({teachers});
});

app.get("/api/people", auth, roles("director","technician"), (req,res) => {
  const people = db.prepare("SELECT id,name,username,role,subject,phone,whatsapp,email,active,created_at FROM users ORDER BY role,name").all();
  res.json({people});
});
app.post("/api/people", auth, roles("director","technician"), (req,res) => {
  const p = personPayload(req.body);
  if (!p.name || !p.username || !p.password) return res.status(400).json({error:"الاسم واسم المستخدم وكلمة المرور مطلوبة."});
  const allowedRoles = req.user.role === "director" ? ["technician","teacher","family"] : ["teacher","family"];
  if (!allowedRoles.includes(p.role)) return res.status(403).json({error:"لا يمكنك إنشاء حساب بهذا الدور."});
  if (p.password.length < 10) return res.status(400).json({error:"يجب أن تكون كلمة المرور 10 أحرف على الأقل."});
  try {
    const info = db.prepare(`INSERT INTO users(name,username,password_hash,role,subject,phone,whatsapp,email)
      VALUES(?,?,?,?,?,?,?,?)`).run(p.name,p.username,bcrypt.hashSync(p.password,12),p.role,p.subject,p.phone,p.whatsapp,p.email);
    res.json({ok:true,id:info.lastInsertRowid});
  } catch(e) {
    if (String(e.message).includes("UNIQUE")) return res.status(409).json({error:"اسم المستخدم مستخدم مسبقاً."});
    res.status(500).json({error:"تعذر إنشاء الحساب."});
  }
});
app.patch("/api/people/:id", auth, roles("director","technician"), (req,res) => {
  const id = Number(req.params.id);
  const target = db.prepare("SELECT * FROM users WHERE id=?").get(id);
  if (!target) return res.status(404).json({error:"الشخص غير موجود."});
  if (target.role === "director") return res.status(403).json({error:"لا يمكن تعديل حساب المدير من هذه الشاشة."});
  const p = personPayload(req.body);
  const allowedRoles = req.user.role === "director" ? ["technician","teacher","family"] : ["teacher","family"];
  if (p.role && !allowedRoles.includes(p.role)) return res.status(403).json({error:"لا يمكنك تعيين هذا الدور."});
  try {
    db.prepare(`UPDATE users SET name=?,username=?,role=?,subject=?,phone=?,whatsapp=?,email=?,active=? WHERE id=?`)
      .run(p.name || target.name, p.username || target.username, p.role || target.role, p.subject, p.phone, p.whatsapp, p.email, req.body.active === false ? 0 : 1, id);
    if (p.password) {
      if (p.password.length < 10) return res.status(400).json({error:"يجب أن تكون كلمة المرور 10 أحرف على الأقل."});
      db.prepare("UPDATE users SET password_hash=? WHERE id=?").run(bcrypt.hashSync(p.password,12),id);
    }
    res.json({ok:true});
  } catch(e) {
    if (String(e.message).includes("UNIQUE")) return res.status(409).json({error:"اسم المستخدم مستخدم مسبقاً."});
    res.status(500).json({error:"تعذر تعديل بيانات الشخص."});
  }
});

app.get("/api/messages", auth, roles("teacher","family","director"), (req,res) => {
  let rows;
  if (req.user.role === "teacher") {
    rows = db.prepare(`SELECT m.*,s.name AS sender_name,r.name AS recipient_name
      FROM messages m JOIN users s ON s.id=m.sender_id JOIN users r ON r.id=m.recipient_id
      WHERE m.sender_id=? OR m.recipient_id=? ORDER BY m.id DESC LIMIT 200`).all(req.user.id,req.user.id);
    db.prepare("UPDATE messages SET read_at=CURRENT_TIMESTAMP WHERE recipient_id=? AND read_at IS NULL").run(req.user.id);
  } else if (req.user.role === "family") {
    rows = db.prepare(`SELECT m.*,s.name AS sender_name,r.name AS recipient_name
      FROM messages m JOIN users s ON s.id=m.sender_id JOIN users r ON r.id=m.recipient_id
      WHERE m.sender_id=? OR m.recipient_id=? ORDER BY m.id DESC LIMIT 200`).all(req.user.id,req.user.id);
    db.prepare("UPDATE messages SET read_at=CURRENT_TIMESTAMP WHERE recipient_id=? AND read_at IS NULL").run(req.user.id);
  } else {
    rows = db.prepare(`SELECT m.*,s.name AS sender_name,r.name AS recipient_name
      FROM messages m JOIN users s ON s.id=m.sender_id JOIN users r ON r.id=m.recipient_id
      ORDER BY m.id DESC LIMIT 200`).all();
  }
  res.json({messages:rows});
});
app.post("/api/messages", auth, roles("teacher","family"), (req,res) => {
  const recipientId = Number(req.body.recipient_id);
  const body = cleanText(req.body.body,2000);
  if (!body) return res.status(400).json({error:"اكتب نص الرسالة أولاً."});
  const recipient = db.prepare("SELECT id,role,active FROM users WHERE id=?").get(recipientId);
  if (!recipient || !recipient.active) return res.status(404).json({error:"المستلم غير موجود."});
  if (req.user.role === "family" && recipient.role !== "teacher") return res.status(403).json({error:"يمكنك مراسلة المدرسين فقط."});
  if (req.user.role === "teacher" && !["family","teacher"].includes(recipient.role)) return res.status(403).json({error:"لا يمكن إرسال الرسالة لهذا الحساب."});
  const result = db.prepare("INSERT INTO messages(sender_id,recipient_id,body) VALUES(?,?,?)").run(req.user.id,recipientId,body);
  res.json({ok:true,id:result.lastInsertRowid});
});

app.get("/api/announcements", (req,res) => res.json({announcements:db.prepare("SELECT a.id,a.title,a.body,a.created_at,u.name AS author FROM announcements a JOIN users u ON u.id=a.created_by ORDER BY a.id DESC").all()}));
app.post("/api/announcements", auth, roles("director"), (req,res) => {
  const title=cleanText(req.body.title,160), body=cleanText(req.body.body,5000);
  if(!title||!body) return res.status(400).json({error:"العنوان والنص مطلوبان."});
  const result=db.prepare("INSERT INTO announcements(title,body,created_by) VALUES(?,?,?)").run(title,body,req.user.id);
  res.json({ok:true,id:result.lastInsertRowid});
});
app.delete("/api/announcements/:id", auth, roles("director"), (req,res) => {
  db.prepare("DELETE FROM announcements WHERE id=?").run(Number(req.params.id)); res.json({ok:true});
});
app.patch("/api/settings", auth, roles("director"), (req,res) => {
  const allowed = ["school_name","director_name","school_description"];
  const update = db.prepare("INSERT INTO school_settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value");
  for (const key of allowed) if (req.body[key] !== undefined) update.run(key,cleanText(req.body[key],300));
  res.json({ok:true});
});

app.get("*", (req,res) => res.sendFile(path.join(__dirname,"public","index.html")));
app.listen(PORT, () => console.log(`School portal running at http://localhost:${PORT}`));
