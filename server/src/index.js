const express = require("express");
const { Pool } = require("pg");
const cors = require("cors");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
  res.send("ReliefConnect Backend Working!");
});

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || "postgres://postgres:postgres@localhost:5432/relief",
});

// Database Initialization with Messages Table
async function initDb() {
  await pool.query("CREATE EXTENSION IF NOT EXISTS postgis");
  
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      phone TEXT UNIQUE NOT NULL,
      role TEXT CHECK (role IN ('victim', 'donor', 'volunteer')),
      password TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS needs (
      id SERIAL PRIMARY KEY,
      user_id INT REFERENCES users(id),
      item_type TEXT NOT NULL,
      quantity INT NOT NULL CHECK (quantity > 0),
      urgency INT CHECK (urgency BETWEEN 1 AND 3),
      status TEXT DEFAULT 'requested' CHECK (status IN ('requested', 'assigned', 'delivered')),
      location GEOGRAPHY(Point, 4326),
      assigned_resource_id INT,
      volunteer_id INT REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS resources (
      id SERIAL PRIMARY KEY,
      user_id INT REFERENCES users(id),
      item_type TEXT NOT NULL,
      quantity INT NOT NULL CHECK (quantity > 0),
      location GEOGRAPHY(Point, 4326)
    );

    CREATE TABLE IF NOT EXISTS messages (
      id SERIAL PRIMARY KEY,
      need_id INT REFERENCES needs(id),
      sender_id INT REFERENCES users(id),
      sender_name TEXT NOT NULL,
      message TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);
  console.log("Database initialized successfully with Messages table.");
}

initDb().catch((err) => console.error("Database Init Error:", err));

// Input Validation Helpers
const isValidPhone = (phone) => /^\d{9,12}$/.test(phone);
const isValidPos = (lat, lng) => !isNaN(lat) && !isNaN(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;

// User Auth Routes
app.post("/api/users", async (req, res) => {
  const { name, phone, role, password } = req.body;
  if (!name || !phone || !role || !password) return res.status(400).json({ error: "All fields are required" });
  if (!isValidPhone(phone)) return res.status(400).json({ error: "Invalid phone number format" });

  try {
    const existing = await pool.query("SELECT * FROM users WHERE phone = $1", [phone]);
    if (existing.rows.length > 0) {
      if (existing.rows[0].password !== password) {
        return res.status(401).json({ error: "Incorrect password for this phone number" });
      }
      return res.json(existing.rows[0]);
    }

    const result = await pool.query(
      "INSERT INTO users (name, phone, role, password) VALUES ($1, $2, $3, $4) RETURNING id, name, phone, role",
      [name, phone, role, password]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Needs Routes
app.get("/api/needs", async (req, res) => {
  const result = await pool.query(
    "SELECT id, user_id, item_type, quantity, urgency, status, volunteer_id, ST_Y(location::geometry) as lat, ST_X(location::geometry) as lng FROM needs ORDER BY id DESC"
  );
  res.json(result.rows);
});

app.post("/api/needs", async (req, res) => {
  const { user_id, item_type, quantity, urgency, lat, lng } = req.body;
  if (!user_id || !item_type || !quantity || !urgency || !isValidPos(lat, lng)) {
    return res.status(400).json({ error: "Invalid need request payload" });
  }

  const result = await pool.query(
    "INSERT INTO needs (user_id, item_type, quantity, urgency, location) VALUES ($1, $2, $3, $4, ST_SetSRID(ST_MakePoint($6, $5), 4326)) RETURNING id, item_type, quantity",
    [user_id, item_type, quantity, urgency, lat, lng]
  );

  io.emit("need:new", result.rows[0]);
  io.emit("changed");
  res.json(result.rows[0]);
});

// Resources Routes
app.get("/api/resources", async (req, res) => {
  const result = await pool.query(
    "SELECT id, user_id, item_type, quantity, ST_Y(location::geometry) as lat, ST_X(location::geometry) as lng FROM resources ORDER BY id DESC"
  );
  res.json(result.rows);
});

app.post("/api/resources", async (req, res) => {
  const { user_id, item_type, quantity, lat, lng } = req.body;
  if (!user_id || !item_type || !quantity || !isValidPos(lat, lng)) {
    return res.status(400).json({ error: "Invalid resource request payload" });
  }

  const result = await pool.query(
    "INSERT INTO resources (user_id, item_type, quantity, location) VALUES ($1, $2, $3, ST_SetSRID(ST_MakePoint($5, $4), 4326)) RETURNING *",
    [user_id, item_type, quantity, lat, lng]
  );

  io.emit("changed");
  res.json(result.rows[0]);
});

// Spatial Match Route
app.get("/api/needs/:id/matches", async (req, res) => {
  const radius = Number(req.query.radius) || 5000;
  const needId = req.params.id;

  const needRes = await pool.query("SELECT item_type, location FROM needs WHERE id = $1", [needId]);
  if (needRes.rows.length === 0) return res.status(404).json({ error: "Need not found" });

  const need = needRes.rows[0];
  const matches = await pool.query(
    `SELECT id, user_id, item_type, quantity, ST_Y(location::geometry) as lat, ST_X(location::geometry) as lng,
            ST_Distance(location, $1) as distance_m
     FROM resources
     WHERE item_type = $2 AND ST_DWithin(location, $1, $3)
     ORDER BY distance_m ASC`,
    [need.location, need.item_type, radius]
  );

  res.json(matches.rows);
});

// Accept & Deliver Need
app.post("/api/needs/:id/accept", async (req, res) => {
  const { resource_id, volunteer_id } = req.body;
  await pool.query(
    "UPDATE needs SET status = 'assigned', assigned_resource_id = $1, volunteer_id = $2 WHERE id = $3",
    [resource_id, volunteer_id, req.params.id]
  );
  io.emit("changed");
  res.json({ success: true });
});

app.post("/api/needs/:id/deliver", async (req, res) => {
  await pool.query("UPDATE needs SET status = 'delivered' WHERE id = $1", [req.params.id]);
  io.emit("changed");
  res.json({ success: true });
});

// 💬 Chat API Endpoints
app.get("/api/needs/:id/messages", async (req, res) => {
  const result = await pool.query(
    "SELECT id, need_id, sender_id, sender_name, message, created_at FROM messages WHERE need_id = $1 ORDER BY id ASC",
    [req.params.id]
  );
  res.json(result.rows);
});

app.post("/api/needs/:id/messages", async (req, res) => {
  const { sender_id, sender_name, message } = req.body;
  if (!sender_id || !sender_name || !message || !message.trim()) {
    return res.status(400).json({ error: "Message content required" });
  }

  const result = await pool.query(
    "INSERT INTO messages (need_id, sender_id, sender_name, message) VALUES ($1, $2, $3, $4) RETURNING *",
    [req.params.id, sender_id, sender_name, message.trim()]
  );

  const newMessage = result.rows[0];
  io.emit(`chat:need:${req.params.id}`, newMessage); // Live Chat Broadcast
  res.json(newMessage);
});

// Socket.io Real-time connection
io.on("connection", (socket) => {
  console.log("Client connected:", socket.id);
  socket.on("disconnect", () => console.log("Client disconnected:", socket.id));
});

const PORT = 4000;
server.listen(PORT, () => console.log(`Server listening on port ${PORT}`));

module.exports = app;