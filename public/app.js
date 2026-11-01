const $ = s => document.querySelector(s);
let token = localStorage.getItem('sp_token');
let me = null, mode = 'login', chosenVehicle = '';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = d => d ? new Date(d).toLocaleString() : '-';

async function api(url, method = 'GET', body) {
  const r = await fetch('/api' + url, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: body ? JSON.stringify(body) : undefined
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || 'Something went wrong.');
  return d;
}
function toast(msg, err) {
  const t = $('#toast'); t.textContent = msg; t.className = 'show' + (err ? ' err' : '');
  clearTimeout(toast.id); toast.id = setTimeout(() => t.className = '', 3000);
}
const run = fn => async (...a) => { try { await fn(...a); } catch (e) { toast(e.message, true); } };

// ---------- Auth (login / register / log out) ----------
function showAuth() {
  me = null; $('#who').innerHTML = '';
  $('#app').innerHTML = `
  <div class="panel auth">
    <div class="tabs">
      <button id="tl" class="${mode === 'login' ? 'on' : ''}">Log in</button>
      <button id="tr" class="${mode === 'register' ? 'on' : ''}">Register</button>
    </div>
    ${mode === 'register' ? '<label for="name">Name</label><input id="name" autocomplete="name">' : ''}
    <label for="email">Email</label><input id="email" type="email" autocomplete="email">
    <label for="pw">Password</label><input id="pw" type="password" autocomplete="current-password">
    <p><button id="go">${mode === 'login' ? 'Log in' : 'Create account'}</button></p>
    <p class="hint">Admin demo: admin@parking.com / admin123</p>
  </div>`;
  $('#tl').onclick = () => { mode = 'login'; showAuth(); };
  $('#tr').onclick = () => { mode = 'register'; showAuth(); };
  $('#go').onclick = run(async () => {
    const body = { email: $('#email').value, password: $('#pw').value };
    if (mode === 'register') body.name = $('#name').value;
    const d = await api('/' + mode, 'POST', body);
    token = d.token; localStorage.setItem('sp_token', token); me = d.user; render();
  });
}
const logout = run(async () => {
  await api('/logout', 'POST'); localStorage.removeItem('sp_token'); token = null; mode = 'login'; showAuth();
});

// ---------- Shared pieces ----------
function bayHtml(s, pick) {
  const label = { free: 'Free', occupied: 'Full', maintenance: 'Closed' }[s.status];
  return `<div class="bay ${s.status} ${pick && s.status === 'free' ? 'pick' : ''}" data-id="${s.id}">
    <b>${esc(s.slotNumber)}</b><small>${s.slotType} - ${label}</small>${pick ? '' : adminBtns(s)}</div>`;
}
function adminBtns(s) {
  if (s.status === 'occupied') return '';
  return `<button class="small ghost" data-act="toggle" data-id="${s.id}" data-st="${s.status === 'free' ? 'maintenance' : 'free'}">${s.status === 'free' ? 'Close' : 'Reopen'}</button>
          <button class="small warn" data-act="remove" data-id="${s.id}">Remove</button>`;
}
function sessionsTable(list, payments) {
  if (!list.length) return '<p class="hint">No parking yet. Register a vehicle and pick a free bay.</p>';
  return `<div class="scroll"><table><tr><th>Vehicle</th><th>Slot</th>${me.role === 'admin' ? '<th>User</th>' : ''}<th>Entry</th><th>Exit</th><th>Duration</th><th>Amount</th><th>Status</th><th></th></tr>
  ${list.map(p => `<tr>
    <td>${esc(p.vehicleNumber)}</td><td>${esc(p.slotNumber)}</td>${me.role === 'admin' ? `<td>${esc(p.userName)}</td>` : ''}
    <td>${fmt(p.entryTime)}</td><td>${fmt(p.exitTime)}</td>
    <td>${p.duration ? p.duration + ' min' : '-'}</td><td>${p.amount ?? '-'}</td>
    <td><span class="badge ${p.status}">${p.status.replace('_', ' ')}</span></td>
    <td>${p.status === 'parked' ? `<button class="small" data-act="exit" data-id="${p.id}">Exit vehicle</button>` :
      p.status === 'awaiting_payment' ? `<select data-m="${p.id}" aria-label="Payment method"><option value="upi">UPI</option><option value="card">Card</option><option value="cash">Cash</option></select>
      <button class="small" data-act="pay" data-id="${p.id}">Pay ${p.amount}</button>` : ''}</td></tr>`).join('')}</table></div>`;
}
async function handleActions(e) {
  const b = e.target.closest('button[data-act]'); if (!b) return;
  const id = b.dataset.id, act = b.dataset.act;
  await run(async () => {
    if (act === 'exit') { const p = await api('/parking/exit', 'POST', { parkingId: id }); toast(`Exited after ${p.duration} min. Bill: ${p.amount}`); }
    if (act === 'pay') { const m = document.querySelector(`[data-m="${id}"]`).value; await api('/payments', 'POST', { parkingId: id, paymentMethod: m }); toast('Payment received. Slot is free again.'); }
    if (act === 'toggle') { await api('/slots/' + id, 'PUT', { status: b.dataset.st }); toast('Slot updated.'); }
    if (act === 'remove') { if (!confirm('Remove this slot?')) return; await api('/slots/' + id, 'DELETE'); toast('Slot removed.'); }
    render();
  })();
}

