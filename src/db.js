import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import { hashPassword } from "./auth.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, "..", "data");
fs.mkdirSync(dataDir, { recursive: true });
const dbPath = path.join(dataDir, "barbearia.db");

const db = new DatabaseSync(dbPath);
db.exec("PRAGMA foreign_keys = ON;");

db.exec(`
  CREATE TABLE IF NOT EXISTS barbershops (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    address TEXT,
    phone TEXT,
    opens_at TEXT NOT NULL DEFAULT '09:00',
    closes_at TEXT NOT NULL DEFAULT '19:00'
  );

  CREATE TABLE IF NOT EXISTS barbers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    barbershop_id INTEGER NOT NULL REFERENCES barbershops(id),
    name TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS services (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    barbershop_id INTEGER NOT NULL REFERENCES barbershops(id),
    name TEXT NOT NULL,
    price_cents INTEGER NOT NULL,
    duration_min INTEGER NOT NULL,
    active INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS clients (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    phone TEXT NOT NULL UNIQUE,
    birthday TEXT
  );

  CREATE TABLE IF NOT EXISTS appointments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    barbershop_id INTEGER NOT NULL REFERENCES barbershops(id),
    barber_id INTEGER NOT NULL REFERENCES barbers(id),
    service_id INTEGER NOT NULL REFERENCES services(id),
    client_id INTEGER NOT NULL REFERENCES clients(id),
    date TEXT NOT NULL,
    start_time TEXT NOT NULL,
    end_time TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'confirmed',
    reminder_sent_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    barbershop_id INTEGER NOT NULL REFERENCES barbershops(id),
    barber_id INTEGER REFERENCES barbers(id),
    role TEXT NOT NULL CHECK (role IN ('owner', 'barber')),
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    name TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS time_blocks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    barbershop_id INTEGER NOT NULL REFERENCES barbershops(id),
    barber_id INTEGER REFERENCES barbers(id),
    type TEXT NOT NULL,
    label TEXT,
    date TEXT,
    start_time TEXT NOT NULL,
    end_time TEXT NOT NULL,
    recurring INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS reviews (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    appointment_id INTEGER NOT NULL UNIQUE REFERENCES appointments(id),
    barbershop_id INTEGER NOT NULL REFERENCES barbershops(id),
    barber_id INTEGER NOT NULL REFERENCES barbers(id),
    client_id INTEGER NOT NULL REFERENCES clients(id),
    rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
    comment TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS expenses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    barbershop_id INTEGER NOT NULL REFERENCES barbershops(id),
    description TEXT NOT NULL,
    amount_cents INTEGER NOT NULL,
    start_date TEXT NOT NULL,
    recurring INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    barbershop_id INTEGER NOT NULL REFERENCES barbershops(id),
    name TEXT NOT NULL,
    price_cents INTEGER NOT NULL,
    active INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS product_sales (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    barbershop_id INTEGER NOT NULL REFERENCES barbershops(id),
    client_id INTEGER NOT NULL REFERENCES clients(id),
    product_id INTEGER NOT NULL REFERENCES products(id),
    quantity INTEGER NOT NULL DEFAULT 1,
    date TEXT NOT NULL,
    appointment_id INTEGER REFERENCES appointments(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    barbershop_id INTEGER NOT NULL REFERENCES barbershops(id),
    user_name TEXT NOT NULL,
    action TEXT NOT NULL,
    details TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// Migrate columns added after the initial release — CREATE TABLE IF NOT EXISTS
// only affects brand-new tables, so pre-existing databases need these added by hand.
function ensureColumn(table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!columns.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}
ensureColumn("barbers", "active", "INTEGER NOT NULL DEFAULT 1");
ensureColumn("services", "active", "INTEGER NOT NULL DEFAULT 1");
ensureColumn("appointments", "reminder_sent_at", "TEXT");
ensureColumn("clients", "birthday", "TEXT");
ensureColumn("barbers", "commission_percent", "REAL NOT NULL DEFAULT 40");
ensureColumn("barbers", "monthly_goal_cents", "INTEGER NOT NULL DEFAULT 0");
ensureColumn("product_sales", "appointment_id", "INTEGER REFERENCES appointments(id)");

function seedIfEmpty() {
  const { count } = db.prepare("SELECT COUNT(*) AS count FROM barbershops").get();
  if (count > 0) return;

  const insertShop = db.prepare(
    "INSERT INTO barbershops (name, address, phone, opens_at, closes_at) VALUES (?, ?, ?, ?, ?)"
  );
  const insertBarber = db.prepare(
    "INSERT INTO barbers (barbershop_id, name) VALUES (?, ?)"
  );
  const insertService = db.prepare(
    "INSERT INTO services (barbershop_id, name, price_cents, duration_min) VALUES (?, ?, ?, ?)"
  );

  const shop1 = insertShop.run(
    "Barbearia Vintage",
    "Rua das Flores, 123 - Centro",
    "(11) 99999-1111",
    "09:00",
    "19:00"
  ).lastInsertRowid;

  for (const name of ["Carlos", "Rafael", "Diego"]) {
    insertBarber.run(shop1, name);
  }
  for (const [name, price, duration] of [
    ["Corte Masculino", 4000, 45],
    ["Barba", 2500, 20],
    ["Corte + Barba", 6000, 60],
    ["Sobrancelha", 1500, 10],
  ]) {
    insertService.run(shop1, name, price, duration);
  }

  const shop2 = insertShop.run(
    "Barber King",
    "Av. Paulista, 900 - Bela Vista",
    "(11) 98888-2222",
    "10:00",
    "20:00"
  ).lastInsertRowid;

  for (const name of ["Lucas", "Bruno"]) {
    insertBarber.run(shop2, name);
  }
  for (const [name, price, duration] of [
    ["Corte Masculino", 5000, 40],
    ["Barba Completa", 3000, 25],
    ["Corte + Barba", 7500, 65],
    ["Platinado", 12000, 90],
  ]) {
    insertService.run(shop2, name, price, duration);
  }
}

const DEMO_PASSWORD = "barbearia123";

function slugify(text) {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function seedUsers() {
  const { count } = db.prepare("SELECT COUNT(*) AS count FROM users").get();
  if (count > 0) return;

  const insertUser = db.prepare(
    "INSERT INTO users (barbershop_id, barber_id, role, username, password_hash, name) VALUES (?, ?, ?, ?, ?, ?)"
  );
  const passwordHash = hashPassword(DEMO_PASSWORD);
  const credentials = [];

  for (const shop of db.prepare("SELECT * FROM barbershops ORDER BY id").all()) {
    const ownerUsername = `${slugify(shop.name)}.dono`;
    insertUser.run(shop.id, null, "owner", ownerUsername, passwordHash, `Dono(a) da ${shop.name}`);
    credentials.push({ username: ownerUsername, role: "owner", shop: shop.name });

    for (const barber of db.prepare("SELECT * FROM barbers WHERE barbershop_id = ?").all(shop.id)) {
      const username = slugify(barber.name);
      insertUser.run(shop.id, barber.id, "barber", username, passwordHash, barber.name);
      credentials.push({ username, role: "barber", shop: shop.name, barber: barber.name });
    }
  }

  console.log("\n=== Usuários de demonstração criados (senha para todos: " + DEMO_PASSWORD + ") ===");
  for (const c of credentials) {
    console.log(
      `  ${c.username.padEnd(24)} [${c.role.padEnd(6)}] ${c.shop}${c.barber ? " — " + c.barber : ""}`
    );
  }
  console.log("Troque essas senhas antes de usar em produção.\n");
}

function localDateStr(d) {
  return `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, "0")}-${d
    .getDate()
    .toString()
    .padStart(2, "0")}`;
}

const CLIENT_NAMES = [
  "Pedro Almeida", "Lucas Ferreira", "Matheus Costa", "Gabriel Souza", "Rafael Lima",
  "Bruno Alves", "Thiago Rocha", "Felipe Martins", "André Nascimento", "Rodrigo Cardoso",
  "Vinícius Teixeira", "Gustavo Ribeiro", "Leonardo Pereira", "Marcelo Gomes", "Fernando Dias",
  "Eduardo Correia", "Renato Vieira", "Alexandre Moura", "Daniel Castro", "João Pedro",
  "Miguel Santos", "Arthur Oliveira", "Enzo Fernandes", "Davi Cavalcanti", "Otávio Ramos",
];

function seedHistoricalData() {
  const { count } = db.prepare("SELECT COUNT(*) AS count FROM appointments").get();
  if (count >= 15) return;

  const insertAppointment = db.prepare(
    `INSERT INTO appointments (barbershop_id, barber_id, service_id, client_id, date, start_time, end_time, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'confirmed')`
  );

  const clientPool = CLIENT_NAMES.map((name, i) =>
    findOrCreateClient(name, `1191${(300000 + i).toString()}`)
  );

  const DAYS_BACK = 75;
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  for (const shop of getBarbershops()) {
    const barbers = getBarbers(shop.id);
    const services = getServices(shop.id);
    if (barbers.length === 0 || services.length === 0) continue;

    const openMin = timeToMinutes(shop.opens_at);
    const closeMin = timeToMinutes(shop.closes_at);

    function scheduleRandom(dateStr, busy, restrictStart, restrictEnd) {
      const barber = barbers[Math.floor(Math.random() * barbers.length)];
      const service = services[Math.floor(Math.random() * services.length)];
      const lo = restrictStart ?? openMin;
      const hi = restrictEnd ?? closeMin;
      const maxStart = hi - service.duration_min;
      if (maxStart < lo) return false;
      const slotCount = Math.max(1, Math.floor((maxStart - lo) / 30) + 1);
      for (let attempt = 0; attempt < 6; attempt++) {
        const start = lo + Math.floor(Math.random() * slotCount) * 30;
        const end = start + service.duration_min;
        if (end > hi) continue;
        const list = busy[barber.id] || [];
        if (list.some((b) => start < b.end && end > b.start)) continue;
        busy[barber.id] = [...list, { start, end }];
        const client = clientPool[Math.floor(Math.random() * clientPool.length)];
        insertAppointment.run(
          shop.id,
          barber.id,
          service.id,
          client.id,
          dateStr,
          minutesToTime(start),
          minutesToTime(end)
        );
        return true;
      }
      return false;
    }

    // Historical days (past), skipping Sundays (closed)
    for (let offset = DAYS_BACK; offset >= 1; offset--) {
      const day = new Date(today);
      day.setDate(day.getDate() - offset);
      if (day.getDay() === 0) continue;
      const dateStr = localDateStr(day);
      const busy = {};
      const apptCount = 3 + Math.floor(Math.random() * 7);
      for (let n = 0; n < apptCount; n++) scheduleRandom(dateStr, busy);
    }

    // Today: a mix of already-completed, in-progress, and upcoming appointments
    const now = new Date();
    const nowMin = now.getHours() * 60 + now.getMinutes();
    const todayStr = localDateStr(today);
    const busyToday = {};

    if (nowMin > openMin + 10 && nowMin < closeMin - 10) {
      scheduleRandom(todayStr, busyToday, Math.max(openMin, nowMin - 15), Math.min(closeMin, nowMin + 5));
    }
    if (nowMin > openMin + 30) {
      const completedCount = 2 + Math.floor(Math.random() * 2);
      for (let n = 0; n < completedCount; n++) {
        scheduleRandom(todayStr, busyToday, openMin, Math.min(nowMin, closeMin));
      }
    }
    if (nowMin < closeMin - 30) {
      const upcomingCount = 3 + Math.floor(Math.random() * 3);
      for (let n = 0; n < upcomingCount; n++) {
        scheduleRandom(todayStr, busyToday, Math.max(openMin, nowMin + 20), closeMin);
      }
    }
  }
}

seedIfEmpty();
seedUsers();
seedHistoricalData();

export function getBarbershops() {
  return db.prepare("SELECT * FROM barbershops ORDER BY id").all();
}

export function getBarbershop(id) {
  return db.prepare("SELECT * FROM barbershops WHERE id = ?").get(id);
}

export function updateBarbershopHours(id, opensAt, closesAt) {
  db.prepare("UPDATE barbershops SET opens_at = ?, closes_at = ? WHERE id = ?").run(opensAt, closesAt, id);
  return getBarbershop(id);
}


export function getServices(barbershopId, { includeInactive = false } = {}) {
  const query = includeInactive
    ? "SELECT * FROM services WHERE barbershop_id = ? ORDER BY id"
    : "SELECT * FROM services WHERE barbershop_id = ? AND active = 1 ORDER BY id";
  return db.prepare(query).all(barbershopId);
}

export function getService(id) {
  return db.prepare("SELECT * FROM services WHERE id = ?").get(id);
}

export function createService(barbershopId, { name, priceCents, durationMin }) {
  const { lastInsertRowid } = db
    .prepare(
      "INSERT INTO services (barbershop_id, name, price_cents, duration_min) VALUES (?, ?, ?, ?)"
    )
    .run(barbershopId, name, priceCents, durationMin);
  return getService(lastInsertRowid);
}

export function updateService(id, { name, priceCents, durationMin }) {
  db.prepare("UPDATE services SET name = ?, price_cents = ?, duration_min = ? WHERE id = ?").run(
    name,
    priceCents,
    durationMin,
    id
  );
  return getService(id);
}

export function setServiceActive(id, active) {
  db.prepare("UPDATE services SET active = ? WHERE id = ?").run(active ? 1 : 0, id);
  return getService(id);
}

export function getBarbers(barbershopId, { includeInactive = false } = {}) {
  const query = includeInactive
    ? "SELECT * FROM barbers WHERE barbershop_id = ? ORDER BY id"
    : "SELECT * FROM barbers WHERE barbershop_id = ? AND active = 1 ORDER BY id";
  return db.prepare(query).all(barbershopId);
}

export function getBarber(id) {
  return db.prepare("SELECT * FROM barbers WHERE id = ?").get(id);
}

export function createBarber(barbershopId, name) {
  const { lastInsertRowid } = db
    .prepare("INSERT INTO barbers (barbershop_id, name) VALUES (?, ?)")
    .run(barbershopId, name);
  return getBarber(lastInsertRowid);
}

export function updateBarber(id, name, { commissionPercent, monthlyGoalCents } = {}) {
  const current = getBarber(id);
  db.prepare("UPDATE barbers SET name = ?, commission_percent = ?, monthly_goal_cents = ? WHERE id = ?").run(
    name,
    commissionPercent !== undefined && commissionPercent !== null ? commissionPercent : current.commission_percent,
    monthlyGoalCents !== undefined && monthlyGoalCents !== null ? monthlyGoalCents : current.monthly_goal_cents,
    id
  );
  return getBarber(id);
}

export function setBarberActive(id, active) {
  db.prepare("UPDATE barbers SET active = ? WHERE id = ?").run(active ? 1 : 0, id);
  return getBarber(id);
}

export function getClientByPhone(phone) {
  return db.prepare("SELECT * FROM clients WHERE phone = ?").get(phone);
}

export function getUserByUsername(username) {
  return db.prepare("SELECT * FROM users WHERE username = ?").get(username);
}

export function getUserById(id) {
  return db.prepare("SELECT * FROM users WHERE id = ?").get(id);
}

/* ---------------- Time blocks (folga, feriado, almoço) ---------------- */

export function createTimeBlock(barbershopId, { barberId, type, label, date, startTime, endTime, recurring }) {
  const { lastInsertRowid } = db
    .prepare(
      `INSERT INTO time_blocks (barbershop_id, barber_id, type, label, date, start_time, end_time, recurring)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      barbershopId,
      barberId || null,
      type,
      label || null,
      recurring ? null : date,
      startTime,
      endTime,
      recurring ? 1 : 0
    );
  return db.prepare("SELECT * FROM time_blocks WHERE id = ?").get(lastInsertRowid);
}

