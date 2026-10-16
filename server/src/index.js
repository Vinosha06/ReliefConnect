import "dotenv/config";
import express from "express";
import cors from "cors";
import http from "http";
import { Server } from "socket.io";
import pg from "pg";

// DATABASE_URL නොමැති නම් Default Docker Postgres settings පාවිච්චි කරයි
const connectionString =
  process.env.DATABASE_URL ||
  "postgresql://postgres:postgres@localhost:5432/disaster_db";

const pool = new pg.Pool({ connectionString });

// Database Connection Test එකක්
pool
  .connect()
  .then(() => console.log("✅ Database connected successfully!"))
  .catch((err) =>
    console.error("❌ Database connection error:", err.message)
  );

const app = express();
app.use(cors({ origin: "*" }));
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

const wrap = (fn) => (req, res) =>
  fn(req, res).catch((e) => {
    console.error("API Error:", e);
    res.status(500).json({ error: e.message });
  });

const XY = "ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lng";

// Updated Expanded Item Types List for Validation
const VALID_ITEMS = [
  "food", 
  "water", 
  "medicine", 
  "boat", 
  "transport", 
  "shelter", 
  "clothes", 
  "power/generator", 
  "baby_products"
];

// Users - Authentication & Registration Route (Strict Password & Validation)
app.post(
  "/api/users",
  wrap(async (req, res) => {
    const { name, role, phone, password } = req.body;

    if (!name || !phone || !role || !password) {
      return res.status(400).json({ error: "Name, phone, role, and password are required" });
    }

    // Phone format validation (simple numeric check)
    if (!/^\d{9,12}$/.test(phone.trim())) {
      return res.status(400).json({ error: "අවලංගු දුරකථන අංකයකි (Invalid Phone Number)" });
    }

    const existing = await pool.query("SELECT * FROM users WHERE phone = $1", [phone]);

    if (existing.rows.length > 0) {
      const user = existing.rows[0];

      // If user exists in DB but doesn't have a password set yet, update it with current password
      if (!user.password) {
        await pool.query("UPDATE users SET password = $1 WHERE id = $2", [password, user.id]);
        return res.json({ ...user, password });
      }

      // Password match check
      if (user.password !== password) {
        return res.status(401).json({ error: "මුරපදය වැරදියි! (Invalid Password)" });
      }

      return res.json(user);
    } else {
      // Create new user with password
      const r = await pool.query(
        "INSERT INTO users(name, role, phone, password) VALUES($1, $2, $3, $4) RETURNING *",
        [name, role, phone, password]
      );
      return res.json(r.rows[0]);
    }
  })
);

// Needs List
app.get(
  "/api/needs",
  wrap(async (_req, res) => {
    const r = await pool.query(
      `SELECT id, user_id, item_type, quantity, urgency, status, created_at, ${XY}
       FROM needs WHERE status <> $1 ORDER BY urgency DESC, created_at NULLS LAST`,
      ["delivered"]
    );
    res.json(r.rows);
  })
);

// Create Need with Strict Input Validation
app.post(
  "/api/needs",
  wrap(async (req, res) => {
    const { user_id, item_type, quantity, urgency, lat, lng } = req.body;

    if (!user_id || !item_type || quantity === undefined || lat === undefined || lng === undefined) {
      return res.status(400).json({ error: "සියලුම තොරතුරු ඇතුළත් කරන්න (All fields are required)" });
    }

    if (!VALID_ITEMS.includes(item_type)) {
      return res.status(400).json({ error: "අවලංගු ද්‍රව්‍ය වර්ගයකි (Invalid Item Type)" });
    }

    const qtyNum = Number(quantity);
    if (isNaN(qtyNum) || qtyNum < 1) {
      return res.status(400).json({ error: "ප්‍රමාණය අවම වශයෙන් 1ක් විය යුතුය (Quantity must be at least 1)" });
    }

    const urgNum = Number(urgency || 1);
    if (![1, 2, 3].includes(urgNum)) {
      return res.status(400).json({ error: "අවලංගු තීව්‍රතා අගයකි (Invalid Urgency Level)" });
    }

    const latNum = Number(lat);
    const lngNum = Number(lng);
    if (isNaN(latNum) || isNaN(lngNum) || latNum < -90 || latNum > 90 || lngNum < -180 || lngNum > 180) {
      return res.status(400).json({ error: "අවලංගු ස්ථාන දත්තයකි (Invalid GPS Coordinates)" });
    }

    const r = await pool.query(
      `INSERT INTO needs(user_id, item_type, quantity, urgency, location)
       VALUES($1, $2, $3, $4, ST_SetSRID(ST_MakePoint($5, $6), 4326)::geography) 
       RETURNING id`,
      [user_id, item_type, qtyNum, urgNum, lngNum, latNum]
    );
    io.emit("need:new", { id: r.rows[0].id, item_type, quantity: qtyNum, urgency: urgNum });
    io.emit("changed");
    res.json(r.rows[0]);
  })
);

