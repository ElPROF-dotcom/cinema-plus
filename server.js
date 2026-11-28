
require("dotenv").config();

const express = require("express");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { Pool } = require("pg");
const path = require("path");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const JWT_SECRET = process.env.JWT_SECRET;
const DATABASE_URL = process.env.DATABASE_URL;

if (!JWT_SECRET || JWT_SECRET.length < 32) {
  console.error("Set JWT_SECRET to a random secret of at least 32 characters in .env");
  process.exit(1);
}

if (!DATABASE_URL) {
  console.error("Set DATABASE_URL to your Neon PostgreSQL connection string in .env");
  process.exit(1);
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000
});

pool.on("error", (err) => {
  console.error("Unexpected PostgreSQL pool error:", err.message);
});

async function initializeDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id BIGSERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS titles (
      id BIGSERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      original_title TEXT DEFAULT '',
      kind TEXT NOT NULL CHECK (kind IN ('movie', 'series')),
      category TEXT NOT NULL DEFAULT 'أخرى',
      country TEXT NOT NULL DEFAULT '',
      year INTEGER,
      description TEXT NOT NULL DEFAULT '',
      poster TEXT DEFAULT '',
      backdrop TEXT DEFAULT '',
      rating DOUBLE PRECISION DEFAULT 0,
      featured BOOLEAN NOT NULL DEFAULT FALSE,
      status TEXT NOT NULL DEFAULT 'published',
      watch_url TEXT DEFAULT '',
      download_url TEXT DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS favorites (
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title_id BIGINT NOT NULL REFERENCES titles(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, title_id)
    );

    CREATE TABLE IF NOT EXISTS watch_history (
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title_id BIGINT NOT NULL REFERENCES titles(id) ON DELETE CASCADE,
      watched_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, title_id)
    );

    CREATE INDEX IF NOT EXISTS idx_titles_status_created
      ON titles(status, created_at DESC);

    CREATE INDEX IF NOT EXISTS idx_titles_kind
      ON titles(kind);

    CREATE INDEX IF NOT EXISTS idx_favorites_user_created
      ON favorites(user_id, created_at DESC);

    CREATE INDEX IF NOT EXISTS idx_history_user_watched
      ON watch_history(user_id, watched_at DESC);
  `);

  const { rows } = await pool.query(
    "SELECT COUNT(*)::int AS count FROM titles"
  );

  if (rows[0].count === 0) {
    const samples = [
      {
        title: "ليلة في القاهرة",
        original_title: "A Night in Cairo",
        kind: "movie",
        category: "دراما",
        country: "مصر",
        year: 2024,
        description: "مثال تجريبي لبطاقة فيلم.",
        poster: "https://images.unsplash.com/photo-1489599849927-2ee91c9b7c2d",
        backdrop: "",
        rating: 8.1,
        featured: true,
        watch_url: "",
        download_url: ""
      },
      {
        title: "رحلة إلى المجهول",
        original_title: "Journey Unknown",
        kind: "movie",
        category: "مغامرة",
        country: "الولايات المتحدة",
        year: 2023,
        description: "محتوى تجريبي لتوضيح شكل صفحة تفاصيل الفيلم.",
        poster: "https://images.unsplash.com/photo-1440404653325-ab127d49abc1",
        backdrop: "",
        rating: 7.7,
        featured: true,
        watch_url: "",
        download_url: ""
      },
      {
        title: "حكايات المدينة",
        original_title: "City Stories",
        kind: "series",
        category: "اجتماعي",
        country: "مصر",
        year: 2025,
        description: "مسلسل تجريبي.",
        poster: "https://images.unsplash.com/photo-1517604931442-7e0c8ed2963c",
        backdrop: "",
        rating: 8.4,
        featured: true,
        watch_url: "",
        download_url: ""
      },
      {
        title: "الملف الأخير",
        original_title: "The Final File",
        kind: "series",
        category: "غموض",
        country: "المملكة المتحدة",
        year: 2022,
        description: "بيانات عرض توضيحية فقط.",
        poster: "https://images.unsplash.com/photo-1500530855697-b586d89ba3ee",
        backdrop: "",
        rating: 7.9,
        featured: false,
        watch_url: "",
        download_url: ""
      }
    ];

    for (const item of samples) {
      await pool.query(
        `INSERT INTO titles
        (title, original_title, kind, category, country, year,
        description, poster, backdrop, rating, featured,
        watch_url, download_url)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [
          item.title,
          item.original_title,
          item.kind,
          item.category,
          item.country,
          item.year,
          item.description,
          item.poster,
          item.backdrop,
          item.rating,
          item.featured,
          item.watch_url,
          item.download_url
        ]
      );
    }
  }

  const adminEmail = String(process.env.ADMIN_EMAIL || "")
    .trim()
    .toLowerCase();

  const adminPassword = process.env.ADMIN_PASSWORD;

  if (adminEmail && adminPassword) {
    const existing = await pool.query(
      "SELECT id FROM users WHERE email = $1",
      [adminEmail]
    );

    if (existing.rowCount === 0) {
      const hash = await bcrypt.hash(adminPassword, 12);

      await pool.query(
        `INSERT INTO users
        (name, email, password_hash, role)
        VALUES ($1, $2, $3, 'admin')`,
        ["مدير الموقع", adminEmail, hash]
      );

      console.log("Admin account created:", adminEmail);
    }
  }
}

