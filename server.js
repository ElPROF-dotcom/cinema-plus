require("dotenv").config();
const express = require("express");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const Database = require("better-sqlite3");
const path = require("path");
const fs = require("fs");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET || JWT_SECRET.length < 32) {
  console.error("Set JWT_SECRET to a random secret of at least 32 characters in .env");
  process.exit(1);
}

const dataDir = path.join(__dirname, "data");
fs.mkdirSync(dataDir, { recursive: true });
const db = new Database(path.join(dataDir, "cinema.sqlite"));
db.pragma("journal_mode = WAL");
db.exec(`
CREATE TABLE IF NOT EXISTS users (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 name TEXT NOT NULL,
 email TEXT NOT NULL UNIQUE,
 password_hash TEXT NOT NULL,
 role TEXT NOT NULL DEFAULT 'user',
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS titles (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 title TEXT NOT NULL,
 original_title TEXT DEFAULT '',
 kind TEXT NOT NULL CHECK(kind IN ('movie','series')),
 category TEXT NOT NULL DEFAULT 'أخرى',
 country TEXT NOT NULL DEFAULT '',
 year INTEGER,
 description TEXT NOT NULL DEFAULT '',
 poster TEXT DEFAULT '',
 backdrop TEXT DEFAULT '',
 rating REAL DEFAULT 0,
 featured INTEGER NOT NULL DEFAULT 0,
 status TEXT NOT NULL DEFAULT 'published',
 watch_url TEXT DEFAULT '',
 download_url TEXT DEFAULT '',
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS favorites (
 user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 title_id INTEGER NOT NULL REFERENCES titles(id) ON DELETE CASCADE,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(user_id, title_id)
);
CREATE TABLE IF NOT EXISTS watch_history (
 user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 title_id INTEGER NOT NULL REFERENCES titles(id) ON DELETE CASCADE,
 watched_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(user_id, title_id)
);
`);

const count = db.prepare("SELECT COUNT(*) n FROM titles").get().n;
if (!count) {
  const seed = db.prepare(`INSERT INTO titles
  (title, original_title, kind, category, country, year, description, poster, backdrop, rating, featured, watch_url, download_url)
  VALUES (@title,@original_title,@kind,@category,@country,@year,@description,@poster,@backdrop,@rating,@featured,@watch_url,@download_url)`);
  const samples = [
    {title:"ليلة في القاهرة",original_title:"A Night in Cairo",kind:"movie",category:"دراما",country:"مصر",year:2024,description:"مثال تجريبي لبطاقة فيلم. استبدل بياناته بمحتوى تملك حقوق عرضه أو روابط مرخصة.",poster:"https://images.unsplash.com/photo-1489599849927-2ee91 empezó",backdrop:"",rating:8.1,featured:1,watch_url:"",download_url:""},
    {title:"رحلة إلى المجهول",original_title:"Journey Unknown",kind:"movie",category:"مغامرة",country:"الولايات المتحدة",year:2023,description:"محتوى تجريبي لتوضيح شكل صفحة تفاصيل الفيلم.",poster:"https://images.unsplash.com/photo-1440404653325-ab127d49abc1",backdrop:"",rating:7.7,featured:1,watch_url:"",download_url:""},
    {title:"حكايات المدينة",original_title:"City Stories",kind:"series",category:"اجتماعي",country:"مصر",year:2025,description:"مسلسل تجريبي. أضف مواسم وحلقات أو روابط قانونية من لوحة التحكم لاحقًا.",poster:"https://images.unsplash.com/photo-1517604931442-7e0c8ed2963c",backdrop:"",rating:8.4,featured:1,watch_url:"",download_url:""},
    {title:"الملف الأخير",original_title:"The Final File",kind:"series",category:"غموض",country:"المملكة المتحدة",year:2022,description:"بيانات عرض توضيحية فقط وليست رابط مشاهدة.",poster:"https://images.unsplash.com/photo-1500530855697-b586d89ba3ee",backdrop:"",rating:7.9,featured:0,watch_url:"",download_url:""}
  ];
  for (const s of samples) {
    // Avoid malformed seed image URL; use a stable generic poster.
    if (s.poster.includes("بدأ")) s.poster = "https://images.unsplash.com/photo-1489599849927-2ee91c9b7c2d";
    seed.run(s);
  }
}