// ---------- User dashboard ----------
async function userView() {
  const [vehicles, slots, parking] = await Promise.all([api('/vehicles'), api('/slots'), api('/parking')]);
  if (!chosenVehicle || !vehicles.some(v => v.id === chosenVehicle)) chosenVehicle = vehicles[0]?.id || '';
  const free = slots.filter(s => s.status === 'free').length;
  $('#app').innerHTML = `
  <div class="grid2">
    <section class="panel"><h2>Register vehicle</h2>
      <label for="vn">Vehicle number</label><input id="vn" placeholder="KA01AB1234">
      <label for="vt">Type</label><select id="vt"><option value="car">Car</option><option value="bike">Bike</option></select>
      <p><button id="addv">Register vehicle</button></p>
      <h2>My vehicles</h2>
      ${vehicles.length ? vehicles.map(v => `<div>${esc(v.vehicleNumber)} (${v.vehicleType})</div>`).join('') : '<p class="hint">No vehicles yet.</p>'}
    </section>
    <section class="panel"><h2>Park a vehicle</h2>
      <label for="pv">Vehicle</label>
      <select id="pv">${vehicles.map(v => `<option value="${v.id}" ${v.id === chosenVehicle ? 'selected' : ''}>${esc(v.vehicleNumber)} (${v.vehicleType})</option>`).join('') || '<option value="">Register a vehicle first</option>'}</select>
      <p class="hint">${free} of ${slots.length} slots free. Tap a free bay to park there.</p>
      <div class="bays" id="bays">${slots.map(s => bayHtml(s, true)).join('')}</div>
    </section>
  </div>
  <section class="panel"><h2>My parking</h2><div id="sessions">${sessionsTable(parking)}</div></section>`;
  $('#addv').onclick = run(async () => {
    await api('/vehicles', 'POST', { vehicleNumber: $('#vn').value, vehicleType: $('#vt').value }); toast('Vehicle registered.'); render();
  });
  $('#pv').onchange = e => chosenVehicle = e.target.value;
  $('#bays').onclick = run(async e => {
    const bay = e.target.closest('.bay.free'); if (!bay) return;
    if (!$('#pv').value) throw new Error('Register a vehicle first.');
    await api('/parking/park', 'POST', { vehicleId: $('#pv').value, slotId: bay.dataset.id }); toast('Vehicle parked.'); render();
  });
  $('#sessions').onclick = handleActions;
}

// ---------- Admin dashboard ----------
async function adminView() {
  const [o, slots, parking] = await Promise.all([api('/admin/overview'), api('/slots'), api('/parking')]);
  $('#app').innerHTML = `
  <div class="stats">
    <div class="stat"><b>${o.totalSlots}</b>Total slots</div><div class="stat"><b>${o.free}</b>Free</div>
    <div class="stat"><b>${o.occupied}</b>Occupied</div><div class="stat"><b>${o.maintenance}</b>Closed</div>
    <div class="stat"><b>${o.users}</b>Users</div><div class="stat"><b>${o.revenue}</b>Revenue (${o.ratePerHour}/hr)</div>
  </div>
  <section class="panel"><h2>Add slot</h2>
    <div class="row"><div><label for="sn">Slot number</label><input id="sn" placeholder="C1"></div>
    <div><label for="st">Type</label><select id="st"><option value="car">Car</option><option value="bike">Bike</option></select></div>
    <button id="adds">Add slot</button></div></section>
  <section class="panel"><h2>Manage slots</h2><div class="bays" id="bays">${slots.map(s => bayHtml(s, false)).join('')}</div></section>
  <section class="panel"><h2>All parking</h2><div id="sessions">${sessionsTable(parking)}</div></section>`;
  $('#adds').onclick = run(async () => {
    await api('/slots', 'POST', { slotNumber: $('#sn').value, slotType: $('#st').value }); toast('Slot added.'); render();
  });
  $('#bays').onclick = handleActions; $('#sessions').onclick = handleActions;
}

async function render() {
  try {
    if (!me) me = await api('/me');
    $('#who').innerHTML = `<span>${esc(me.name)} (${me.role})</span><button class="ghost small" id="lo">Log out</button>`;
    $('#lo').onclick = logout;
    await (me.role === 'admin' ? adminView() : userView());
  } catch (e) { localStorage.removeItem('sp_token'); token = null; showAuth(); }
}
token ? render() : showAuth();