app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false
});

function tokenFor(user) {
  return jwt.sign(
    {
      id: user.id,
      role: user.role,
      name: user.name
    },
    JWT_SECRET,
    { expiresIn: "7d" }
  );
}

function auth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ")
    ? header.slice(7)
    : "";

  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({
      error: "سجّل الدخول أولاً."
    });
  }
}

function admin(req, res, next) {
  if (req.user?.role !== "admin") {
    return res.status(403).json({
      error: "هذه الخاصية للمدير فقط."
    });
  }

  next();
}

function validHttpUrl(value) {
  if (!value) return true;

  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function cleanTitle(body = {}) {
  const fields = [
    "title",
    "original_title",
    "kind",
    "category",
    "country",
    "description",
    "poster",
    "backdrop",
    "watch_url",
    "download_url"
  ];

  const out = {};

  for (const field of fields) {
    out[field] = String(body[field] ?? "").trim();
  }

  out.year = Number(body.year) || null;
  out.rating = Math.max(0, Math.min(10, Number(body.rating) || 0));
  out.featured = Boolean(body.featured);

  if (!out.title || !["movie", "series"].includes(out.kind)) {
    throw new Error("العنوان ونوع المحتوى مطلوبان.");
  }

  for (const field of [
    "poster",
    "backdrop",
    "watch_url",
    "download_url"
  ]) {
    if (!validHttpUrl(out[field])) {
      throw new Error("يجب أن يبدأ الرابط بـ http أو https.");
    }
  }

  return out;
}

function asyncRoute(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

// تسجيل حساب جديد
app.post("/api/auth/register", authLimiter, asyncRoute(async (req, res) => {
  const { name, email, password } = req.body || {};

  const cleanEmail = String(email || "").trim().toLowerCase();

  if (
    !name ||
    String(name).trim().length < 2 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail) ||
    !password ||
    String(password).length < 8
  ) {
    return res.status(400).json({
      error: "أدخل اسمًا وبريدًا صحيحًا وكلمة مرور من 8 أحرف على الأقل."
    });
  }

  try {
    const hash = await bcrypt.hash(String(password), 12);

    const result = await pool.query(
      `INSERT INTO users(name, email, password_hash)
       VALUES($1, $2, $3)
       RETURNING id, name, email, role`,
      [String(name).trim(), cleanEmail, hash]
    );

    const user = result.rows[0];

    res.json({
      token: tokenFor(user),
      user
    });

  } catch (error) {
    if (error.code === "23505") {
      return res.status(409).json({
        error: "هذا البريد مسجل بالفعل."
      });
    }

    throw error;
  }
}));

// تسجيل الدخول
app.post("/api/auth/login", authLimiter, asyncRoute(async (req, res) => {
  const { email, password } = req.body || {};

  const result = await pool.query(
    "SELECT * FROM users WHERE email = $1",
    [String(email || "").trim().toLowerCase()]
  );

  const user = result.rows[0];

  if (!user || !(await bcrypt.compare(
    String(password || ""),
    user.password_hash
  ))) {
    return res.status(401).json({
      error: "البريد الإلكتروني أو كلمة المرور غير صحيحة."
    });
  }

  res.json({
    token: tokenFor(user),
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role
    }
  });
}));

