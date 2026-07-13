/* Goldlocker — Kothamangalam gold rate tracker
   Plain JS, no build step. State lives in localStorage. */

(function () {
  "use strict";

  // ---------- Constants ----------

  const STORAGE = {
    history: "gl_history_v1",
    bookings: "gl_bookings_v1",
    settings: "gl_settings_v1",
  };

  const CARATS = ["24K", "22K", "18K"];
  const PURITY = { "24K": 1, "22K": 0.916, "18K": 0.750 };
  const GRAMS_PER_PAVAN = 8;

  // Booking-derived anchor for the 24K base rate, used for synthetic seeding
  // and as a network-failure fallback: 22K purchase rate (₹13,230/g) / 0.916 purity.
  const ANCHOR_24K_INR = 13230 / 0.916;

  const XAU_API = "https://api.gold-api.com/price/XAU";
  const FX_API = "https://open.er-api.com/v6/latest/USD";
  const OZ_TO_GRAM = 31.1035;

  const DEFAULT_SETTINGS = {
    activeCarat: "22K",
    premiumFactor: 1.0,
    lastPanikooli: 10,
    lastGst: 3,
    alertCarat: null,
    alertThreshold: null,
    alertFiredKey: null, // `${date}:${threshold}` — prevents renotifying same day/threshold
  };

  const SEED_BOOKING = {
    id: "seed-bablooseee",
    name: "Bablooseee Gift",
    date: "2026-07-11",
    weight: 4.0,
    carat: "22K",
    amount: 52920,
    rate: 13230, // amount / weight, stored explicitly
    panikooli: 10,
    gst: 3,
  };

  // ---------- Small utilities ----------

  function todayKey(d) {
    d = d || new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  function addDays(dateKey, delta) {
    const [y, m, d] = dateKey.split("-").map(Number);
    const dt = new Date(y, m - 1, d);
    dt.setDate(dt.getDate() + delta);
    return todayKey(dt);
  }

  function inr(n, decimals) {
    if (n === null || n === undefined || isNaN(n)) return "--";
    const opts = { maximumFractionDigits: decimals || 0, minimumFractionDigits: decimals || 0 };
    return "₹" + Number(n).toLocaleString("en-IN", opts);
  }

  function round0(n) {
    return Math.round(n);
  }

  function pct(n, decimals) {
    if (n === null || n === undefined || isNaN(n)) return "--";
    const sign = n > 0 ? "+" : "";
    return `${sign}${n.toFixed(decimals === undefined ? 2 : decimals)}%`;
  }

  function randRange(min, max) {
    return min + Math.random() * (max - min);
  }

  function formatTime(d) {
    return d.toLocaleString("en-IN", {
      day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
    });
  }

  // ---------- Persistence ----------

  function loadSettings() {
    try {
      const raw = localStorage.getItem(STORAGE.settings);
      if (!raw) return { ...DEFAULT_SETTINGS };
      return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
    } catch (e) {
      return { ...DEFAULT_SETTINGS };
    }
  }

  function saveSettings(s) {
    localStorage.setItem(STORAGE.settings, JSON.stringify(s));
  }

  function loadHistory() {
    try {
      const raw = localStorage.getItem(STORAGE.history);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      return [];
    }
  }

  function saveHistory(h) {
    localStorage.setItem(STORAGE.history, JSON.stringify(h));
  }

  function loadBookings() {
    try {
      const raw = localStorage.getItem(STORAGE.bookings);
      if (!raw) return [{ ...SEED_BOOKING }];
      return JSON.parse(raw);
    } catch (e) {
      return [{ ...SEED_BOOKING }];
    }
  }

  function saveBookings(b) {
    localStorage.setItem(STORAGE.bookings, JSON.stringify(b));
  }

  // ---------- State ----------

  let settings = loadSettings();
  let history = loadHistory(); // [{date, rates:{24K,22K,18K}, synthetic:bool}], ascending by date
  let bookings = loadBookings();
  let trendChart = null;
  const sparklineCharts = {};

  // ---------- Rate math ----------

  function deriveCaratRates(rate24K_INR, premiumFactor) {
    const out = {};
    CARATS.forEach((c) => {
      out[c] = rate24K_INR * PURITY[c] * premiumFactor;
    });
    return out;
  }

  function upsertSnapshot(dateKey, rates, synthetic) {
    const idx = history.findIndex((h) => h.date === dateKey);
    const entry = { date: dateKey, rates, synthetic: !!synthetic };
    if (idx >= 0) history[idx] = entry;
    else history.push(entry);
    history.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  }

  function seedHistoryIfNeeded(todayRate24K) {
    if (history.length > 0) return;
    const days = new Array(30);
    days[29] = todayRate24K;
    for (let i = 28; i >= 0; i--) {
      const deltaPct = randRange(0.5, 1.5) / 100 * (Math.random() < 0.5 ? -1 : 1);
      days[i] = days[i + 1] / (1 + deltaPct);
    }
    const today = todayKey();
    for (let i = 0; i < 30; i++) {
      const offset = i - 29; // -29 .. 0
      const dateKey = addDays(today, offset);
      const rates = deriveCaratRates(days[i], settings.premiumFactor);
      upsertSnapshot(dateKey, rates, offset !== 0);
    }
    saveHistory(history);
  }

  function getSortedHistory() {
    return history.slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  }

  function trailingDays(n) {
    const h = getSortedHistory();
    return h.slice(Math.max(0, h.length - n));
  }

  function latestSnapshot() {
    const h = getSortedHistory();
    return h.length ? h[h.length - 1] : null;
  }

  function snapshotAtOrBefore(dateKey) {
    const h = getSortedHistory();
    let found = null;
    for (const s of h) {
      if (s.date <= dateKey) found = s;
      else break;
    }
    return found || (h.length ? h[0] : null);
  }

  function rateFor(snapshot, carat) {
    return snapshot ? snapshot.rates[carat] : null;
  }

  function dailyChange(carat) {
    const h = getSortedHistory();
    if (h.length < 2) return { abs: null, pct: null };
    const todayR = rateFor(h[h.length - 1], carat);
    const yestR = rateFor(h[h.length - 2], carat);
    const abs = todayR - yestR;
    const p = (abs / yestR) * 100;
    return { abs, pct: p };
  }

  function periodStats(carat, n) {
    const days = trailingDays(n);
    if (!days.length) return { high: null, low: null, avg: null, changePct: null, days };
    const rates = days.map((d) => rateFor(d, carat));
    const high = Math.max(...rates);
    const low = Math.min(...rates);
    const avg = rates.reduce((a, b) => a + b, 0) / rates.length;
    const changePct = ((rates[rates.length - 1] - rates[0]) / rates[0]) * 100;
    return { high, low, avg, changePct, days };
  }

  function positionInRange(carat) {
    const { high, low } = periodStats(carat, 30);
    const current = rateFor(latestSnapshot(), carat);
    if (high === null || high === low) return 50;
    return ((current - low) / (high - low)) * 100;
  }

  function momentum3Day(carat) {
    const h = getSortedHistory();
    if (h.length < 4) return "flat";
    const today = rateFor(h[h.length - 1], carat);
    const threeAgo = rateFor(h[h.length - 4], carat);
    if (today < threeAgo * 0.999) return "falling";
    if (today > threeAgo * 1.001) return "rising";
    return "flat";
  }

  function computeSignal(carat) {
    const position = positionInRange(carat);
    const momentum = momentum3Day(carat);
    let level, reason;
    if (position <= 30) {
      level = "BUY";
      reason = "near the monthly low";
    } else if (position >= 70) {
      level = "WAIT";
      reason = "near the monthly high";
    } else {
      level = "HOLD";
      reason = "no strong signal, mid-range";
    }
    let label = level;
    if (level === "BUY" && momentum === "falling") {
      label = "BUY — dip in progress";
      reason = "near the monthly low, and still falling over the last 3 days";
    }
    return { level, label, reason, position, momentum };
  }

  // ---------- Live rate fetch ----------

  async function fetchLiveRate24K() {
    try {
      const [xauRes, fxRes] = await Promise.all([
        fetch(XAU_API),
        fetch(FX_API),
      ]);
      if (!xauRes.ok || !fxRes.ok) throw new Error("bad response");
      const xau = await xauRes.json();
      const fx = await fxRes.json();
      const xauUsd = xau.price;
      const usdInr = fx.rates && fx.rates.INR;
      if (!xauUsd || !usdInr) throw new Error("missing fields");
      const rate24K = (xauUsd / OZ_TO_GRAM) * usdInr;
      return { ok: true, rate24K };
    } catch (e) {
      return { ok: false, error: e };
    }
  }

  async function refreshRate(showSpinner) {
    const btn = document.getElementById("refresh-btn");
    if (showSpinner && btn) btn.classList.add("spinning");

    const result = await fetchLiveRate24K();
    let rate24K;
    let synthetic = false;
    if (result.ok) {
      rate24K = result.rate24K;
    } else {
      // Fallback: hold near the anchor / last known rate with a tiny drift so
      // the app remains usable offline or when the free APIs are rate-limited.
      const last = latestSnapshot();
      const base = last ? last.rates["24K"] / settings.premiumFactor : ANCHOR_24K_INR;
      rate24K = base * (1 + randRange(-0.3, 0.3) / 100);
      synthetic = true;
    }

    seedHistoryIfNeeded(rate24K);
    const rates = deriveCaratRates(rate24K, settings.premiumFactor);
    upsertSnapshot(todayKey(), rates, synthetic);
    saveHistory(history);

    if (showSpinner && btn) {
      setTimeout(() => btn.classList.remove("spinning"), 500);
    }

    checkPriceAlert();
    renderAll();
  }

  // ---------- Rendering ----------

  function setActiveCarat(carat) {
    settings.activeCarat = carat;
    saveSettings(settings);
    document.querySelectorAll(".pill").forEach((p) => {
      p.classList.toggle("active", p.dataset.carat === carat);
    });
    renderAll();
  }

  function renderHeader() {
    const onBooking = document.getElementById("screen-booking").classList.contains("active");
    document.getElementById("carat-pills").hidden = onBooking;
    document.getElementById("carat-locked-note").hidden = !onBooking;
  }

  function renderHome() {
    const carat = settings.activeCarat;
    const latest = latestSnapshot();
    const rate = rateFor(latest, carat);

    document.getElementById("home-carat-label").textContent = `${carat} GOLD · KOTHAMANGALAM`;
    document.getElementById("home-rate-gram").textContent = rate ? round0(rate).toLocaleString("en-IN") : "----";
    document.getElementById("home-rate-pavan").textContent = rate ? `${inr(round0(rate * GRAMS_PER_PAVAN))} / pavan (8g)` : "-- / pavan (8g)";

    const change = dailyChange(carat);
    const changeEl = document.getElementById("home-change");
    if (change.abs === null) {
      changeEl.innerHTML = `<span class="change-amount mono">First reading — no change yet</span>`;
    } else {
      const cls = change.abs >= 0 ? "positive" : "negative";
      const arrow = change.abs >= 0 ? "▲" : "▼";
      changeEl.innerHTML = `<span class="change-amount mono ${cls}">${arrow} ${inr(Math.abs(round0(change.abs)))} (${pct(change.pct)}) today</span>`;
    }

    document.getElementById("home-updated").textContent = `as of ${formatTime(new Date())}`;

    const signal = computeSignal(carat);
    const badge = document.getElementById("home-signal-badge");
    badge.textContent = signal.label;
    badge.className = "signal-badge " + signal.level.toLowerCase();
    document.getElementById("home-signal-text").textContent = `${signal.reason} — position ${signal.position.toFixed(0)}% of the month's range`;

    const week = periodStats(carat, 7);
    const month = periodStats(carat, 30);
    document.getElementById("home-week-high").textContent = inr(round0(week.high));
    document.getElementById("home-week-low").textContent = inr(round0(week.low));
    document.getElementById("home-month-high").textContent = inr(round0(month.high));
    document.getElementById("home-month-low").textContent = inr(round0(month.low));

    const tbody = document.getElementById("all-carat-table-body");
    tbody.innerHTML = CARATS.map((c) => {
      const r = rateFor(latest, c);
      return `<tr><td>${c}${c === carat ? " •" : ""}</td><td class="mono">${inr(round0(r))}</td><td class="mono">${inr(round0(r * GRAMS_PER_PAVAN))}</td></tr>`;
    }).join("");

    document.getElementById("premium-input").value = settings.premiumFactor;
  }

  function renderAnalysis(period) {
    const carat = settings.activeCarat;
    const n = period === "month" ? 30 : 7;
    const stats = periodStats(carat, n);

    document.getElementById("analysis-high").textContent = inr(round0(stats.high));
    document.getElementById("analysis-low").textContent = inr(round0(stats.low));
    document.getElementById("analysis-avg").textContent = inr(round0(stats.avg));
    const changeEl = document.getElementById("analysis-change");
    changeEl.textContent = pct(stats.changePct);
    changeEl.style.color = stats.changePct >= 0 ? "var(--sage)" : "var(--danger)";

    const periodWord = period === "month" ? "month" : "week";
    let commentary;
    if (Math.abs(stats.changePct) < 2) {
      commentary = `Rate has been range-bound this ${periodWord}, moving between ${inr(round0(stats.low))} and ${inr(round0(stats.high))}.`;
    } else if (stats.changePct > 0) {
      commentary = `Rate has been trending upward this ${periodWord}, up ${pct(stats.changePct)} from ${inr(round0(stats.days[0] ? rateFor(stats.days[0], carat) : stats.low))}.`;
    } else {
      commentary = `Rate has been trending downward this ${periodWord}, down ${pct(Math.abs(stats.changePct) * -1)} from the start of the period.`;
    }
    document.getElementById("analysis-commentary").textContent = commentary;

    const hasSynthetic = stats.days.some((d) => d.synthetic);
    document.getElementById("synthetic-note").hidden = !hasSynthetic;

    renderTrendChart(stats.days, carat);
  }

  function renderTrendChart(days, carat) {
    const ctx = document.getElementById("trend-chart");
    const labels = days.map((d) => d.date.slice(5));
    const data = days.map((d) => Math.round(rateFor(d, carat)));

    if (trendChart) trendChart.destroy();
    trendChart = new Chart(ctx, {
      type: "line",
      data: {
        labels,
        datasets: [{
          data,
          borderColor: "#B8863B",
          backgroundColor: "rgba(184,134,59,0.12)",
          borderWidth: 2,
          fill: true,
          tension: 0.3,
          pointRadius: 0,
          pointHoverRadius: 4,
          pointBackgroundColor: "#2B1017",
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { font: { family: "IBM Plex Mono", size: 10 }, color: "#6B5A4E" }, grid: { display: false } },
          y: {
            ticks: {
              font: { family: "IBM Plex Mono", size: 10 }, color: "#6B5A4E",
              callback: (v) => "₹" + Number(v).toLocaleString("en-IN"),
            },
            grid: { color: "#F1EADA" },
          },
        },
      },
    });
  }

  function computeBreakdown(booking) {
    const goldValue = booking.weight * booking.rate;
    const panikooli = goldValue * (booking.panikooli / 100);
    const gst = (goldValue + panikooli) * (booking.gst / 100);
    const total = goldValue + panikooli + gst;
    return { goldValue, panikooli, gst, total };
  }

  function renderBooking() {
    const list = document.getElementById("booking-list");
    const sorted = bookings.slice().sort((a, b) => (a.date < b.date ? 1 : -1));

    list.innerHTML = sorted.map((b) => {
      const latest = latestSnapshot();
      const currentRate = rateFor(latest, b.carat);
      const goldValueAtPurchase = b.weight * b.rate;
      const goldValueToday = b.weight * (currentRate || 0);
      const diff = goldValueToday - goldValueAtPurchase;
      const diffPct = (diff / goldValueAtPurchase) * 100;
      const ahead = diff >= 0;
      const breakdown = computeBreakdown(b);

      return `
      <div class="booking-card" data-id="${b.id}">
        <div class="booking-card-head">
          <span class="booking-name">${escapeHtml(b.name)}</span>
          <span class="booking-carat-tag">${b.carat}</span>
        </div>
        <div class="booking-meta">
          <span class="mono">${b.weight.toFixed(3)}g</span> · ${formatDateLong(b.date)} · paid <span class="mono">${inr(b.amount)}</span> at <span class="mono">${inr(b.rate)}</span>/g
        </div>

        <div class="booking-compare">
          <span class="booking-compare-label">${ahead ? "You're ahead by" : "Market has moved against this by"}</span>
          <span class="booking-compare-value ${ahead ? "positive" : "negative"}">${inr(Math.abs(round0(diff)))} (${pct(Math.abs(diffPct))})</span>
        </div>

        <div class="sparkline-wrap"><canvas id="spark-${b.id}"></canvas></div>

        <button class="breakdown-toggle" data-toggle="${b.id}">Price breakdown ▾</button>
        <div class="breakdown" id="breakdown-${b.id}" hidden>
          <div class="breakdown-inputs">
            <div>
              <label>Panikooli %</label>
              <input type="number" step="0.1" min="0" class="panikooli-input" data-id="${b.id}" value="${b.panikooli}">
            </div>
            <div>
              <label>GST %</label>
              <input type="number" step="0.1" min="0" class="gst-input" data-id="${b.id}" value="${b.gst}">
            </div>
          </div>
          <div class="breakdown-row"><span>Gold value (${b.weight.toFixed(3)}g × ${inr(b.rate)})</span><span class="mono">${inr(round0(breakdown.goldValue))}</span></div>
          <div class="breakdown-row"><span>Panikooli (${b.panikooli}%)</span><span class="mono">${inr(round0(breakdown.panikooli))}</span></div>
          <div class="breakdown-row"><span>GST (${b.gst}% on gold+panikooli)</span><span class="mono">${inr(round0(breakdown.gst))}</span></div>
          <div class="breakdown-row total"><span>Total</span><span class="mono">${inr(round0(breakdown.total))}</span></div>
          <p class="breakdown-note">GST-on-making-charges conventions vary by jeweller and invoice in Kerala — treat this as an estimate to sanity-check against the actual bill, not gospel.</p>
          <button class="delete-booking-btn" data-delete="${b.id}">Delete this booking</button>
        </div>
      </div>`;
    }).join("");

    // wire up toggles
    list.querySelectorAll("[data-toggle]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.dataset.toggle;
        const el = document.getElementById(`breakdown-${id}`);
        el.hidden = !el.hidden;
        btn.textContent = el.hidden ? "Price breakdown ▾" : "Price breakdown ▴";
      });
    });

    list.querySelectorAll(".panikooli-input, .gst-input").forEach((input) => {
      input.addEventListener("change", (e) => {
        const id = e.target.dataset.id;
        const b = bookings.find((x) => x.id === id);
        if (!b) return;
        if (e.target.classList.contains("panikooli-input")) b.panikooli = Number(e.target.value) || 0;
        else b.gst = Number(e.target.value) || 0;
        settings.lastPanikooli = b.panikooli;
        settings.lastGst = b.gst;
        saveSettings(settings);
        saveBookings(bookings);
        renderBooking();
      });
    });

    list.querySelectorAll("[data-delete]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.dataset.delete;
        if (!confirm("Delete this booking? This cannot be undone.")) return;
        bookings = bookings.filter((x) => x.id !== id);
        saveBookings(bookings);
        renderBooking();
      });
    });

    // sparklines
    sorted.forEach((b) => renderSparkline(b));
  }

  function renderSparkline(booking) {
    const canvas = document.getElementById(`spark-${booking.id}`);
    if (!canvas) return;
    const h = getSortedHistory().filter((d) => d.date >= booking.date);
    const series = h.length ? h : getSortedHistory();
    const data = series.map((d) => rateFor(d, booking.carat));

    if (sparklineCharts[booking.id]) sparklineCharts[booking.id].destroy();
    sparklineCharts[booking.id] = new Chart(canvas, {
      type: "line",
      data: {
        labels: series.map((d) => d.date),
        datasets: [{
          data,
          borderColor: "#B8863B",
          borderWidth: 1.5,
          pointRadius: 0,
          tension: 0.3,
          fill: false,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { enabled: false } },
        scales: { x: { display: false }, y: { display: false } },
        elements: { line: { borderJoinStyle: "round" } },
      },
    });
  }

  function renderSignal() {
    const carat = settings.activeCarat;
    const signal = computeSignal(carat);
    const card = document.getElementById("signal-card");
    const badge = document.getElementById("signal-card-badge");
    badge.textContent = `${signal.label} · ${carat}`;

    document.getElementById("signal-card-reason").textContent =
      signal.level === "BUY" ? `Now looks like a reasonable time to buy ${carat} — the rate is ${signal.reason}.` :
      signal.level === "WAIT" ? `Might be worth waiting on ${carat} — the rate is ${signal.reason}.` :
      `No strong signal on ${carat} right now — the rate is ${signal.reason}.`;

    const month = periodStats(carat, 30);
    const latest = rateFor(latestSnapshot(), carat);
    document.getElementById("range-low-label").textContent = `Low ${inr(round0(month.low))}`;
    document.getElementById("range-high-label").textContent = `High ${inr(round0(month.high))}`;
    document.getElementById("range-bar-fill").style.width = `${Math.min(100, Math.max(0, signal.position))}%`;
    document.getElementById("range-bar-marker").style.left = `${Math.min(100, Math.max(0, signal.position))}%`;
    document.getElementById("range-bar-position").textContent = `Position: ${signal.position.toFixed(0)}% of 30-day range`;

    document.getElementById("signal-numbers").innerHTML = `
      <div><span class="sn-label">Current rate</span><span class="sn-value">${inr(round0(latest))}/g</span></div>
      <div><span class="sn-label">30-day range</span><span class="sn-value">${inr(round0(month.low))} – ${inr(round0(month.high))}</span></div>
      <div><span class="sn-label">3-day momentum</span><span class="sn-value">${signal.momentum}</span></div>
      <div><span class="sn-label">Position formula</span><span class="sn-value">${((latest - month.low)).toFixed(0)} / ${((month.high - month.low)).toFixed(0)}</span></div>
    `;

    if (settings.alertThreshold) {
      document.getElementById("alert-threshold").value = settings.alertThreshold;
      document.getElementById("alert-status").textContent =
        `Alert set: notify when ${settings.alertCarat} drops below ${inr(settings.alertThreshold)}.`;
    } else {
      document.getElementById("alert-status").textContent = "No alert set.";
    }
  }

  function renderAll() {
    const period = document.querySelector(".segment.active")?.dataset.period || "week";
    renderHeader();
    renderHome();
    renderAnalysis(period);
    renderBooking();
    renderSignal();
  }

  // ---------- Helpers ----------

  function escapeHtml(s) {
    const div = document.createElement("div");
    div.textContent = s;
    return div.innerHTML;
  }

  function formatDateLong(dateKey) {
    const [y, m, d] = dateKey.split("-").map(Number);
    return new Date(y, m - 1, d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
  }

  // ---------- Price alert ----------

  function checkPriceAlert() {
    if (!settings.alertThreshold || !settings.alertCarat) return;
    const rate = rateFor(latestSnapshot(), settings.alertCarat);
    if (rate === null || rate === undefined) return;
    if (rate >= settings.alertThreshold) return;

    const key = `${todayKey()}:${settings.alertThreshold}`;
    if (settings.alertFiredKey === key) return;

    if (!("Notification" in window)) return;
    if (Notification.permission === "granted") {
      fireAlertNotification(rate);
      settings.alertFiredKey = key;
      saveSettings(settings);
    } else if (Notification.permission !== "denied") {
      Notification.requestPermission().then((perm) => {
        if (perm === "granted") {
          fireAlertNotification(rate);
          settings.alertFiredKey = key;
          saveSettings(settings);
        }
      });
    }
  }

  function fireAlertNotification(rate) {
    try {
      new Notification("Goldlocker price alert", {
        body: `${settings.alertCarat} has dropped to ${inr(round0(rate))}/g, below your alert of ${inr(settings.alertThreshold)}.`,
        icon: "icon.svg",
      });
    } catch (e) { /* Notification constructor unsupported in this context (e.g. SW-only browsers) */ }
  }

  // ---------- Event wiring ----------

  function wireTabBar() {
    document.querySelectorAll(".tab").forEach((tab) => {
      tab.addEventListener("click", () => {
        document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
        tab.classList.add("active");
        document.querySelectorAll(".screen").forEach((s) => s.classList.remove("active"));
        document.getElementById(`screen-${tab.dataset.screen}`).classList.add("active");
        renderHeader();
      });
    });
  }

  function wireCaratPills() {
    document.querySelectorAll(".pill").forEach((pill) => {
      pill.classList.toggle("active", pill.dataset.carat === settings.activeCarat);
      pill.addEventListener("click", () => setActiveCarat(pill.dataset.carat));
    });
  }

  function wirePeriodToggle() {
    document.querySelectorAll(".segment").forEach((seg) => {
      seg.addEventListener("click", () => {
        document.querySelectorAll(".segment").forEach((s) => s.classList.remove("active"));
        seg.classList.add("active");
        renderAnalysis(seg.dataset.period);
      });
    });
  }

  function wireRefresh() {
    document.getElementById("refresh-btn").addEventListener("click", () => refreshRate(true));
  }

  function wirePremium() {
    document.getElementById("premium-save-btn").addEventListener("click", () => {
      const v = Number(document.getElementById("premium-input").value);
      if (!v || v <= 0) return;
      settings.premiumFactor = v;
      saveSettings(settings);
      refreshRate(false);
    });
  }

  function wireBookingForm() {
    const form = document.getElementById("booking-form");
    const toggleBtn = document.getElementById("add-booking-toggle");
    const cancelBtn = document.getElementById("cancel-booking-btn");
    const errorEl = document.getElementById("booking-form-error");

    toggleBtn.addEventListener("click", () => {
      document.getElementById("bk-panikooli").value = settings.lastPanikooli;
      document.getElementById("bk-gst").value = settings.lastGst;
      document.getElementById("bk-date").value = todayKey();
      form.hidden = false;
      toggleBtn.hidden = true;
    });

    cancelBtn.addEventListener("click", () => {
      form.hidden = true;
      toggleBtn.hidden = false;
      form.reset();
      errorEl.hidden = true;
    });

    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const name = document.getElementById("bk-name").value.trim();
      const date = document.getElementById("bk-date").value;
      const weight = Number(document.getElementById("bk-weight").value);
      const carat = document.getElementById("bk-carat").value;
      const amount = Number(document.getElementById("bk-amount").value);
      const panikooli = Number(document.getElementById("bk-panikooli").value) || 0;
      const gst = Number(document.getElementById("bk-gst").value) || 0;

      if (!name || !date) {
        errorEl.textContent = "Please fill in a name and date.";
        errorEl.hidden = false;
        return;
      }
      if (!(weight > 0)) {
        errorEl.textContent = "Weight must be a positive number.";
        errorEl.hidden = false;
        return;
      }
      if (!(amount > 0)) {
        errorEl.textContent = "Amount must be a positive number.";
        errorEl.hidden = false;
        return;
      }

      const booking = {
        id: "bk-" + Date.now(),
        name, date, weight, carat, amount,
        rate: amount / weight,
        panikooli, gst,
      };
      bookings.push(booking);
      saveBookings(bookings);
      settings.lastPanikooli = panikooli;
      settings.lastGst = gst;
      saveSettings(settings);

      form.hidden = true;
      toggleBtn.hidden = false;
      form.reset();
      errorEl.hidden = true;
      renderBooking();
    });
  }

  function wireAlert() {
    document.getElementById("alert-save-btn").addEventListener("click", () => {
      const v = Number(document.getElementById("alert-threshold").value);
      if (!v || v <= 0) return;
      settings.alertThreshold = v;
      settings.alertCarat = settings.activeCarat;
      settings.alertFiredKey = null;
      saveSettings(settings);
      if ("Notification" in window && Notification.permission === "default") {
        Notification.requestPermission();
      }
      renderSignal();
      checkPriceAlert();
    });
  }

  function registerServiceWorker() {
    if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
      navigator.serviceWorker.register("sw.js").catch(() => { /* offline caching unavailable; app still works online */ });
    }
  }

  // ---------- Init ----------

  function init() {
    wireTabBar();
    wireCaratPills();
    wirePeriodToggle();
    wireRefresh();
    wirePremium();
    wireBookingForm();
    wireAlert();
    registerServiceWorker();

    refreshRate(false);
  }

  document.addEventListener("DOMContentLoaded", init);
})();