// PostGIS radius search (default 5 km)
app.get(
  "/api/needs/:id/matches",
  wrap(async (req, res) => {
    const radius = Number(req.query.radius) || 5000;
    const r = await pool.query(
      `SELECT r.id, r.item_type, r.quantity, ST_Distance(r.location, n.location) AS distance_m
       FROM needs n JOIN resources r
         ON r.item_type = n.item_type AND r.status = $3
        AND ST_DWithin(r.location, n.location, $2)
       WHERE n.id = $1 ORDER BY distance_m LIMIT 10`,
      [req.params.id, radius, "available"]
    );
    res.json(r.rows);
  })
);

// Accept Match
app.post(
  "/api/needs/:id/accept",
  wrap(async (req, res) => {
    const { resource_id, volunteer_id } = req.body;
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      const n = await c.query(
        "SELECT status FROM needs WHERE id=$1 FOR UPDATE",
        [req.params.id]
      );
      const r = await c.query(
        "SELECT status FROM resources WHERE id=$1 FOR UPDATE",
        [resource_id]
      );
      if (
        n.rows[0]?.status !== "requested" ||
        r.rows[0]?.status !== "available"
      ) {
        await c.query("ROLLBACK");
        return res
          .status(409)
          .json({ error: "වෙනත් කෙනෙක් දැනටමත් මෙය භාර ගෙන ඇත" });
      }
      await c.query("UPDATE needs SET status=$2 WHERE id=$1", [
        req.params.id,
        "assigned",
      ]);
      await c.query("UPDATE resources SET status=$2 WHERE id=$1", [
        resource_id,
        "assigned",
      ]);
      await c.query(
        "INSERT INTO matches(need_id,resource_id,volunteer_id) VALUES($1,$2,$3)",
        [req.params.id, resource_id, volunteer_id]
      );
      await c.query("COMMIT");
      io.emit("changed");
      res.json({ ok: true });
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    } finally {
      c.release();
    }
  })
);

// Mark Delivered
app.post(
  "/api/needs/:id/deliver",
  wrap(async (req, res) => {
    await pool.query(
      "UPDATE needs SET status=$2 WHERE id=$1 AND status=$3",
      [req.params.id, "delivered", "assigned"]
    );
    await pool.query(
      "UPDATE matches SET status=$2 WHERE need_id=$1",
      [req.params.id, "delivered"]
    );
    io.emit("changed");
    res.json({ ok: true });
  })
);

// Get Resources
app.get(
  "/api/resources",
  wrap(async (_req, res) => {
    const r = await pool.query(
      `SELECT id, user_id, item_type, quantity, status, ${XY}
       FROM resources WHERE status=$1 ORDER BY created_at NULLS LAST`,
      ["available"]
    );
    res.json(r.rows);
  })
);

// Create Resource with Strict Input Validation
app.post(
  "/api/resources",
  wrap(async (req, res) => {
    const { user_id, item_type, quantity, lat, lng } = req.body;

    if (!user_id || !item_type || quantity === undefined || lat === undefined || lng === undefined) {
      return res.status(400).json({ error: "සියලුම තොරතුරු ඇතුළත් කරන්න (All fields are required)" });
    }

    if (!VALID_ITEMS.includes(item_type)) {
      return res.status(400).json({ error: "අවලංගු ද්‍රව්‍ය වර්ගයකි (Invalid Item Type)" });
    }

    const qtyNum = Number(quantity);
    if (isNaN(qtyNum) || qtyNum < 1) {
      return res.status(400).json({ error: "ප්‍රමාණය අවම වශයෙන් 1ක් විය යුතුය (Quantity must be at least 1)" });
    }

    const latNum = Number(lat);
    const lngNum = Number(lng);
    if (isNaN(latNum) || isNaN(lngNum) || latNum < -90 || latNum > 90 || lngNum < -180 || lngNum > 180) {
      return res.status(400).json({ error: "අවලංගු ස්ථාන දත්තයකි (Invalid GPS Coordinates)" });
    }

    const r = await pool.query(
      `INSERT INTO resources(user_id, item_type, quantity, location)
       VALUES($1, $2, $3, ST_SetSRID(ST_MakePoint($4, $5), 4326)::geography) 
       RETURNING id`,
      [user_id, item_type, qtyNum, lngNum, latNum]
    );
    io.emit("changed");
    res.json(r.rows[0]);
  })
);

const PORT = process.env.PORT || 4000;
server.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 API listening on http://localhost:${PORT}`);
});