export function listTimeBlocks(barbershopId) {
  return db
    .prepare(
      `SELECT tb.*, b.name AS barber_name
       FROM time_blocks tb
       LEFT JOIN barbers b ON b.id = tb.barber_id
       WHERE tb.barbershop_id = ?
       ORDER BY tb.recurring DESC, tb.date, tb.start_time`
    )
    .all(barbershopId);
}

export function getTimeBlockById(id) {
  return db.prepare("SELECT * FROM time_blocks WHERE id = ?").get(id);
}

export function updateTimeBlock(id, { barberId, type, label, date, startTime, endTime, recurring }) {
  db.prepare(
    `UPDATE time_blocks SET barber_id = ?, type = ?, label = ?, date = ?, start_time = ?, end_time = ?, recurring = ?
     WHERE id = ?`
  ).run(
    barberId || null,
    type,
    label || null,
    recurring ? null : date,
    startTime,
    endTime,
    recurring ? 1 : 0,
    id
  );
  return getTimeBlockById(id);
}

export function listTimeBlocksForBarber(barbershopId, barberId) {
  return db
    .prepare(
      `SELECT tb.*, b.name AS barber_name
       FROM time_blocks tb
       LEFT JOIN barbers b ON b.id = tb.barber_id
       WHERE tb.barbershop_id = ? AND tb.barber_id = ?
       ORDER BY tb.recurring DESC, tb.date, tb.start_time`
    )
    .all(barbershopId, barberId);
}

