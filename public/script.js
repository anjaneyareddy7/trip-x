// FIX: was hardcoded to "http://localhost:3000" — breaks once deployed.
// server.js serves this script itself, so the API always lives at the
// same origin the page was loaded from.
const API = window.location.origin;
let currentTrip = null;

const AVATAR_COLORS = ["#c9a84c","#4ecdc4","#e8553a","#ab47bc","#4fc3f7","#ff80ab","#69ffb4","#ffb74d"];

/* ─── AUTHENTICATION ─── */
function addAuthHeader() {
  const token = localStorage.getItem("token");
  return {
    "Authorization": `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

async function checkAuth() {
  const token = localStorage.getItem("token");
  if (!token) {
    window.location.href = "login.html";
    return false;
  }
  try {
    const res = await fetch(`${API}/auth/verify`, {
      method: "POST",
      headers: addAuthHeader(),
    });
    // FIX: a 401 means the token itself is invalid/expired — clear it and
    // send the user to log in again.
    if (res.status === 401) {
      localStorage.clear();
      window.location.href = "login.html";
      return false;
    }
    if (!res.ok) throw new Error(`Server responded with ${res.status}`);
    return true;
  } catch (err) {
    // FIX: previously this caught BOTH an invalid token AND a network/server
    // error (server down, no internet, CORS issue) and treated them
    // identically — wiping a perfectly valid login because the server was
    // briefly unreachable. Now we only log the user out for an actual auth
    // failure (handled above) and show a recoverable error otherwise.
    document.body.innerHTML = `
      <div style="padding:40px;font-family:sans-serif;color:#f0ebe0;background:#05080f;min-height:100vh">
        <strong>Could not reach the server:</strong> ${err.message}
        <br><br>Check that the server is running and you're online, then
        <a href="#" onclick="location.reload()" style="color:#c9a84c">try again</a>.
      </div>`;
    return false;
  }
}

/* ─── INIT ─── */
const urlParams = new URLSearchParams(window.location.search);
const tripId    = urlParams.get("id");

if (!tripId) {
  window.location.href = "index.html";
}

async function loadTrip() {
  try {
    const res = await fetch(`${API}/trips/${tripId}`, {
      headers: addAuthHeader(),
    });
    if (!res.ok) throw new Error("Trip not found");
    currentTrip = await res.json();
    render();
  } catch (err) {
    document.body.innerHTML = `
      <div style="padding:40px;font-family:sans-serif;color:#f0ebe0;background:#05080f;min-height:100vh">
        <strong>Error loading trip:</strong> ${err.message}
        <br><br><a href="index.html" style="color:#c9a84c">← Back to trips</a>
      </div>`;
  }
}

function render() {
  document.title = `${currentTrip.name} — TripX`;
  renderHeader();
  renderTripStats();
  renderMembers();
  renderExpenses();
  renderBalances();
  renderSettlements();
}

/* ─── HEADER ─── */
function renderHeader() {
  const el = document.getElementById("tripHeader");
  if (!el) return;
  el.innerHTML = `
    <h1>${esc(currentTrip.name)}</h1>
    <p>${currentTrip.destination ? "📍 " + esc(currentTrip.destination) : "No destination set"}</p>
  `;
}

/* ─── MEMBERS ─── */
function renderMembers() {
  const el = document.getElementById("membersList");
  if (!el) return;
  if (!(currentTrip.members || []).length) {
    el.innerHTML = "<p style='opacity:0.5'>No members yet. Add one to get started.</p>";
    return;
  }
  el.innerHTML = (currentTrip.members || []).map((m, i) => {
    const c    = AVATAR_COLORS[i % AVATAR_COLORS.length];
    const init = m.name.split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 2);
    return `
      <div style="display:flex;align-items:center;gap:10px;padding:8px;border-radius:8px;background:rgba(255,255,255,0.02);margin-bottom:6px">
        <div style="width:32px;height:32px;border-radius:50%;background:${c}20;color:${c};display:flex;align-items:center;justify-content:center;font-weight:700;font-size:.7rem;flex-shrink:0">${init}</div>
        <span>${esc(m.name)}</span>
        <button onclick="deleteMember('${m._id}')" style="margin-left:auto;background:none;border:none;color:var(--coral);cursor:pointer;font-size:.9rem;padding:4px 8px;border-radius:4px;transition:.2s" title="Remove member">✕</button>
      </div>
    `;
  }).join("");
}

async function addMember() {
  const name = prompt("Enter member name:");
  if (!name || !name.trim()) return;
  try {
    const r = await fetch(`${API}/trips/${tripId}/members`, {
      method: "POST",
      headers: addAuthHeader(),
      body: JSON.stringify({ name: name.trim() }),
    });
    if (!r.ok) {
      const err = await r.json();
      throw new Error(err.error || "Failed to add member");
    }
    currentTrip = await r.json();
    renderMembers();
    renderBalances();
    renderSettlements();
    toast("Member added", "success");
  } catch (err) {
    toast(err.message || "Failed to add member", "error");
  }
}

async function deleteMember(id) {
  if (!confirm("Remove this member?")) return;
  try {
    const r = await fetch(`${API}/trips/${tripId}/members/${id}`, {
      method: "DELETE",
      headers: addAuthHeader(),
    });
    if (!r.ok) {
      const err = await r.json();
      throw new Error(err.error || "Failed to remove member");
    }
    currentTrip = await r.json();
    renderMembers();
    renderBalances();
    renderSettlements();
    toast("Member removed", "success");
  } catch (err) {
    toast(err.message || "Failed to remove member", "error");
  }
}

/* ─── EXPENSES ─── */
function renderExpenses() {
  const el = document.getElementById("expensesList");
  if (!el) return;
  if (!(currentTrip.expenses || []).length) {
    el.innerHTML = "<p style='opacity:0.5'>No expenses yet. Add the first one!</p>";
    return;
  }
  el.innerHTML = (currentTrip.expenses || []).map(e => `
    <div style="padding:12px;border:1px solid rgba(255,255,255,0.1);border-radius:8px;display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
      <div>
        <div style="font-weight:600">${esc(e.title)}</div>
        <div style="font-size:.8rem;opacity:0.6">Paid by ${esc(e.paidBy)}</div>
        ${e.notes ? `<div style="font-size:.75rem;opacity:0.45;margin-top:2px">${esc(e.notes)}</div>` : ""}
      </div>
      <div style="text-align:right;flex-shrink:0;margin-left:12px">
        <div style="font-weight:700">₹${fmt(e.amount)}</div>
        <button onclick="deleteExpense('${e._id}')" style="margin-top:4px;background:none;border:none;color:var(--coral);cursor:pointer;font-size:.8rem;padding:2px 6px">Delete</button>
      </div>
    </div>
  `).join("");
}

async function addExpense() {
  const members = (currentTrip.members || []);
  if (!members.length) {
    toast("Add at least one member before adding an expense.", "error");
    return;
  }

  const title = prompt("Expense title:");
  if (!title || !title.trim()) return;

  const amountStr = prompt("Amount (₹):");
  if (!amountStr) return;
  const amount = parseFloat(amountStr);
  if (isNaN(amount) || amount <= 0) { toast("Enter a valid amount.", "error"); return; }

  const memberNames = members.map(m => m.name);
  const memberList = memberNames.join(", ");
  const paidByInput = prompt(`Paid by (choose one: ${memberList}):`, memberNames[0] || "");
  if (!paidByInput || !paidByInput.trim()) return;

  const paidBy = findMemberName(memberNames, paidByInput);
  if (!paidBy) {
    toast("Paid by must match one of the trip members.", "error");
    return;
  }

  try {
    const r = await fetch(`${API}/trips/${tripId}/expenses`, {
      method: "POST",
      headers: addAuthHeader(),
      body: JSON.stringify({
        title: title.trim(),
        amount,
        paidBy,
        membersInvolved: memberNames,
      }),
    });
    if (!r.ok) {
      const err = await r.json();
      throw new Error(err.error || "Failed to add expense");
    }
    currentTrip = await r.json();
    renderExpenses();
    renderTripStats();
    renderBalances();
    renderSettlements();
    toast("Expense added", "success");
  } catch (err) {
    toast(err.message || "Failed to add expense", "error");
  }
}

function findMemberName(memberNames, input) {
  const normalizedInput = String(input || "").trim().toLowerCase();
  return memberNames.find((name) => name.trim().toLowerCase() === normalizedInput) || null;
}

async function deleteExpense(id) {
  if (!confirm("Delete this expense?")) return;
  try {
    const r = await fetch(`${API}/trips/${tripId}/expenses/${id}`, {
      method: "DELETE",
      headers: addAuthHeader(),
    });
    if (!r.ok) {
      const err = await r.json();
      throw new Error(err.error || "Failed to delete expense");
    }
    currentTrip = await r.json();
    renderExpenses();
    renderTripStats();
    renderBalances();
    renderSettlements();
    toast("Expense deleted", "success");
  } catch (err) {
    toast(err.message || "Failed to delete expense", "error");
  }
}

/* ─── TRIP STATS ─── */
function renderTripStats() {
  // FIX: target the correct element — section body inside #tripStats card
  const el = document.getElementById("tripStats");
  if (!el) return;
  const budget  = currentTrip.budget || 0;
  const spent   = (currentTrip.expenses || []).reduce((s, e) => s + e.amount, 0);
  const pct     = budget > 0 ? Math.min(Math.round((spent / budget) * 100), 100) : 0;
  const over    = budget > 0 && spent > budget;
  const members = (currentTrip.members || []).length;
  const expenses = (currentTrip.expenses || []).length;

  el.innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px">
      <div style="padding:12px;border:1px solid rgba(255,255,255,0.1);border-radius:8px">
        <div style="opacity:0.6;font-size:.8rem;margin-bottom:4px">Budget</div>
        <div style="font-size:1.3rem;font-weight:700;color:var(--gold)">₹${fmt(budget)}</div>
      </div>
      <div style="padding:12px;border:1px solid rgba(255,255,255,0.1);border-radius:8px">
        <div style="opacity:0.6;font-size:.8rem;margin-bottom:4px">Spent</div>
        <div style="font-size:1.3rem;font-weight:700;color:${over ? "var(--coral)" : "var(--teal)"}">₹${fmt(spent)}</div>
      </div>
      <div style="padding:12px;border:1px solid rgba(255,255,255,0.1);border-radius:8px">
        <div style="opacity:0.6;font-size:.8rem;margin-bottom:4px">Remaining</div>
        <div style="font-size:1.3rem;font-weight:700;color:${over ? "var(--coral)" : "var(--paper)"}">
          ${budget > 0 ? (over ? "-₹" + fmt(spent - budget) : "₹" + fmt(budget - spent)) : "—"}
        </div>
      </div>
      <div style="padding:12px;border:1px solid rgba(255,255,255,0.1);border-radius:8px">
        <div style="opacity:0.6;font-size:.8rem;margin-bottom:4px">Members</div>
        <div style="font-size:1.3rem;font-weight:700">${members}</div>
      </div>
      <div style="padding:12px;border:1px solid rgba(255,255,255,0.1);border-radius:8px">
        <div style="opacity:0.6;font-size:.8rem;margin-bottom:4px">Expenses</div>
        <div style="font-size:1.3rem;font-weight:700">${expenses}</div>
      </div>
    </div>
    ${budget > 0 ? `
    <div style="margin-top:14px">
      <div style="display:flex;justify-content:space-between;font-size:.78rem;opacity:0.5;margin-bottom:5px">
        <span>Budget used</span><span>${pct}%</span>
      </div>
      <div style="height:5px;background:rgba(255,255,255,.07);border-radius:999px;overflow:hidden">
        <div style="height:100%;width:${pct}%;background:${over ? "var(--coral)" : "linear-gradient(90deg,var(--gold),var(--teal))"};border-radius:999px;transition:width .6s ease"></div>
      </div>
    </div>` : ""}
  `;
}

/* ─── BALANCES ─── */
function computeBalances() {
  const bal = {};
  (currentTrip.members || []).forEach(m => { bal[m.name] = { paid: 0, owes: 0 }; });
  (currentTrip.expenses || []).forEach(e => {
    const amt    = e.amount;
    const paidBy = e.paidBy;
    if (!bal[paidBy]) bal[paidBy] = { paid: 0, owes: 0 };
    bal[paidBy].paid += amt;
    const involved = (e.membersInvolved && e.membersInvolved.length) ? e.membersInvolved : [paidBy];
    const share    = amt / involved.length;
    involved.forEach(n => {
      if (!bal[n]) bal[n] = { paid: 0, owes: 0 };
      bal[n].owes += share;
    });
  });
  return bal;
}

function renderBalances() {
  const el = document.getElementById("balancesList");
  if (!el) return;
  const bal = computeBalances();
  if (!Object.keys(bal).length) {
    el.innerHTML = "<p style='opacity:0.5'>Add members to see balances.</p>";
    return;
  }
  el.innerHTML = Object.entries(bal).map(([name, { paid, owes }]) => {
    const balance = Math.round((paid - owes) * 100) / 100;
    const color   = balance > 0.01 ? "var(--teal)" : balance < -0.01 ? "#ff8a70" : "var(--muted)";
    const label   = balance > 0.01 ? `+₹${fmt(balance)}` : balance < -0.01 ? `-₹${fmt(Math.abs(balance))}` : "✓ Settled";
    return `
      <div style="padding:12px;border:1px solid rgba(255,255,255,0.1);border-radius:8px;margin-bottom:8px">
        <div style="font-weight:600">${esc(name)}</div>
        <div style="font-size:.82rem;opacity:0.55;margin:4px 0">Paid: ₹${fmt(paid)} &nbsp;|&nbsp; Owes: ₹${fmt(owes)}</div>
        <div style="font-weight:700;color:${color}">${label}</div>
      </div>`;
  }).join("");
}

/* ─── SETTLEMENTS ─── */
function renderSettlements() {
  const el = document.getElementById("settleList");
  if (!el) return;
  const bal = computeBalances();

  const debtors   = [];
  const creditors = [];
  Object.entries(bal).forEach(([name, { paid, owes }]) => {
    const balance = paid - owes;
    if (balance < -0.01) debtors.push({ name, amount: -balance });
    if (balance > 0.01)  creditors.push({ name, amount: balance });
  });

  debtors.sort((a, b) => b.amount - a.amount);
  creditors.sort((a, b) => b.amount - a.amount);

  const settlements = [];
  let di = 0, ci = 0;
  // Work on copies so we don't mutate the sorted arrays
  const d = debtors.map(x => ({ ...x }));
  const c = creditors.map(x => ({ ...x }));

  while (di < d.length && ci < c.length) {
    const pay = Math.min(d[di].amount, c[ci].amount);
    if (pay > 0.01) {
      settlements.push({ from: d[di].name, to: c[ci].name, amount: Math.round(pay * 100) / 100 });
      d[di].amount -= pay;
      c[ci].amount -= pay;
    }
    if (d[di].amount < 0.01) di++;
    if (c[ci].amount < 0.01) ci++;
  }

  if (!settlements.length) {
    el.innerHTML = "<p style='opacity:0.5'>All settled! 🎉</p>";
    return;
  }
  el.innerHTML = settlements.map(s => `
    <div style="padding:12px;border:1px solid rgba(255,255,255,0.1);border-radius:8px;display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:8px;flex-wrap:wrap">
      <span style="font-weight:600">${esc(s.from)}</span>
      <span style="opacity:0.5;font-size:.8rem">pays →</span>
      <span style="font-weight:600">${esc(s.to)}</span>
      <span style="font-weight:700;color:var(--gold);margin-left:auto">₹${fmt(s.amount)}</span>
    </div>
  `).join("");
}

/* ─── UTILITIES ─── */
function fmt(n) {
  return Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 });
}

function esc(s) {
  const d = document.createElement("div");
  d.textContent = s || "";
  return d.innerHTML;
}

function toast(msg, type = "success") {
  let wrap = document.getElementById("toastContainer");
  if (!wrap) {
    wrap = document.createElement("div");
    wrap.id = "toastContainer";
    wrap.style.cssText = "position:fixed;bottom:20px;right:20px;z-index:9999;display:flex;flex-direction:column;gap:10px";
    document.body.appendChild(wrap);
  }
  const el = document.createElement("div");
  el.style.cssText = `background:#0d1a28;border:1px solid rgba(255,255,255,0.1);border-radius:8px;padding:12px 16px;color:${type === "success" ? "#4ecdc4" : "#ff8a70"};font-size:0.85rem;min-width:200px;animation:toastIn .3s ease`;
  el.textContent = (type === "success" ? "✓ " : "⚠ ") + msg;
  wrap.appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

/* ─── BOOT ─── */
window.addEventListener("load", async () => {
  const auth = await checkAuth();
  if (auth) loadTrip();
});
