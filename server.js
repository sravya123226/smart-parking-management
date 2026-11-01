// Smart Parking System - Application server (parking-app + payment-service)
const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const RATE_PER_HOUR = 20; // currency units per hour (minimum 1 hour)
const DB_FILE = path.join(__dirname, 'data', 'db.json');

// ---------- Database (JSON file; replaces MySQL schema.sql for easy setup) ----------
function hash(pw, salt = crypto.randomBytes(8).toString('hex')) {
  return salt + ':' + crypto.scryptSync(pw, salt, 32).toString('hex');
}
function check(pw, stored) { return hash(pw, stored.split(':')[0]) === stored; }

function seed() {
  const slots = [];
  ['A', 'B'].forEach(row => {
    for (let i = 1; i <= 6; i++) {
      slots.push({ id: crypto.randomUUID(), slotNumber: row + i, slotType: row === 'A' ? 'car' : 'bike', status: 'free' });
    }
  });
  return {
    users: [{ id: crypto.randomUUID(), name: 'Admin', email: 'admin@parking.com', password: hash('admin123'), role: 'admin' }],
    vehicles: [], slots, parking: [], payments: []
  };
}
function load() {
  fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
  if (!fs.existsSync(DB_FILE)) fs.writeFileSync(DB_FILE, JSON.stringify(seed(), null, 2));
  return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
}
const db = load();
const save = () => fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));

// ---------- Helpers ----------
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const sessions = new Map(); // token -> userId
const fail = (res, code, msg) => res.status(code).json({ error: msg });
const clean = u => ({ id: u.id, name: u.name, email: u.email, role: u.role });

function auth(req, res, next) {
  const t = (req.headers.authorization || '').replace('Bearer ', '');
  const user = db.users.find(u => u.id === sessions.get(t));
  if (!user) return fail(res, 401, 'Please log in first.');
  req.user = user; next();
}
const adminOnly = (req, res, next) => req.user.role === 'admin' ? next() : fail(res, 403, 'Admin access only.');

// ---------- User: register, login, log out ----------
app.post('/api/register', (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password || password.length < 6) return fail(res, 400, 'Enter name, email and a password of 6+ characters.');
  if (db.users.some(u => u.email === email.toLowerCase())) return fail(res, 409, 'That email is already registered.');
  const user = { id: crypto.randomUUID(), name, email: email.toLowerCase(), password: hash(password), role: 'user' };
  db.users.push(user); save();
  const token = crypto.randomUUID(); sessions.set(token, user.id);
  res.json({ token, user: clean(user) });
});
app.post('/api/login', (req, res) => {
  const user = db.users.find(u => u.email === (req.body.email || '').toLowerCase());
  if (!user || !check(req.body.password || '', user.password)) return fail(res, 401, 'Wrong email or password.');
  const token = crypto.randomUUID(); sessions.set(token, user.id);
  res.json({ token, user: clean(user) });
});
app.post('/api/logout', auth, (req, res) => {
  sessions.delete((req.headers.authorization || '').replace('Bearer ', '')); res.json({ ok: true });
});
app.get('/api/me', auth, (req, res) => res.json(clean(req.user)));

// ---------- Vehicle: register vehicle ----------
app.get('/api/vehicles', auth, (req, res) => res.json(db.vehicles.filter(v => v.userId === req.user.id)));
app.post('/api/vehicles', auth, (req, res) => {
  const { vehicleNumber, vehicleType } = req.body;
  if (!vehicleNumber || !['car', 'bike'].includes(vehicleType)) return fail(res, 400, 'Enter a vehicle number and choose car or bike.');
  const num = vehicleNumber.trim().toUpperCase();
  if (db.vehicles.some(v => v.vehicleNumber === num)) return fail(res, 409, 'That vehicle is already registered.');
  const v = { id: crypto.randomUUID(), userId: req.user.id, vehicleNumber: num, vehicleType };
  db.vehicles.push(v); save(); res.json(v);
});

// ---------- Parking slot: check availability ----------
app.get('/api/slots', auth, (req, res) => res.json(db.slots));

