// Small dependency-free SVG line charts: a sparkline for each row and a detail chart with a crosshair.
const NS = "http://www.w3.org/2000/svg";
const el = (tag, attrs = {}) => {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  return n;
};
const UP = "var(--green)";
const DOWN = "var(--red)";

function scale(points, w, h, pad, extra = []) {
  const ps = points.map((p) => p[1]).concat(extra.filter((v) => typeof v === "number"));
  let lo = Math.min(...ps);
  let hi = Math.max(...ps);
  if (hi === lo) { hi += 1; lo -= 1; }
  const m = (hi - lo) * 0.08;
  lo -= m; hi += m;
  // Index-based x so overnight and weekend gaps don't leave empty stretches.
  const x = (i) => pad.l + (i / (points.length - 1)) * (w - pad.l - pad.r);
  const y = (v) => pad.t + (1 - (v - lo) / (hi - lo)) * (h - pad.t - pad.b);
  return { x, y, lo, hi };
}

const pathFor = (points, s) =>
  points.map((p, i) => `${i ? "L" : "M"}${s.x(i).toFixed(1)},${s.y(p[1]).toFixed(1)}`).join("");

/** Tiny trend line for a watchlist row. */
export function sparkline(points, baseline) {
  const w = 72, h = 32;
  const svg = el("svg", { viewBox: `0 0 ${w} ${h}`, width: w, height: h, "aria-hidden": "true", class: "spark" });
  if (!points || points.length < 2) return svg;
  const ref = baseline ?? points[0][1];
  const s = scale(points, w, h, { l: 1, r: 1, t: 3, b: 3 }, [ref]);
  const last = points[points.length - 1][1];
  svg.append(el("line", { x1: 0, x2: w, y1: s.y(ref), y2: s.y(ref), class: "baseline" }));
  svg.append(el("path", {
    d: pathFor(points, s), fill: "none", stroke: last >= ref ? UP : DOWN,
    "stroke-width": 1.5, "stroke-linejoin": "round", "stroke-linecap": "round",
  }));
  return svg;
}

const money = (v) => `$${v.toFixed(2)}`;

function fmtTime(t, range) {
  const d = new Date(t * 1000);
  if (range === "1D") return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (range === "5D") return d.toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" });
  return d.toLocaleDateString([], { month: "short", day: "numeric", year: range === "1Y" ? "2-digit" : undefined });
}

/**
 * Detail chart with reference lines and a crosshair tooltip.
 * refs: [{ value, label, kind: "prev" | "alert" }]
 */