const adminEmail = process.env.ADMIN_EMAIL;
const adminPassword = process.env.ADMIN_PASSWORD;
if (adminEmail && adminPassword) {
  const existing = db.prepare("SELECT id FROM users WHERE email=?").get(adminEmail.toLowerCase());
  if (!existing) {
    const hash = bcrypt.hashSync(adminPassword, 12);
    db.prepare("INSERT INTO users(name,email,password_hash,role) VALUES(?,?,?,'admin')")
      .run("مدير الموقع", adminEmail.toLowerCase(), hash);
    console.log("Admin account created:", adminEmail);
  }
}

app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false });

function tokenFor(user) {
  return jwt.sign({ id: user.id, role: user.role, name: user.name }, JWT_SECRET, { expiresIn: "7d" });
}
function auth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: "سجّل الدخول أولاً." });
  }
}
function admin(req, res, next) {
  if (req.user?.role !== "admin") return res.status(403).json({ error: "هذه الخاصية للمدير فقط." });
  next();
}
function validHttpUrl(value) {
  if (!value) return true;
  try { const u = new URL(value); return u.protocol === "https:" || u.protocol === "http:"; }
  catch { return false; }
}
function cleanTitle(body) {
  const fields = ["title","original_title","kind","category","country","description","poster","backdrop","watch_url","download_url"];
  const out = {};
  for (const f of fields) out[f] = String(body[f] ?? "").trim();
  out.year = Number(body.year) || null;
  out.rating = Math.max(0, Math.min(10, Number(body.rating) || 0));
  out.featured = body.featured ? 1 : 0;
  if (!out.title || !["movie","series"].includes(out.kind)) throw new Error("العنوان ونوع المحتوى مطلوبان.");
  for (const f of ["poster","backdrop","watch_url","download_url"]) if (!validHttpUrl(out[f])) throw new Error("يجب أن يبدأ الرابط بـ http أو https.");
  return out;
}

app.post("/api/auth/register", authLimiter, (req,res) => {
  const {name,email,password} = req.body || {};
  if (!name || String(name).trim().length < 2 || !email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !password || String(password).length < 8)
    return res.status(400).json({error:"أدخل اسمًا وبريدًا صحيحًا وكلمة مرور من 8 أحرف على الأقل."});
  try {
    const info = db.prepare("INSERT INTO users(name,email,password_hash) VALUES(?,?,?)")
      .run(String(name).trim(), String(email).toLowerCase(), bcrypt.hashSync(String(password), 12));
    const user = db.prepare("SELECT id,name,email,role FROM users WHERE id=?").get(info.lastInsertRowid);
    res.json({token:tokenFor(user),user});
  } catch { res.status(409).json({error:"هذا البريد مسجل بالفعل."}); }
});
app.post("/api/auth/login", authLimiter, (req,res) => {
  const {email,password} = req.body || {};
  const user = db.prepare("SELECT * FROM users WHERE email=?").get(String(email || "").toLowerCase());
  if (!user || !bcrypt.compareSync(String(password || ""), user.password_hash))
    return res.status(401).json({error:"البريد الإلكتروني أو كلمة المرور غير صحيحة."});
  res.json({token:tokenFor(user),user:{id:user.id,name:user.name,email:user.email,role:user.role}});
});
app.get("/api/me", auth, (req,res) => {
  const user = db.prepare("SELECT id,name,email,role FROM users WHERE id=?").get(req.user.id);
  res.json({user});
});