export function deleteTimeBlock(id) {
  db.prepare("DELETE FROM time_blocks WHERE id = ?").run(id);
}

function getBlocksFor(barbershopId, barberId, date) {
  // Applies to this barber specifically, OR to the whole shop (barber_id IS NULL).
  // Either a fixed date match, or a recurring daily block.
  return db
    .prepare(
      `SELECT * FROM time_blocks
       WHERE barbershop_id = ?
         AND (barber_id IS NULL OR barber_id = ?)
         AND (recurring = 1 OR date = ?)`
    )
    .all(barbershopId, barberId, date);
}

export function findOrCreateClient(name, phone) {
  const existing = db.prepare("SELECT * FROM clients WHERE phone = ?").get(phone);
  if (existing) {
    if (name && name !== existing.name) {
      db.prepare("UPDATE clients SET name = ? WHERE id = ?").run(name, existing.id);
      existing.name = name;
    }
    return existing;
  }
  const { lastInsertRowid } = db
    .prepare("INSERT INTO clients (name, phone) VALUES (?, ?)")
    .run(name, phone);
  return db.prepare("SELECT * FROM clients WHERE id = ?").get(lastInsertRowid);
}

function timeToMinutes(t) {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

function minutesToTime(mins) {
  const h = Math.floor(mins / 60)
    .toString()
    .padStart(2, "0");
  const m = (mins % 60).toString().padStart(2, "0");
  return `${h}:${m}`;
}

export function getAvailableSlots(barbershopId, barberId, serviceId, date) {
  const shop = getBarbershop(barbershopId);
  const service = getService(serviceId);
  if (!shop || !service) return [];

  const openMin = timeToMinutes(shop.opens_at);
  const closeMin = timeToMinutes(shop.closes_at);
  const duration = service.duration_min;

  const existing = db
    .prepare(
      "SELECT start_time, end_time FROM appointments WHERE barber_id = ? AND date = ? AND status != 'cancelled'"
    )
    .all(barberId, date);
  const busy = existing.map((a) => ({
    start: timeToMinutes(a.start_time),
    end: timeToMinutes(a.end_time),
  }));

  const blocks = getBlocksFor(barbershopId, barberId, date).map((b) => ({
    start: timeToMinutes(b.start_time),
    end: timeToMinutes(b.end_time),
  }));
  busy.push(...blocks);

  const now = new Date();
  const isToday = date === now.toISOString().slice(0, 10);
  const nowMin = now.getHours() * 60 + now.getMinutes();

  const slots = [];
  for (let start = openMin; start + duration <= closeMin; start += 30) {
    if (isToday && start <= nowMin) continue;
    const end = start + duration;
    const overlaps = busy.some((b) => start < b.end && end > b.start);
    if (!overlaps) slots.push(minutesToTime(start));
  }
  return slots;
}

export function createAppointment({
  barbershopId,
  barberId,
  serviceId,
  clientId,
  date,
  startTime,
}) {
  const service = getService(serviceId);
  const endTime = minutesToTime(timeToMinutes(startTime) + service.duration_min);

  const conflict = db
    .prepare(
      "SELECT id FROM appointments WHERE barber_id = ? AND date = ? AND status != 'cancelled' AND start_time < ? AND end_time > ?"
    )
    .get(barberId, date, endTime, startTime);
  if (conflict) {
    throw new Error("Esse horário acabou de ser ocupado. Escolha outro horário.");
  }

  const startMin = timeToMinutes(startTime);
  const endMin = timeToMinutes(endTime);
  const blocked = getBlocksFor(barbershopId, barberId, date).some(
    (b) => startMin < timeToMinutes(b.end_time) && endMin > timeToMinutes(b.start_time)
  );
  if (blocked) {
    throw new Error("Esse horário está bloqueado (folga, feriado ou intervalo). Escolha outro horário.");
  }

  const { lastInsertRowid } = db
    .prepare(
      `INSERT INTO appointments (barbershop_id, barber_id, service_id, client_id, date, start_time, end_time)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(barbershopId, barberId, serviceId, clientId, date, startTime, endTime);

  return getAppointmentById(lastInsertRowid);
}

export function getAppointmentById(id) {
  return db
    .prepare(
      `SELECT a.*, b.name AS barber_name, s.name AS service_name, s.duration_min, s.price_cents,
              c.name AS client_name, c.phone AS client_phone, sh.name AS barbershop_name
       FROM appointments a
       JOIN barbers b ON b.id = a.barber_id
       JOIN services s ON s.id = a.service_id
       JOIN clients c ON c.id = a.client_id
       JOIN barbershops sh ON sh.id = a.barbershop_id
       WHERE a.id = ?`
    )
    .get(id);
}

export function getAppointments({ barbershopId, barberId, date, dateFrom, dateTo } = {}) {
  let query = `
    SELECT a.*, b.name AS barber_name, s.name AS service_name, s.duration_min, s.price_cents,
           c.name AS client_name, c.phone AS client_phone, sh.name AS barbershop_name
    FROM appointments a
    JOIN barbers b ON b.id = a.barber_id
    JOIN services s ON s.id = a.service_id
    JOIN clients c ON c.id = a.client_id
    JOIN barbershops sh ON sh.id = a.barbershop_id
    WHERE a.status != 'cancelled'
  `;
  const params = [];
  if (barbershopId) {
    query += " AND a.barbershop_id = ?";
    params.push(barbershopId);
  }
  if (barberId) {
    query += " AND a.barber_id = ?";
    params.push(barberId);
  }
  if (date) {
    query += " AND a.date = ?";
    params.push(date);
  }
  if (dateFrom) {
    query += " AND a.date >= ?";
    params.push(dateFrom);
  }
  if (dateTo) {
    query += " AND a.date <= ?";
    params.push(dateTo);
  }
  query += " ORDER BY a.date, a.start_time";
  return db.prepare(query).all(...params);
}

// Used when a last-minute time block is created, to find already-booked appointments
// that now fall inside the blocked window so their clients can be notified.
export function getAffectedAppointments(barbershopId, barberId, date, startTime, endTime) {
  const now = new Date();
  const startMin = timeToMinutes(startTime);
  const endMin = timeToMinutes(endTime);
  return getAppointments({ barbershopId, barberId: barberId || undefined, date })
    .filter((a) => a.status === "confirmed")
    .filter((a) => timeToMinutes(a.start_time) < endMin && timeToMinutes(a.end_time) > startMin)
    .filter((a) => new Date(`${a.date}T${a.start_time}:00`) > now);
}

export function updateAppointmentDetails(id, { clientName, serviceId, status }) {
  const appointment = getAppointmentById(id);
  if (!appointment) throw new Error("Agendamento não encontrado.");

  if (clientName && clientName.trim()) {
    db.prepare("UPDATE clients SET name = ? WHERE id = ?").run(clientName.trim(), appointment.client_id);
  }

  if (serviceId && Number(serviceId) !== appointment.service_id) {
    const service = getService(Number(serviceId));
    if (!service) throw new Error("Serviço não encontrado.");
    const newEndTime = minutesToTime(timeToMinutes(appointment.start_time) + service.duration_min);
    db.prepare("UPDATE appointments SET service_id = ?, end_time = ? WHERE id = ?").run(
      Number(serviceId),
      newEndTime,
      id
    );
  }

  if (status && ["confirmed", "no_show"].includes(status)) {
    db.prepare("UPDATE appointments SET status = ? WHERE id = ?").run(status, id);
  }

  return getAppointmentById(id);
}

export function getAppointmentsByClientPhone(clientPhone, barbershopId, { upcomingOnly = true } = {}) {
  const client = getClientByPhone(clientPhone);
  if (!client) return [];
  let query = `
    SELECT a.*, b.name AS barber_name, s.name AS service_name, s.duration_min, s.price_cents,
           c.name AS client_name, c.phone AS client_phone, sh.name AS barbershop_name
    FROM appointments a
    JOIN barbers b ON b.id = a.barber_id
    JOIN services s ON s.id = a.service_id
    JOIN clients c ON c.id = a.client_id
    JOIN barbershops sh ON sh.id = a.barbershop_id
    WHERE a.status != 'cancelled' AND a.client_id = ? AND a.barbershop_id = ?
  `;
  const params = [client.id, barbershopId];
  if (upcomingOnly) {
    const now = new Date();
    query += " AND (a.date > ? OR (a.date = ? AND a.end_time > ?))";
    params.push(
      localDateStr(now),
      localDateStr(now),
      `${now.getHours().toString().padStart(2, "0")}:${now.getMinutes().toString().padStart(2, "0")}`
    );
  }
  query += " ORDER BY a.date, a.start_time";
  return db.prepare(query).all(...params);
}

export function cancelAppointment(id) {
  db.prepare("UPDATE appointments SET status = 'cancelled' WHERE id = ?").run(id);
  return getAppointmentById(id);
}

export function rescheduleAppointment(id, newDate, newStartTime) {
  const appointment = getAppointmentById(id);
  if (!appointment) throw new Error("Agendamento não encontrado.");

  const service = getService(appointment.service_id);
  const newEndTime = minutesToTime(timeToMinutes(newStartTime) + service.duration_min);

  const conflict = db
    .prepare(
      "SELECT id FROM appointments WHERE barber_id = ? AND date = ? AND status != 'cancelled' AND id != ? AND start_time < ? AND end_time > ?"
    )
    .get(appointment.barber_id, newDate, id, newEndTime, newStartTime);
  if (conflict) {
    throw new Error("Esse novo horário já está ocupado. Escolha outro.");
  }

  const startMin = timeToMinutes(newStartTime);
  const endMin = timeToMinutes(newEndTime);
  const blocked = getBlocksFor(appointment.barbershop_id, appointment.barber_id, newDate).some(
    (b) => startMin < timeToMinutes(b.end_time) && endMin > timeToMinutes(b.start_time)
  );
  if (blocked) {
    throw new Error("Esse novo horário está bloqueado (folga, feriado ou intervalo). Escolha outro.");
  }

  db.prepare("UPDATE appointments SET date = ?, start_time = ?, end_time = ? WHERE id = ?").run(
    newDate,
    newStartTime,
    newEndTime,
    id
  );
  return getAppointmentById(id);
}

/* ---------------- Reviews ---------------- */

export function getUnreviewedCompletedAppointment(clientPhone, barbershopId) {
  const client = getClientByPhone(clientPhone);
  if (!client) return null;
  const now = new Date();
  const nowStr = `${localDateStr(now)} ${now.getHours().toString().padStart(2, "0")}:${now
    .getMinutes()
    .toString()
    .padStart(2, "0")}`;
  return db
    .prepare(
      `SELECT a.*, b.name AS barber_name, s.name AS service_name
       FROM appointments a
       JOIN barbers b ON b.id = a.barber_id
       JOIN services s ON s.id = a.service_id
       LEFT JOIN reviews r ON r.appointment_id = a.id
       WHERE a.client_id = ? AND a.barbershop_id = ? AND a.status != 'cancelled'
         AND r.id IS NULL
         AND (a.date || ' ' || a.end_time) <= ?
       ORDER BY a.date DESC, a.end_time DESC
       LIMIT 1`
    )
    .get(client.id, barbershopId, nowStr);
}

export function createReview({ appointmentId, rating, comment }) {
  const appointment = getAppointmentById(appointmentId);
  if (!appointment) throw new Error("Agendamento não encontrado.");
  const { lastInsertRowid } = db
    .prepare(
      `INSERT INTO reviews (appointment_id, barbershop_id, barber_id, client_id, rating, comment)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(
      appointmentId,
      appointment.barbershop_id,
      appointment.barber_id,
      appointment.client_id,
      rating,
      comment || null
    );
  return db.prepare("SELECT * FROM reviews WHERE id = ?").get(lastInsertRowid);
}

function reviewPeriodCutoff(period) {
  if (period === "week") {
    const d = new Date();
    d.setDate(d.getDate() - 7);
    return d.toISOString().slice(0, 19).replace("T", " ");
  }
  if (period === "month") {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString().slice(0, 19).replace("T", " ");
  }
  return null;
}

export function listReviews(barbershopId, limit = 20, { period, barberId } = {}) {
  let query = `
    SELECT r.*, c.name AS client_name, b.name AS barber_name, s.name AS service_name
    FROM reviews r
    JOIN clients c ON c.id = r.client_id
    JOIN barbers b ON b.id = r.barber_id
    JOIN appointments a ON a.id = r.appointment_id
    JOIN services s ON s.id = a.service_id
    WHERE r.barbershop_id = ?
  `;
  const params = [barbershopId];
  const cutoff = reviewPeriodCutoff(period);
  if (cutoff) {
    query += " AND r.created_at >= ?";
    params.push(cutoff);
  }
  if (barberId) {
    query += " AND r.barber_id = ?";
    params.push(barberId);
  }
  query += " ORDER BY r.created_at DESC LIMIT ?";
  params.push(limit);
  return db.prepare(query).all(...params);
}

export function getReviewStats(barbershopId, { period, barberId } = {}) {
  let query = "SELECT COUNT(*) AS count, AVG(rating) AS avg_rating FROM reviews WHERE barbershop_id = ?";
  const params = [barbershopId];
  const cutoff = reviewPeriodCutoff(period);
  if (cutoff) {
    query += " AND created_at >= ?";
    params.push(cutoff);
  }
  if (barberId) {
    query += " AND barber_id = ?";
    params.push(barberId);
  }
  const row = db.prepare(query).get(...params);
  return { count: row.count, avgRating: row.avg_rating ? Math.round(row.avg_rating * 10) / 10 : null };
}

/* ---------------- Client registry ---------------- */

export function getClientById(id) {
  return db.prepare("SELECT * FROM clients WHERE id = ?").get(id);
}

// clients aren't tenant-scoped by column (identified globally by phone), so ownership
// must be checked via "has this client ever booked at this barbershop".
export function clientBelongsToShop(clientId, barbershopId) {
  return !!db
    .prepare("SELECT 1 FROM appointments WHERE client_id = ? AND barbershop_id = ? LIMIT 1")
    .get(clientId, barbershopId);
}

export function updateClientBirthday(clientId, birthday) {
  db.prepare("UPDATE clients SET birthday = ? WHERE id = ?").run(birthday || null, clientId);
  return db.prepare("SELECT * FROM clients WHERE id = ?").get(clientId);
}

export function getClientStats(barbershopId) {
  const nowStr = `${localDateStr(new Date())} ${new Date().getHours().toString().padStart(2, "0")}:${new Date()
    .getMinutes()
    .toString()
    .padStart(2, "0")}`;
  const clients = db
    .prepare(
      `SELECT c.id, c.name, c.phone, c.birthday,
              COUNT(CASE WHEN a.status = 'confirmed' AND (a.date || ' ' || a.end_time) <= ? THEN 1 END) AS visit_count,
              SUM(CASE WHEN a.status = 'confirmed' AND (a.date || ' ' || a.end_time) <= ? THEN s.price_cents ELSE 0 END) AS total_revenue_cents,
              MAX(CASE WHEN a.status = 'confirmed' AND (a.date || ' ' || a.end_time) <= ? THEN a.date END) AS last_visit_date
       FROM clients c
       JOIN appointments a ON a.client_id = c.id AND a.barbershop_id = ? AND a.status != 'cancelled'
       JOIN services s ON s.id = a.service_id
       GROUP BY c.id
       ORDER BY last_visit_date DESC`
    )
    .all(nowStr, nowStr, nowStr, barbershopId);

  // Visit dates (completed appointments only) are used to estimate how often each
  // client comes back, so we can flag who's "overdue" for a return visit.
  const visitRows = db
    .prepare(
      `SELECT a.client_id, a.date
       FROM appointments a
       WHERE a.barbershop_id = ? AND a.status = 'confirmed' AND (a.date || ' ' || a.end_time) <= ?
       ORDER BY a.client_id, a.date`
    )
    .all(barbershopId, nowStr);

  const datesByClient = {};
  for (const row of visitRows) {
    (datesByClient[row.client_id] ||= []).push(row.date);
  }

  // Product sales aren't tied to an appointment, so they're summed separately
  // and folded into each client's total spend (and therefore their average ticket).
  const productRevenueByClient = {};
  for (const row of db
    .prepare(
      `SELECT ps.client_id, SUM(ps.quantity * p.price_cents) AS total
       FROM product_sales ps JOIN products p ON p.id = ps.product_id
       WHERE ps.barbershop_id = ?
       GROUP BY ps.client_id`
    )
    .all(barbershopId)) {
    productRevenueByClient[row.client_id] = row.total;
  }

  const todayStr = localDateStr(new Date());

  return clients.map((c) => {
    const dates = [...new Set(datesByClient[c.id] || [])].sort();
    let avgFrequencyDays = null;
    if (dates.length >= 2) {
      const first = new Date(dates[0]);
      const last = new Date(dates[dates.length - 1]);
      const totalDays = Math.round((last - first) / 86400000);
      if (totalDays > 0) avgFrequencyDays = Math.round(totalDays / (dates.length - 1));
    }

    let dueStatus = null; // "atrasado" | "em_dia" | null (dados insuficientes)
    if (avgFrequencyDays && c.last_visit_date) {
      const expectedNext = new Date(c.last_visit_date);
      expectedNext.setDate(expectedNext.getDate() + avgFrequencyDays);
      dueStatus = localDateStr(expectedNext) < todayStr ? "atrasado" : "em_dia";
    }

    return {
      ...c,
      total_revenue_cents: c.total_revenue_cents + (productRevenueByClient[c.id] || 0),
      avgFrequencyDays,
      dueStatus,
    };
  });
}

/* ---------------- Produtos e vendas de balcão ---------------- */

export function getProducts(barbershopId, { includeInactive = false } = {}) {
  const query = includeInactive
    ? "SELECT * FROM products WHERE barbershop_id = ? ORDER BY id"
    : "SELECT * FROM products WHERE barbershop_id = ? AND active = 1 ORDER BY id";
  return db.prepare(query).all(barbershopId);
}

export function getProduct(id) {
  return db.prepare("SELECT * FROM products WHERE id = ?").get(id);
}

export function createProduct(barbershopId, { name, priceCents }) {
  const { lastInsertRowid } = db
    .prepare("INSERT INTO products (barbershop_id, name, price_cents) VALUES (?, ?, ?)")
    .run(barbershopId, name, priceCents);
  return getProduct(lastInsertRowid);
}

export function updateProduct(id, { name, priceCents }) {
  db.prepare("UPDATE products SET name = ?, price_cents = ? WHERE id = ?").run(name, priceCents, id);
  return getProduct(id);
}

export function setProductActive(id, active) {
  db.prepare("UPDATE products SET active = ? WHERE id = ?").run(active ? 1 : 0, id);
  return getProduct(id);
}

export function createProductSale(barbershopId, { clientId, productId, quantity, date, appointmentId }) {
  const { lastInsertRowid } = db
    .prepare(
      "INSERT INTO product_sales (barbershop_id, client_id, product_id, quantity, date, appointment_id) VALUES (?, ?, ?, ?, ?, ?)"
    )
    .run(barbershopId, clientId, productId, quantity || 1, date, appointmentId || null);
  return db
    .prepare(
      `SELECT ps.*, p.name AS product_name, p.price_cents
       FROM product_sales ps JOIN products p ON p.id = ps.product_id
       WHERE ps.id = ?`
    )
    .get(lastInsertRowid);
}

export function getProductSalesForAppointment(appointmentId) {
  return db
    .prepare(
      `SELECT ps.*, p.name AS product_name, p.price_cents
       FROM product_sales ps JOIN products p ON p.id = ps.product_id
       WHERE ps.appointment_id = ?
       ORDER BY ps.id`
    )
    .all(appointmentId);
}

// The appointment edit form always submits the full, current list of products sold
// during that visit, so we replace (rather than append to) whatever was recorded before —
// otherwise re-saving the same appointment without changes would duplicate the sale.
export function replaceAppointmentProductSales(barbershopId, clientId, appointmentId, date, sales) {
  db.prepare("DELETE FROM product_sales WHERE appointment_id = ?").run(appointmentId);
  for (const s of sales) {
    if (!s.productId) continue;
    createProductSale(barbershopId, {
      clientId,
      productId: s.productId,
      quantity: s.quantity || 1,
      date,
      appointmentId,
    });
  }
  return getProductSalesForAppointment(appointmentId);
}

export function getProductSalesRevenue(barbershopId, { dateFrom, dateTo } = {}) {
  let query = `
    SELECT ps.date, ps.quantity * p.price_cents AS amount_cents
    FROM product_sales ps JOIN products p ON p.id = ps.product_id
    WHERE ps.barbershop_id = ?
  `;
  const params = [barbershopId];
  if (dateFrom) {
    query += " AND ps.date >= ?";
    params.push(dateFrom);
  }
  if (dateTo) {
    query += " AND ps.date <= ?";
    params.push(dateTo);
  }
  return db.prepare(query).all(...params);
}

/* ---------------- Despesas ---------------- */

export function listExpenses(barbershopId) {
  return db
    .prepare("SELECT * FROM expenses WHERE barbershop_id = ? ORDER BY start_date DESC")
    .all(barbershopId);
}

export function getExpenseById(id) {
  return db.prepare("SELECT * FROM expenses WHERE id = ?").get(id);
}

export function createExpense(barbershopId, { description, amountCents, startDate, recurring }) {
  const { lastInsertRowid } = db
    .prepare(
      "INSERT INTO expenses (barbershop_id, description, amount_cents, start_date, recurring) VALUES (?, ?, ?, ?, ?)"
    )
    .run(barbershopId, description, amountCents, startDate, recurring ? 1 : 0);
  return getExpenseById(lastInsertRowid);
}

export function deleteExpense(id) {
  db.prepare("DELETE FROM expenses WHERE id = ?").run(id);
}

// Recurring expenses (e.g. rent) repeat every month from their start date onward,
// so a monthly total needs to count one occurrence per elapsed month, not just the row itself.
function countMonthlyOccurrences(startDate, periodFrom, periodTo) {
  const effectiveFrom = periodFrom && periodFrom > startDate ? periodFrom : startDate;
  if (effectiveFrom > periodTo) return 0;
  const fromD = new Date(effectiveFrom);
  const toD = new Date(periodTo);
  const months = (toD.getFullYear() - fromD.getFullYear()) * 12 + (toD.getMonth() - fromD.getMonth()) + 1;
  return Math.max(months, 0);
}

export function getTotalExpenses(barbershopId, { dateFrom, dateTo }) {
  const expenses = listExpenses(barbershopId);
  const from = dateFrom || "0000-01-01";
  const to = dateTo || localDateStr(new Date());
  let total = 0;
  for (const e of expenses) {
    if (e.recurring) {
      total += e.amount_cents * countMonthlyOccurrences(e.start_date, from, to);
    } else if (e.start_date >= from && e.start_date <= to) {
      total += e.amount_cents;
    }
  }
  return total;
}

/* ---------------- Log de auditoria ---------------- */

export function logAudit(barbershopId, userName, action, details) {
  db.prepare("INSERT INTO audit_log (barbershop_id, user_name, action, details) VALUES (?, ?, ?, ?)").run(
    barbershopId,
    userName,
    action,
    details || null
  );
}

export function listAuditLog(barbershopId, limit = 100) {
  return db
    .prepare("SELECT * FROM audit_log WHERE barbershop_id = ? ORDER BY created_at DESC LIMIT ?")
    .all(barbershopId, limit);
}

/* ---------------- Reminders ---------------- */

export function getAppointmentsNeedingReminder(windowStartMin = 55, windowEndMin = 65) {
  const now = new Date();
  const from = new Date(now.getTime() + windowStartMin * 60000);
  const to = new Date(now.getTime() + windowEndMin * 60000);

  const fromStr = `${localDateStr(from)} ${from.getHours().toString().padStart(2, "0")}:${from
    .getMinutes()
    .toString()
    .padStart(2, "0")}`;
  const toStr = `${localDateStr(to)} ${to.getHours().toString().padStart(2, "0")}:${to
    .getMinutes()
    .toString()
    .padStart(2, "0")}`;

  return db
    .prepare(
      `SELECT a.*, b.name AS barber_name, s.name AS service_name,
              c.name AS client_name, c.phone AS client_phone, sh.name AS barbershop_name
       FROM appointments a
       JOIN barbers b ON b.id = a.barber_id
       JOIN services s ON s.id = a.service_id
       JOIN clients c ON c.id = a.client_id
       JOIN barbershops sh ON sh.id = a.barbershop_id
       WHERE a.status != 'cancelled' AND a.reminder_sent_at IS NULL
         AND (a.date || ' ' || a.start_time) BETWEEN ? AND ?`
    )
    .all(fromStr, toStr);
}

export function markReminderSent(id) {
  db.prepare("UPDATE appointments SET reminder_sent_at = datetime('now') WHERE id = ?").run(id);
}

export default db;