export function detailChart(container, points, { range, baseline, refs = [] }) {
  container.textContent = "";
  const w = Math.max(280, container.clientWidth || 320), h = 190;
  const pad = { l: 4, r: 56, t: 14, b: 22 };
  const s = scale(points, w, h, pad, refs.map((r) => r.value));
  const ref = baseline ?? points[0][1];
  const last = points[points.length - 1][1];
  const color = last >= ref ? UP : DOWN;

  const svg = el("svg", {
    viewBox: `0 0 ${w} ${h}`, width: "100%", height: h, class: "chart", role: "img",
    "aria-label": `${range} price chart, from ${money(points[0][1])} to ${money(last)}`,
  });

  // Recessive grid with price labels on the right.
  for (let i = 0; i < 3; i++) {
    const v = s.lo + ((s.hi - s.lo) * (i + 0.5)) / 3;
    svg.append(el("line", { x1: pad.l, x2: w - pad.r, y1: s.y(v), y2: s.y(v), class: "grid" }));
    const t = el("text", { x: w - pad.r + 6, y: s.y(v) + 4, class: "axis" });
    t.textContent = money(v);
    svg.append(t);
  }
  // Start and end time labels.
  for (const [i, anchor] of [[0, "start"], [points.length - 1, "end"]]) {
    const t = el("text", { x: s.x(i), y: h - 6, class: "axis", "text-anchor": anchor });
    t.textContent = fmtTime(points[i][0], range);
    svg.append(t);
  }
  // Reference lines: previous close and alert level.
  for (const r of refs) {
    if (typeof r.value !== "number") continue;
    svg.append(el("line", { x1: pad.l, x2: w - pad.r, y1: s.y(r.value), y2: s.y(r.value), class: `ref ${r.kind}` }));
    const t = el("text", { x: pad.l + 4, y: s.y(r.value) - 4, class: "reflabel" });
    t.textContent = `${r.label} ${money(r.value)}`;
    svg.append(t);
  }
  // Soft area under a 2px line.
  const line = pathFor(points, s);
  const gid = `g${Math.random().toString(36).slice(2)}`;
  const grad = el("linearGradient", { id: gid, x1: 0, x2: 0, y1: 0, y2: 1 });
  grad.append(el("stop", { offset: "0%", "stop-color": color, "stop-opacity": 0.22 }));
  grad.append(el("stop", { offset: "100%", "stop-color": color, "stop-opacity": 0 }));
  const defs = el("defs");
  defs.append(grad);
  svg.append(defs);
  svg.append(el("path", { d: `${line}L${s.x(points.length - 1)},${h - pad.b}L${s.x(0)},${h - pad.b}Z`, fill: `url(#${gid})` }));
  svg.append(el("path", { d: line, fill: "none", stroke: color, "stroke-width": 2, "stroke-linejoin": "round", "stroke-linecap": "round" }));

  // Crosshair, dot and tooltip.
  const hair = el("line", { y1: pad.t, y2: h - pad.b, class: "hair", visibility: "hidden" });
  const dot = el("circle", { r: 4.5, fill: color, stroke: "var(--card)", "stroke-width": 2, visibility: "hidden" });
  const hit = el("rect", { x: 0, y: 0, width: w, height: h, fill: "transparent", tabindex: 0 });
  svg.append(hair, dot, hit);
  container.append(svg);

  const tip = document.createElement("div");
  tip.className = "tip";
  tip.hidden = true;
  const tipValue = document.createElement("strong");
  const tipTime = document.createElement("span");
  tip.append(tipValue, tipTime);
  container.append(tip);

  let current = points.length - 1;
  const show = (i) => {
    current = Math.max(0, Math.min(points.length - 1, i));
    const [t, p] = points[current];
    const cx = s.x(current), cy = s.y(p);
    hair.setAttribute("x1", cx); hair.setAttribute("x2", cx);
    dot.setAttribute("cx", cx); dot.setAttribute("cy", cy);
    hair.setAttribute("visibility", "visible"); dot.setAttribute("visibility", "visible");
    const chg = ((p - ref) / ref) * 100;
    tipValue.textContent = `${money(p)} ${chg >= 0 ? "+" : ""}${chg.toFixed(2)}%`;
    tipTime.textContent = fmtTime(t, range);
    tip.hidden = false;
    const px = cx * (container.clientWidth / w);
    tip.style.left = `${Math.min(Math.max(px, 80), container.clientWidth - 80)}px`;
  };
  const hide = () => {
    tip.hidden = true;
    hair.setAttribute("visibility", "hidden");
    dot.setAttribute("visibility", "hidden");
  };
  const indexAt = (clientX) => {
    const box = svg.getBoundingClientRect();
    const x = ((clientX - box.left) / box.width) * w;
    return Math.round(((x - pad.l) / (w - pad.l - pad.r)) * (points.length - 1));
  };
  hit.addEventListener("pointermove", (e) => show(indexAt(e.clientX)));
  hit.addEventListener("pointerdown", (e) => show(indexAt(e.clientX)));
  hit.addEventListener("pointerleave", hide);
  hit.addEventListener("focus", () => show(points.length - 1));
  hit.addEventListener("blur", hide);
  hit.addEventListener("keydown", (e) => {
    if (e.key === "ArrowLeft") { show(current - 1); e.preventDefault(); }
    if (e.key === "ArrowRight") { show(current + 1); e.preventDefault(); }
  });
}
