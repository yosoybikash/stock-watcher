const $ = (id) => document.getElementById(id);
let token = localStorage.getItem("token") || "";
let watchlist = [];

function toast(msg) {
  const el = $("toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toast.t);
  toast.t = setTimeout(() => el.classList.remove("show"), 3000);
}

async function api(path, { method = "GET", body } = {}) {
  const res = await fetch(path, {
    method,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) { showLogin(); throw new Error("Please sign in"); }
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

function showLogin() {
  $("login").hidden = false;
  $("app").hidden = true;
}

async function showApp() {
  $("login").hidden = true;
  $("app").hidden = false;
  await Promise.all([loadQuotes(), updateNotifyUi()]);
}

function render(quotes) {
  const list = $("list");
  list.innerHTML = "";
  for (const q of quotes) {
    const li = document.createElement("li");
    const hasPrice = typeof q.price === "number";
    const chg = hasPrice ? q.change : 0;
    const alerting = hasPrice && chg <= -q.dropPercent;
    li.innerHTML = `
      <div><span class="sym"></span>${alerting ? '<span class="alerting">ALERT</span>' : ""}<div class="sub">Alert at −${q.dropPercent}%</div></div>
      <div class="price">${hasPrice ? `$${q.price.toFixed(2)}<div class="chg ${chg < 0 ? "down" : "up"}">${chg >= 0 ? "+" : ""}${chg.toFixed(2)}%</div>` : `<span class="muted small">${q.error ? "No data" : "…"}</span>`}</div>
      <button class="icon" aria-label="Remove">✕</button>`;
    li.querySelector(".sym").textContent = q.symbol;
    li.querySelector("button").onclick = () => saveWatchlist(watchlist.filter((w) => w.symbol !== q.symbol));
    list.appendChild(li);
  }
}

async function loadQuotes() {
  try {
    watchlist = await api("/api/watchlist");
    render(watchlist);
    const { marketOpen, quotes } = await api("/api/quotes");
    const m = $("market");
    m.textContent = marketOpen ? "Market open" : "Market closed";
    m.classList.toggle("open", marketOpen);
    render(quotes);
  } catch (err) { toast(err.message); }
}

async function saveWatchlist(list) {
  try {
    watchlist = await api("/api/watchlist", { method: "PUT", body: list });
    await loadQuotes();
  } catch (err) { toast(err.message); }
}

// ---- Push notifications ----
const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
const isStandalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone;

function urlBase64ToUint8Array(base64) {
  const padded = (base64 + "=".repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

async function currentSubscription() {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return null;
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager.getSubscription();
}

async function updateNotifyUi() {
  const status = $("notify-status");
  const btn = $("notify-btn");
  $("ios-hint").hidden = !(isIos && !isStandalone);
  if (!("PushManager" in window)) {
    status.textContent = isIos ? "Add to Home Screen first (see below)." : "This browser doesn't support push.";
    btn.hidden = true;
    return;
  }
  const sub = await currentSubscription();
  btn.hidden = false;
  if (Notification.permission === "denied") {
    status.textContent = "Notifications are blocked in settings.";
    btn.hidden = true;
  } else if (sub) {
    status.textContent = "On for this device.";
    btn.textContent = "Turn off";
  } else {
    status.textContent = "Off for this device.";
    btn.textContent = "Turn on";
  }
}

async function toggleNotifications() {
  try {
    const existing = await currentSubscription();
    if (existing) {
      await api("/api/unsubscribe", { method: "POST", body: { endpoint: existing.endpoint } });
      await existing.unsubscribe();
      toast("Alerts turned off on this device");
    } else {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") throw new Error("Notification permission not granted");
      const { vapidPublicKey } = await fetch("/api/config").then((r) => r.json());
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(vapidPublicKey) });
      await api("/api/subscribe", { method: "POST", body: sub.toJSON() });
      toast("Alerts turned on");
    }
  } catch (err) { toast(err.message); }
  await updateNotifyUi();
}

// ---- Wire up ----
$("login-form").onsubmit = async (e) => {
  e.preventDefault();
  token = $("token").value.trim();
  localStorage.setItem("token", token);
  try { await api("/api/watchlist"); await showApp(); } catch (err) { toast(err.message); }
};
$("add-form").onsubmit = (e) => {
  e.preventDefault();
  const symbol = $("add-symbol").value.trim().toUpperCase();
  const dropPercent = Number($("add-drop").value);
  $("add-symbol").value = "";
  saveWatchlist([...watchlist.filter((w) => w.symbol !== symbol), { symbol, dropPercent }]);
};
$("notify-btn").onclick = toggleNotifications;
$("refresh-btn").onclick = loadQuotes;
$("test-btn").onclick = async () => {
  try {
    const { delivered } = await api("/api/test-alert", { method: "POST" });
    toast(delivered ? `Test sent to ${delivered} device(s)` : "No devices have alerts turned on yet");
  } catch (err) { toast(err.message); }
};

if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js");
if (token) showApp(); else showLogin();
setInterval(() => { if (!document.hidden && token) loadQuotes(); }, 60_000);