// بيانات المستخدم الحالي
app.get("/api/me", auth, asyncRoute(async (req, res) => {
  const result = await pool.query(
    "SELECT id, name, email, role FROM users WHERE id = $1",
    [req.user.id]
  );

  if (!result.rows[0]) {
    return res.status(404).json({
      error: "المستخدم غير موجود."
    });
  }

  res.json({ user: result.rows[0] });
}));

// عرض الأفلام والمسلسلات
app.get("/api/titles", asyncRoute(async (req, res) => {
  const {
    q = "",
    kind = "",
    category = "",
    sort = "new"
  } = req.query;

  const conditions = ["status = 'published'"];
  const values = [];

  if (q) {
    values.push(`%${String(q)}%`);
    const n = values.length;

    conditions.push(
      `(title ILIKE $${n} OR original_title ILIKE $${n} OR description ILIKE $${n})`
    );
  }

  if (kind && ["movie", "series"].includes(kind)) {
    values.push(kind);
    conditions.push(`kind = $${values.length}`);
  }

  if (category) {
    values.push(String(category));
    conditions.push(`category = $${values.length}`);
  }

  let orderBy = "featured DESC, created_at DESC";

  if (sort === "rating") {
    orderBy = "rating DESC, created_at DESC";
  } else if (sort === "old") {
    orderBy = "year ASC NULLS LAST, created_at ASC";
  }

  const result = await pool.query(
    `SELECT id, title, original_title, kind, category,
      country, year, description, poster, backdrop,
      rating, featured, watch_url, download_url
     FROM titles
     WHERE ${conditions.join(" AND ")}
     ORDER BY ${orderBy}`,
    values
  );

  res.json({ titles: result.rows });
}));

// تفاصيل فيلم أو مسلسل
app.get("/api/titles/:id", asyncRoute(async (req, res) => {
  const result = await pool.query(
    "SELECT * FROM titles WHERE id = $1 AND status = 'published'",
    [req.params.id]
  );

  if (!result.rows[0]) {
    return res.status(404).json({
      error: "المحتوى غير موجود."
    });
  }

  res.json({ title: result.rows[0] });
}));

// التصنيفات
app.get("/api/categories", asyncRoute(async (req, res) => {
  const result = await pool.query(
    `SELECT DISTINCT category
     FROM titles
     WHERE status = 'published'
     ORDER BY category`
  );

  res.json({
    categories: result.rows.map(row => row.category)
  });
}));

// عرض المفضلة
app.get("/api/favorites", auth, asyncRoute(async (req, res) => {
  const result = await pool.query(
    `SELECT t.*
     FROM titles t
     JOIN favorites f ON f.title_id = t.id
     WHERE f.user_id = $1
     ORDER BY f.created_at DESC`,
    [req.user.id]
  );

  res.json({ titles: result.rows });
}));

// إضافة أو إزالة المفضلة
app.post("/api/favorites/:id", auth, asyncRoute(async (req, res) => {
  const existing = await pool.query(
    `SELECT 1 FROM favorites
     WHERE user_id = $1 AND title_id = $2`,
    [req.user.id, req.params.id]
  );

  if (existing.rowCount) {
    await pool.query(
      `DELETE FROM favorites
       WHERE user_id = $1 AND title_id = $2`,
      [req.user.id, req.params.id]
    );

    return res.json({ favorite: false });
  }

  const inserted = await pool.query(
    `INSERT INTO favorites(user_id, title_id)
     SELECT $1, id FROM titles WHERE id = $2
     ON CONFLICT(user_id, title_id) DO NOTHING
     RETURNING title_id`,
    [req.user.id, req.params.id]
  );

  if (!inserted.rowCount) {
    const titleExists = await pool.query(
      "SELECT 1 FROM titles WHERE id = $1",
      [req.params.id]
    );

    if (!titleExists.rowCount) {
      return res.status(404).json({
        error: "المحتوى غير موجود."
      });
    }
  }

  res.json({ favorite: true });
}));

