import { sparkline, detailChart } from "/chart.js";

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

// ---- Charts ----
let chartCache = new Map(); // "SYM|RANGE" -> { points, previousClose, source }
let openSymbol = null;
let openRange = "1D";
let lastQuotes = [];

async function getHistory(symbol, range) {
  const key = `${symbol}|${range}`;
  if (!chartCache.has(key)) {
    chartCache.set(key, api(`/api/history?symbol=${encodeURIComponent(symbol)}&range=${range}`));
  }
  try {
    return await chartCache.get(key);
  } catch (err) {
    chartCache = new Map([...chartCache].filter(([k]) => k !== key)); // allow retry
    throw err;
  }
}

async function fillSparkline(holder, q) {
  try {
    const h = await getHistory(q.symbol, "1D");
    holder.replaceChildren(sparkline(h.points, h.previousClose ?? q.previousClose));
  } catch { /* leave empty */ }
}

async function renderDetail(detail, q) {
  const plot = detail.querySelector(".plot");
  const period = detail.querySelector(".period");
  const source = detail.querySelector(".source");
  detail.querySelectorAll(".ranges button").forEach((b) => b.classList.toggle("on", b.dataset.range === openRange));
  plot.classList.add("loading");
  try {
    const h = await getHistory(q.symbol, openRange);
    const isDay = openRange === "1D";
    const prev = isDay ? (h.previousClose ?? q.previousClose) : null;
    const pts = h.points.slice();
    // End the 1-day line at the latest quote so it matches the price in the row.
    const lastT = pts[pts.length - 1][0];
    if (isDay && typeof q.price === "number" && pts[pts.length - 1][1] !== q.price && q.time && q.time > lastT) {
      pts.push([q.time, q.price]);
    }
    const base = prev ?? pts[0][1];
    const refs = isDay && prev ? [
      { value: prev, label: "Prev close", kind: "prev" },
      { value: prev * (1 - q.dropPercent / 100), label: `Alert −${q.dropPercent}%`, kind: "alert" },
    ] : [];
    detailChart(plot, pts, { range: openRange, baseline: base, refs });
    const chg = ((pts[pts.length - 1][1] - base) / base) * 100;
    period.textContent = `${chg >= 0 ? "+" : ""}${chg.toFixed(2)}% ${isDay ? "today" : `over ${openRange}`}`;
    period.className = `period ${chg < 0 ? "down" : "up"}`;
    source.textContent = h.source === "recorded" ? "Prices recorded by this app every 5 minutes" : "";
  } catch (err) {
    plot.replaceChildren(Object.assign(document.createElement("div"), { className: "msg", textContent: err.message }));
    period.textContent = "";
  } finally {
    plot.classList.remove("loading");
  }
}

function buildDetail(q) {
  const detail = document.createElement("li");
  detail.className = "detail";
  const ranges = document.createElement("div");
  ranges.className = "ranges";
  for (const r of ["1D", "5D", "1M", "6M", "1Y"]) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = r;
    b.dataset.range = r;
    b.onclick = () => { openRange = r; renderDetail(detail, q); };
    ranges.append(b);
  }
  const period = document.createElement("span");
  period.className = "period";
  ranges.append(period);
  const plot = document.createElement("div");
  plot.className = "plot";
  const source = document.createElement("div");
  source.className = "source";
  detail.append(ranges, plot, source);
  return detail;
}

function render(quotes) {
  lastQuotes = quotes;
  const list = $("list");
  list.innerHTML = "";
  for (const q of quotes) {
    const li = document.createElement("li");
    const hasPrice = typeof q.price === "number";
    const chg = hasPrice ? q.change : 0;
    const alerting = hasPrice && chg <= -q.dropPercent;
    li.innerHTML = `
      <div><span class="sym"></span>${alerting ? '<span class="alerting">ALERT</span>' : ""}<div class="sub">Alert at −${q.dropPercent}%</div></div>
      <div class="sparkholder"></div>
      <div class="price">${hasPrice ? `$${q.price.toFixed(2)}<div class="chg ${chg < 0 ? "down" : "up"}">${chg >= 0 ? "+" : ""}${chg.toFixed(2)}%</div>` : `<span class="muted small">${q.error ? "No data" : "…"}</span>`}</div>
      <button class="icon" aria-label="Remove">✕</button>`;
    li.querySelector(".sym").textContent = q.symbol;
    li.querySelector("button").onclick = (e) => {
      e.stopPropagation();
      saveWatchlist(watchlist.filter((w) => w.symbol !== q.symbol));
    };
    li.onclick = () => {
      openSymbol = openSymbol === q.symbol ? null : q.symbol;
      openRange = "1D";
      render(lastQuotes);
    };
    list.appendChild(li);
    if (hasPrice) fillSparkline(li.querySelector(".sparkholder"), q);
    if (openSymbol === q.symbol) {
      li.classList.add("open");
      const detail = buildDetail(q);
      list.appendChild(detail);
      renderDetail(detail, q);
    }
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
    // New quotes: refresh the 1-day charts, keep longer ranges cached.
    chartCache = new Map([...chartCache].filter(([k]) => !k.endsWith("|1D")));
    render(quotes);
    const latest = Math.max(0, ...quotes.map((q) => q.time || 0));
    $("asof").textContent = latest
      ? `${marketOpen ? "Last trade" : "Closing price"} · ${new Date(latest * 1000).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" })}`
      : "";
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
