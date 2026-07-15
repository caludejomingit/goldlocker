/* Goldlocker — Kothamangalam gold rate tracker
   Plain JS, no build step. State lives in localStorage. */

(function () {
  "use strict";

  // ---------- Constants ----------

  const STORAGE = {
    history: "gl_history_v1",
    bookings: "gl_bookings_v1",
    settings: "gl_settings_v1",
    meta: "gl_meta_v1",
  };

  const CARATS = ["24K", "22K", "18K"];
  const GRAMS_PER_PAVAN = 8;

  // Small inline line-icons (stroke="currentColor") so they inherit whatever
  // color the wrapping element sets — no external image requests.
  const ICONS = {
    gift: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="9" width="18" height="11" rx="1.5"/><path d="M3 13h18"/><path d="M12 9v11"/><path d="M12 9C9.5 9 8 7.5 8 5.8 8 4.5 9 4 9.8 4 11 4 12 6 12 9Z"/><path d="M12 9c2.5 0 4-1.5 4-3.2C16 4.5 15 4 14.2 4 13 4 12 6 12 9Z"/></svg>',
    up: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 17 10 11 14 15 20 8"/><path d="M14 8h6v6"/></svg>',
    down: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7 10 13 14 9 20 16"/><path d="M14 16h6v-6"/></svg>',
    buy: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5"/><path d="M6 11l6-6 6 6"/></svg>',
    wait: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3h12"/><path d="M6 21h12"/><path d="M7 3c0 5 5 6 5 9s-5 4-5 9"/><path d="M17 3c0 5-5 6-5 9s5 4 5 9"/></svg>',
    hold: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 9h14"/><path d="M5 15h14"/></svg>',
    coin: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8.5"/><path d="M9 9.5c0-1 1-1.8 3-1.8s3 .6 3 1.6c0 2.4-6 1-6 3.4 0 1 1 1.8 3 1.8s3-.8 3-1.8"/></svg>',
    coinStack: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="6" rx="7" ry="2.8"/><path d="M5 6v5c0 1.5 3 2.8 7 2.8s7-1.3 7-2.8V6"/><path d="M5 11v5c0 1.5 3 2.8 7 2.8s7-1.3 7-2.8v-5"/></svg>',
  };

  function signalIcon(level) {
    return level === "BUY" ? ICONS.buy : level === "WAIT" ? ICONS.wait : ICONS.hold;
  }

  // Safe to expose client-side — this is the public half of the VAPID
  // keypair used to sign push messages. The private half only lives in
  // GitHub Actions secrets, used by scripts/send-daily-notification.mjs.
  const VAPID_PUBLIC_KEY = "BH8cl-pqcoshrsSsYNdZrxDy6VbxAAnumH3DesNxcUw6gslN95LPqjZqLgkVgvWStgNoN-T4modcO3n6fN762EI";

  // Scraped daily by .github/workflows/scrape-rate.yml from a Kerala gold
  // rate aggregator (scripts/scrape-rate.mjs) — real 22K/24K/18K rates, no
  // client-side API calls or manual calibration needed.
  const DATA_URL = "./data/kerala-rate.json";

  const DEFAULT_SETTINGS = {
    activeCarat: "22K",
    lastPanikooli: 10,
    lastGst: 3,
    alertCarat: null,
    alertThreshold: null,
    alertFiredKey: null, // `${date}:${threshold}` — prevents renotifying same day/threshold
    pushSubscribedAt: null,
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

  function formatTime(d) {
    return d.toLocaleString("en-IN", {
      day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
    });
  }

  function formatTodayLong() {
    return new Date().toLocaleDateString("en-IN", {
      weekday: "long", day: "2-digit", month: "long", year: "numeric",
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
  let history = loadHistory(); // [{date, rates:{24K,22K,18K}}], ascending by date
  let bookings = loadBookings();
  let trendChart = null;
  const sparklineCharts = {};

  // ---------- Rate math ----------

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

  // ---------- Data fetch ----------
  // Passive loads read data/kerala-rate.json, kept fresh a few times a day by
  // .github/workflows/scrape-rate.yml (scripts/scrape-rate.mjs) — fast,
  // same-origin, works offline. The manual refresh button additionally tries
  // a genuine live fetch straight from the source in the browser (it sends
  // Access-Control-Allow-Origin: *, so this works cross-origin) so tapping
  // refresh reflects the current-moment rate, not just the last cron run.

  const SOURCE_PAGE_URL = "https://keralagoldrates.com/today-22k-gold-rate-kerala/";

  function parseKeralaRateHtml(html) {
    const match = html.match(/const\s+todayChartData\s*=\s*"((?:[^"\\]|\\.)*)"/);
    if (!match) throw new Error("rate data not found on page");
    const jsonText = match[1].replace(/\\"/g, '"').replace(/\\\\/g, "\\");
    const raw = JSON.parse(jsonText);
    if (!Array.isArray(raw) || raw.length === 0) throw new Error("empty rate data");

    const byDate = new Map();
    for (const row of raw) {
      if (!row.date || !row.rate_22k || byDate.has(row.date)) continue;
      byDate.set(row.date, {
        date: row.date,
        rates: { "24K": Number(row.rate_24k), "22K": Number(row.rate_22k), "18K": Number(row.rate_18k) },
      });
    }
    const parsed = Array.from(byDate.values()).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    if (parsed.length === 0) throw new Error("no valid dated rows");
    return parsed;
  }

  let dataMeta = { source: null, fetchedAt: null, fromCache: false, live: false };

  async function loadLiveFromSource() {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);
    let res;
    try {
      res = await fetch(`${SOURCE_PAGE_URL}?t=${Date.now()}`, { signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }
    if (!res.ok) throw new Error(`bad response ${res.status}`);
    const html = await res.text();
    history = parseKeralaRateHtml(html);
    saveHistory(history);
    dataMeta = { source: SOURCE_PAGE_URL, fetchedAt: new Date().toISOString(), fromCache: false, live: true };
    localStorage.setItem(STORAGE.meta, JSON.stringify(dataMeta));
  }

  async function loadKeralaRateData() {
    try {
      const res = await fetch(`${DATA_URL}?t=${Date.now()}`);
      if (!res.ok) throw new Error(`bad response ${res.status}`);
      const payload = await res.json();
      if (!Array.isArray(payload.history) || payload.history.length === 0) {
        throw new Error("empty history in data file");
      }
      history = payload.history.map((r) => ({
        date: r.date,
        rates: { "24K": r.rate24K, "22K": r.rate22K, "18K": r.rate18K },
      }));
      saveHistory(history);
      dataMeta = { source: payload.source, fetchedAt: payload.fetchedAt, fromCache: false, live: false };
      localStorage.setItem(STORAGE.meta, JSON.stringify(dataMeta));
      return true;
    } catch (e) {
      // Offline or the data file isn't reachable yet — fall back to whatever
      // was cached locally from the last successful load.
      const cachedMeta = localStorage.getItem(STORAGE.meta);
      if (cachedMeta) {
        try { dataMeta = { ...JSON.parse(cachedMeta), fromCache: true }; } catch (e2) { /* ignore */ }
      }
      return history.length > 0;
    }
  }

  async function refreshData(live) {
    const btn = document.getElementById("refresh-btn");
    if (live && btn) btn.classList.add("spinning");

    if (live) {
      try {
        await loadLiveFromSource();
      } catch (e) {
        await loadKeralaRateData();
      }
    } else {
      await loadKeralaRateData();
    }

    if (live && btn) {
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

  function renderRecentDaysTable(tbodyId, carat) {
    const recentDays = trailingDays(4).slice().reverse(); // today first, oldest last
    const dayLabels = ["Today", "Yesterday", "2 days ago", "3 days ago"];
    const tbody = document.getElementById(tbodyId);
    tbody.innerHTML = recentDays.map((day, i) => {
      const r = rateFor(day, carat);
      const prev = recentDays[i + 1];
      const prevR = prev ? rateFor(prev, carat) : null;
      let changeCell = "--";
      if (prevR !== null && prevR !== undefined) {
        const d = r - prevR;
        const cls = d >= 0 ? "value-positive" : "value-negative";
        const arrow = d >= 0 ? "▲" : "▼";
        changeCell = `<span class="${cls}">${arrow} ${inr(Math.abs(round0(d)))}</span>`;
      }
      const label = dayLabels[i] || formatDateLong(day.date);
      return `<tr><td>${label}</td><td class="mono">${inr(round0(r))}</td><td class="mono">${changeCell}</td></tr>`;
    }).join("");
  }

  function renderHome() {
    const carat = settings.activeCarat;
    const latest = latestSnapshot();
    const rate = rateFor(latest, carat);

    document.getElementById("home-carat-label").textContent = `${carat} GOLD · KOTHAMANGALAM`;
    document.getElementById("home-today-date").textContent = formatTodayLong();
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

    const latestDate = latest ? formatDateLong(latest.date) : "--";
    const asOf = dataMeta.fetchedAt ? formatTime(new Date(dataMeta.fetchedAt)) : latestDate;
    const isTodayRate = latest && latest.date === todayKey();
    const updatedEl = document.getElementById("home-updated");
    if (dataMeta.fromCache) {
      updatedEl.textContent = `${latestDate}'s rate — offline, showing last synced data`;
    } else if (dataMeta.live) {
      updatedEl.textContent = isTodayRate ? `Today's rate · fetched live at ${asOf}` : `Latest available is ${latestDate} · fetched live at ${asOf}`;
    } else {
      updatedEl.textContent = isTodayRate ? `Today's rate · synced ${asOf}` : `Latest available is ${latestDate} · synced ${asOf}`;
    }

    const signal = computeSignal(carat);
    const badge = document.getElementById("home-signal-badge");
    badge.innerHTML = `${signalIcon(signal.level)}<span>${signal.label}</span>`;
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

    renderRecentDaysTable("recent-days-table-body", carat);

    document.getElementById("data-source-note").textContent = dataMeta.source
      ? `Sourced from ${new URL(dataMeta.source).hostname}, refreshed automatically a few times a day.`
      : "Loading data source info…";
    document.getElementById("stale-data-note").hidden = !dataMeta.fromCache;
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

    renderRecentDaysTable("analysis-recent-days-body", carat);
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

  function computeBreakdown(booking, rate) {
    const goldValue = booking.weight * rate;
    const makingCharge = goldValue * (booking.panikooli / 100);
    const gst = (goldValue + makingCharge) * (booking.gst / 100);
    const total = goldValue + makingCharge + gst;
    return { goldValue, makingCharge, gst, total };
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
      const thenBreakdown = computeBreakdown(b, b.rate);
      const nowBreakdown = computeBreakdown(b, currentRate);
      const totalDiff = nowBreakdown.total - thenBreakdown.total;
      const buySignal = computeSignal(b.carat);

      return `
      <div class="booking-card" data-id="${b.id}">
        <div class="booking-card-head">
          <span class="booking-icon">${ICONS.gift}</span>
          <span class="booking-name">${escapeHtml(b.name)}</span>
          <span class="booking-carat-tag">${b.carat}</span>
        </div>
        <div class="booking-meta">
          <span class="mono">${b.weight.toFixed(3)}g</span> · ${formatDateLong(b.date)} · paid <span class="mono">${inr(b.amount)}</span>
        </div>

        <div class="booking-hero ${ahead ? "ahead" : "behind"}">
          <div class="booking-rate-row">
            <span class="brr-icon">${ICONS.coin}</span>
            <span class="brr-label">Gram</span>
            <span class="brr-value mono">${inr(b.rate)} <span class="brr-arrow">${ahead ? ICONS.up : ICONS.down}</span> ${inr(round0(currentRate))}</span>
          </div>
          <div class="booking-rate-row">
            <span class="brr-icon">${ICONS.coinStack}</span>
            <span class="brr-label">Pavan <small>(8g)</small></span>
            <span class="brr-value mono">${inr(round0(b.rate * GRAMS_PER_PAVAN))} <span class="brr-arrow">${ahead ? ICONS.up : ICONS.down}</span> ${inr(round0(currentRate * GRAMS_PER_PAVAN))}</span>
          </div>
          <div class="booking-hero-diff">
            <span>Your ${b.weight.toFixed(3)}g is worth</span>
            <strong class="mono">${inr(Math.abs(round0(diff)))} ${ahead ? "more" : "less"}</strong>
            <span>than you paid — ${ahead ? "up" : "down"} ${Math.abs(diffPct).toFixed(2)}%</span>
          </div>
        </div>

        <div class="booking-signal-mini">
          <span class="signal-badge ${buySignal.level.toLowerCase()}">${signalIcon(buySignal.level)}<span>${buySignal.label}</span></span>
          <span>Buying more ${b.carat} now: ${buySignal.reason}</span>
        </div>

        <div class="sparkline-wrap"><canvas id="spark-${b.id}"></canvas></div>

        <button class="breakdown-toggle" data-toggle="${b.id}">Full price details ▾</button>
        <div class="breakdown" id="breakdown-${b.id}" hidden>
          <div class="breakdown-row"><span>Gold value then → now</span><span class="mono">${inr(round0(goldValueAtPurchase))} → ${inr(round0(goldValueToday))}</span></div>

          <div class="breakdown-inputs">
            <div>
              <label>Making charge %</label>
              <input type="number" step="0.1" min="0" class="panikooli-input" data-id="${b.id}" value="${b.panikooli}">
            </div>
            <div>
              <label>GST %</label>
              <input type="number" step="0.1" min="0" class="gst-input" data-id="${b.id}" value="${b.gst}">
            </div>
          </div>

          <p class="breakdown-subhead">At purchase — ${inr(b.rate)}/g</p>
          <div class="breakdown-row"><span>Gold value (${b.weight.toFixed(3)}g × ${inr(b.rate)})</span><span class="mono">${inr(round0(thenBreakdown.goldValue))}</span></div>
          <div class="breakdown-row"><span>Making charge (${b.panikooli}%)</span><span class="mono">${inr(round0(thenBreakdown.makingCharge))}</span></div>
          <div class="breakdown-row"><span>GST (${b.gst}% on gold+making charge)</span><span class="mono">${inr(round0(thenBreakdown.gst))}</span></div>
          <div class="breakdown-row total"><span>Total then</span><span class="mono">${inr(round0(thenBreakdown.total))}</span></div>

          <p class="breakdown-subhead">Final price at today's rate — ${inr(round0(currentRate))}/g</p>
          <div class="breakdown-row"><span>Gold value (${b.weight.toFixed(3)}g × ${inr(round0(currentRate))})</span><span class="mono">${inr(round0(nowBreakdown.goldValue))}</span></div>
          <div class="breakdown-row"><span>Making charge (${b.panikooli}%)</span><span class="mono">${inr(round0(nowBreakdown.makingCharge))}</span></div>
          <div class="breakdown-row"><span>GST (${b.gst}% on gold+making charge)</span><span class="mono">${inr(round0(nowBreakdown.gst))}</span></div>
          <div class="breakdown-row total"><span>Total today</span><span class="mono">${inr(round0(nowBreakdown.total))}</span></div>

          <div class="breakdown-row diff-row"><span>Difference (then → today)</span><span class="mono ${totalDiff <= 0 ? "value-negative" : "value-positive"}">${totalDiff <= 0 ? "−" : "+"}${inr(Math.abs(round0(totalDiff)))}</span></div>

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
    badge.innerHTML = `${signalIcon(signal.level)}<span>${signal.label} · ${carat}</span>`;

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
      <div><span class="sn-label">3-day trend</span><span class="sn-value">${signal.momentum}</span></div>
      <div><span class="sn-label">Above the low by</span><span class="sn-value">${inr(round0(latest - month.low))} of ${inr(round0(month.high - month.low))}</span></div>
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

  // ---------- Daily push notification ----------
  // True Web Push (fires even if Goldlocker is closed): subscribing here
  // creates a browser push subscription, which then has to be relayed
  // out-of-band (copy the code, send it to whoever maintains the app) so it
  // can be stored as a GitHub Actions secret — a static site has no server
  // to receive it automatically. .github/workflows/daily-notification.yml
  // sends to that stored subscription every morning via scripts/send-daily-notification.mjs.

  function urlBase64ToUint8Array(base64String) {
    const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
    const raw = atob(base64);
    return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
  }

  async function getPushSubscription() {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) return null;
    const reg = await navigator.serviceWorker.ready;
    return reg.pushManager.getSubscription();
  }

  async function refreshPushUi() {
    const statusEl = document.getElementById("push-status");
    const dotEl = document.getElementById("push-status-dot");
    const subBtn = document.getElementById("push-subscribe-btn");
    const unsubBtn = document.getElementById("push-unsubscribe-btn");
    dotEl.className = "push-status-dot";

    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      statusEl.textContent = "Push notifications aren't supported in this browser.";
      subBtn.disabled = true;
      return;
    }
    if (Notification.permission === "denied") {
      statusEl.textContent = "Notifications are blocked for this site in your browser settings.";
      dotEl.className = "push-status-dot blocked";
      unsubBtn.hidden = true;
      return;
    }
    const sub = await getPushSubscription().catch(() => null);
    if (sub) {
      dotEl.className = "push-status-dot active";
      const since = settings.pushSubscribedAt ? formatDateLong(settings.pushSubscribedAt.slice(0, 10)) : null;
      statusEl.textContent = since ? `Subscribed since ${since} on this device.` : "Subscribed on this device.";
      subBtn.textContent = "Show setup code again";
      unsubBtn.hidden = false;
    } else {
      statusEl.textContent = "Not subscribed.";
      subBtn.textContent = "Enable notification";
      unsubBtn.hidden = true;
    }
  }

  async function subscribeToPush() {
    const statusEl = document.getElementById("push-status");
    const codeWrap = document.getElementById("push-code-wrap");
    const codeBox = document.getElementById("push-code");
    try {
      if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
        statusEl.textContent = "Push notifications aren't supported in this browser.";
        return;
      }
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        statusEl.textContent = "Notification permission was not granted.";
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
        });
        settings.pushSubscribedAt = new Date().toISOString();
        saveSettings(settings);
      }
      codeBox.value = JSON.stringify(sub);
      codeWrap.hidden = false;
      await refreshPushUi();
    } catch (e) {
      statusEl.textContent = "Couldn't subscribe: " + (e.message || e);
    }
  }

  async function unsubscribeFromPush() {
    const statusEl = document.getElementById("push-status");
    const codeWrap = document.getElementById("push-code-wrap");
    try {
      const sub = await getPushSubscription();
      if (sub) await sub.unsubscribe();
      settings.pushSubscribedAt = null;
      saveSettings(settings);
      codeWrap.hidden = true;
      await refreshPushUi();
      statusEl.textContent = "Cancelled on this device. If you already shared a setup code, let whoever maintains Goldlocker know so the daily job can be cleared too.";
    } catch (e) {
      statusEl.textContent = "Couldn't cancel: " + (e.message || e);
    }
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
    document.getElementById("refresh-btn").addEventListener("click", () => refreshData(true));
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

  function wirePush() {
    document.getElementById("push-subscribe-btn").addEventListener("click", subscribeToPush);
    document.getElementById("push-unsubscribe-btn").addEventListener("click", unsubscribeFromPush);
    document.getElementById("push-copy-btn").addEventListener("click", async () => {
      const codeBox = document.getElementById("push-code");
      codeBox.select();
      try {
        await navigator.clipboard.writeText(codeBox.value);
        const btn = document.getElementById("push-copy-btn");
        const original = btn.textContent;
        btn.textContent = "Copied!";
        setTimeout(() => { btn.textContent = original; }, 1500);
      } catch (e) { /* clipboard permission denied — the code is still selected for manual copy */ }
    });
    refreshPushUi();
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
    wireBookingForm();
    wireAlert();
    wirePush();
    registerServiceWorker();

    refreshData(true);
  }

  document.addEventListener("DOMContentLoaded", init);
})();