// ---------- Parking: park vehicle, exit vehicle ----------
const enrich = p => ({
  ...p,
  vehicleNumber: (db.vehicles.find(v => v.id === p.vehicleId) || {}).vehicleNumber,
  slotNumber: (db.slots.find(s => s.id === p.slotId) || {}).slotNumber,
  userName: (db.users.find(u => u.id === p.userId) || {}).name
});
app.get('/api/parking', auth, (req, res) => {
  const list = req.user.role === 'admin' ? db.parking : db.parking.filter(p => p.userId === req.user.id);
  res.json(list.map(enrich).reverse());
});
app.post('/api/parking/park', auth, (req, res) => {
  const vehicle = db.vehicles.find(v => v.id === req.body.vehicleId && v.userId === req.user.id);
  const slot = db.slots.find(s => s.id === req.body.slotId);
  if (!vehicle) return fail(res, 400, 'Choose one of your registered vehicles.');
  if (!slot) return fail(res, 404, 'Slot not found.');
  if (slot.status !== 'free') return fail(res, 409, 'Slot is full. Pick another slot.');
  if (slot.slotType !== vehicle.vehicleType) return fail(res, 400, `Slot ${slot.slotNumber} is for ${slot.slotType}s only.`);
  if (db.parking.some(p => p.vehicleId === vehicle.id && p.status !== 'completed')) return fail(res, 409, 'This vehicle is already parked or has an unpaid bill.');
  const p = { id: crypto.randomUUID(), userId: req.user.id, vehicleId: vehicle.id, slotId: slot.id,
    entryTime: new Date().toISOString(), exitTime: null, duration: null, amount: null, status: 'parked' };
  slot.status = 'occupied'; db.parking.push(p); save(); res.json(enrich(p));
});
app.post('/api/parking/exit', auth, (req, res) => {
  const p = db.parking.find(x => x.id === req.body.parkingId && (req.user.role === 'admin' || x.userId === req.user.id));
  if (!p || p.status !== 'parked') return fail(res, 400, 'No active parking found.');
  p.exitTime = new Date().toISOString();
  p.duration = Math.max(1, Math.round((new Date(p.exitTime) - new Date(p.entryTime)) / 60000)); // minutes
  p.amount = Math.max(1, Math.ceil(p.duration / 60)) * RATE_PER_HOUR;
  p.status = 'awaiting_payment'; save(); res.json(enrich(p));
});

// ---------- Payment service: make payment, payment status ----------
app.post('/api/payments', auth, (req, res) => {
  const p = db.parking.find(x => x.id === req.body.parkingId && (req.user.role === 'admin' || x.userId === req.user.id));
  if (!p || p.status !== 'awaiting_payment') return fail(res, 400, 'Nothing to pay for this parking.');
  if (!['cash', 'card', 'upi'].includes(req.body.paymentMethod)) return fail(res, 400, 'Choose a payment method.');
  const pay = { id: crypto.randomUUID(), parkingId: p.id, amount: p.amount, paymentMethod: req.body.paymentMethod, status: 'paid', paidAt: new Date().toISOString() };
  db.payments.push(pay);
  p.status = 'completed';
  const slot = db.slots.find(s => s.id === p.slotId); if (slot) slot.status = 'free'; // update slot
  save(); res.json(pay);
});
app.get('/api/payments', auth, (req, res) => {
  const mine = new Set(db.parking.filter(p => req.user.role === 'admin' || p.userId === req.user.id).map(p => p.id));
  res.json(db.payments.filter(p => mine.has(p.parkingId)).reverse());
});

// ---------- Admin: add / remove / update slot, manage parking ----------
app.post('/api/slots', auth, adminOnly, (req, res) => {
  const { slotNumber, slotType } = req.body;
  if (!slotNumber || !['car', 'bike'].includes(slotType)) return fail(res, 400, 'Enter a slot number and type.');
  if (db.slots.some(s => s.slotNumber.toLowerCase() === slotNumber.trim().toLowerCase())) return fail(res, 409, 'Slot number already exists.');
  const s = { id: crypto.randomUUID(), slotNumber: slotNumber.trim().toUpperCase(), slotType, status: 'free' };
  db.slots.push(s); save(); res.json(s);
});
app.put('/api/slots/:id', auth, adminOnly, (req, res) => {
  const s = db.slots.find(x => x.id === req.params.id);
  if (!s) return fail(res, 404, 'Slot not found.');
  if (s.status === 'occupied') return fail(res, 409, 'Slot is in use. Wait until the vehicle exits and pays.');
  if (!['free', 'maintenance'].includes(req.body.status)) return fail(res, 400, 'Invalid status.');
  s.status = req.body.status; save(); res.json(s);
});
app.delete('/api/slots/:id', auth, adminOnly, (req, res) => {
  const s = db.slots.find(x => x.id === req.params.id);
  if (!s) return fail(res, 404, 'Slot not found.');
  if (s.status === 'occupied') return fail(res, 409, 'Slot is in use and cannot be removed.');
  db.slots = db.slots.filter(x => x.id !== s.id); save(); res.json({ ok: true });
});
app.get('/api/admin/overview', auth, adminOnly, (req, res) => res.json({
  totalSlots: db.slots.length,
  free: db.slots.filter(s => s.status === 'free').length,
  occupied: db.slots.filter(s => s.status === 'occupied').length,
  maintenance: db.slots.filter(s => s.status === 'maintenance').length,
  users: db.users.filter(u => u.role === 'user').length,
  revenue: db.payments.reduce((a, p) => a + p.amount, 0),
  ratePerHour: RATE_PER_HOUR
}));

app.listen(PORT, () => console.log(`Smart Parking System running at http://localhost:${PORT}`));