app.get("/api/titles", (req,res) => {
  const {q="",kind="",category="",sort="new"} = req.query;
  let sql = "SELECT id,title,original_title,kind,category,country,year,description,poster,backdrop,rating,featured,watch_url,download_url FROM titles WHERE status='published'";
  const args = [];
  if (q) { sql += " AND (title LIKE ? OR original_title LIKE ? OR description LIKE ?)"; args.push(`%${q}%`,`%${q}%`,`%${q}%`); }
  if (kind && ["movie","series"].includes(kind)) { sql += " AND kind=?"; args.push(kind); }
  if (category) { sql += " AND category=?"; args.push(category); }
  sql += sort === "rating" ? " ORDER BY rating DESC, created_at DESC" : sort === "old" ? " ORDER BY year ASC" : " ORDER BY featured DESC, created_at DESC";
  res.json({titles:db.prepare(sql).all(...args)});
});
app.get("/api/titles/:id", (req,res) => {
  const title = db.prepare("SELECT * FROM titles WHERE id=? AND status='published'").get(req.params.id);
  if (!title) return res.status(404).json({error:"المحتوى غير موجود."});
  res.json({title});
});
app.get("/api/categories", (req,res) => res.json({categories:db.prepare("SELECT DISTINCT category FROM titles WHERE status='published' ORDER BY category").all().map(x=>x.category)}));

app.get("/api/favorites", auth, (req,res) => {
  res.json({titles:db.prepare(`SELECT t.* FROM titles t JOIN favorites f ON f.title_id=t.id WHERE f.user_id=? ORDER BY f.created_at DESC`).all(req.user.id)});
});
app.post("/api/favorites/:id", auth, (req,res) => {
  const exists = db.prepare("SELECT 1 FROM favorites WHERE user_id=? AND title_id=?").get(req.user.id,req.params.id);
  if (exists) db.prepare("DELETE FROM favorites WHERE user_id=? AND title_id=?").run(req.user.id,req.params.id);
  else db.prepare("INSERT OR IGNORE INTO favorites(user_id,title_id) VALUES(?,?)").run(req.user.id,req.params.id);
  res.json({favorite:!exists});
});
app.post("/api/history/:id", auth, (req,res) => {
  db.prepare(`INSERT INTO watch_history(user_id,title_id,watched_at) VALUES(?,?,CURRENT_TIMESTAMP)
  ON CONFLICT(user_id,title_id) DO UPDATE SET watched_at=CURRENT_TIMESTAMP`).run(req.user.id,req.params.id);
  res.json({ok:true});
});
app.get("/api/history", auth, (req,res) => {
  res.json({titles:db.prepare(`SELECT t.*,h.watched_at FROM titles t JOIN watch_history h ON h.title_id=t.id WHERE h.user_id=? ORDER BY h.watched_at DESC`).all(req.user.id)});
});

app.get("/api/admin/titles", auth, admin, (req,res) => res.json({titles:db.prepare("SELECT * FROM titles ORDER BY created_at DESC").all()}));
app.post("/api/admin/titles", auth, admin, (req,res) => {
  try {
    const t = cleanTitle(req.body);
    const info = db.prepare(`INSERT INTO titles(title,original_title,kind,category,country,year,description,poster,backdrop,rating,featured,watch_url,download_url)
      VALUES(@title,@original_title,@kind,@category,@country,@year,@description,@poster,@backdrop,@rating,@featured,@watch_url,@download_url)`).run(t);
    res.status(201).json({id:info.lastInsertRowid});
  } catch(e) { res.status(400).json({error:e.message}); }
});
app.put("/api/admin/titles/:id", auth, admin, (req,res) => {
  try {
    const t = cleanTitle(req.body);
    db.prepare(`UPDATE titles SET title=@title,original_title=@original_title,kind=@kind,category=@category,country=@country,year=@year,description=@description,poster=@poster,backdrop=@backdrop,rating=@rating,featured=@featured,watch_url=@watch_url,download_url=@download_url WHERE id=@id`).run({...t,id:req.params.id});
    res.json({ok:true});
  } catch(e) { res.status(400).json({error:e.message}); }
});
app.delete("/api/admin/titles/:id", auth, admin, (req,res) => {
  db.prepare("DELETE FROM titles WHERE id=?").run(req.params.id);
  res.json({ok:true});
});

app.get("*", (req,res) => res.sendFile(path.join(__dirname,"public","index.html")));
app.listen(PORT, () => console.log(`CINEMA PLUS running at http://localhost:${PORT}`));