// تسجيل المشاهدة
app.post("/api/history/:id", auth, asyncRoute(async (req, res) => {
  const result = await pool.query(
    `INSERT INTO watch_history(user_id, title_id, watched_at)
     SELECT $1, id, CURRENT_TIMESTAMP
     FROM titles
     WHERE id = $2
     ON CONFLICT(user_id, title_id)
     DO UPDATE SET watched_at = CURRENT_TIMESTAMP
     RETURNING title_id`,
    [req.user.id, req.params.id]
  );

  if (!result.rowCount) {
    return res.status(404).json({
      error: "المحتوى غير موجود."
    });
  }

  res.json({ ok: true });
}));

// سجل المشاهدة
app.get("/api/history", auth, asyncRoute(async (req, res) => {
  const result = await pool.query(
    `SELECT t.*, h.watched_at
     FROM titles t
     JOIN watch_history h ON h.title_id = t.id
     WHERE h.user_id = $1
     ORDER BY h.watched_at DESC`,
    [req.user.id]
  );

  res.json({ titles: result.rows });
}));

// لوحة المدير: عرض المحتوى
app.get("/api/admin/titles", auth, admin, asyncRoute(async (req, res) => {
  const result = await pool.query(
    "SELECT * FROM titles ORDER BY created_at DESC"
  );

  res.json({ titles: result.rows });
}));

// لوحة المدير: إضافة فيلم أو مسلسل
app.post("/api/admin/titles", auth, admin, asyncRoute(async (req, res) => {
  const t = cleanTitle(req.body);

  const result = await pool.query(
    `INSERT INTO titles
    (title, original_title, kind, category, country, year,
     description, poster, backdrop, rating, featured,
     watch_url, download_url)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     RETURNING id`,
    [
      t.title,
      t.original_title,
      t.kind,
      t.category,
      t.country,
      t.year,
      t.description,
      t.poster,
      t.backdrop,
      t.rating,
      t.featured,
      t.watch_url,
      t.download_url
    ]
  );

  res.status(201).json({
    id: result.rows[0].id
  });
}));

// لوحة المدير: تعديل المحتوى
app.put("/api/admin/titles/:id", auth, admin, asyncRoute(async (req, res) => {
  const t = cleanTitle(req.body);

  const result = await pool.query(
    `UPDATE titles SET
      title=$1,
      original_title=$2,
      kind=$3,
      category=$4,
      country=$5,
      year=$6,
      description=$7,
      poster=$8,
      backdrop=$9,
      rating=$10,
      featured=$11,
      watch_url=$12,
      download_url=$13
     WHERE id=$14
     RETURNING id`,
    [
      t.title,
      t.original_title,
      t.kind,
      t.category,
      t.country,
      t.year,
      t.description,
      t.poster,
      t.backdrop,
      t.rating,
      t.featured,
      t.watch_url,
      t.download_url,
      req.params.id
    ]
  );

  if (!result.rowCount) {
    return res.status(404).json({
      error: "المحتوى غير موجود."
    });
  }

  res.json({ ok: true });
}));

// لوحة المدير: حذف المحتوى
app.delete("/api/admin/titles/:id", auth, admin, asyncRoute(async (req, res) => {
  const result = await pool.query(
    "DELETE FROM titles WHERE id = $1 RETURNING id",
    [req.params.id]
  );

  if (!result.rowCount) {
    return res.status(404).json({
      error: "المحتوى غير موجود."
    });
  }

  res.json({ ok: true });
}));

// الصفحة الرئيسية
app.get("*", (req, res) => {
  res.sendFile(
    path.join(__dirname, "public", "index.html")
  );
});

// معالجة الأخطاء
app.use((err, req, res, next) => {
  console.error("Request error:", err);

  if (res.headersSent) {
    return next(err);
  }

  res.status(500).json({
    error: "حدث خطأ في الخادم. حاول مرة أخرى."
  });
});

// تشغيل السيرفر
async function start() {
  try {
    await pool.query("SELECT 1");

    await initializeDatabase();

    app.listen(PORT, () => {
      console.log(`CINEMA PLUS running on port ${PORT}`);
    });

  } catch (error) {
    console.error(
      "Could not connect to PostgreSQL or initialize database:",
      error.message
    );

    process.exit(1);
  }
}

start();
