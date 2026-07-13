#!/usr/bin/env node
// Scrapes the Kerala 22K/24K/18K per-gram gold rate history embedded in
// keralagoldrates.com's page (a `todayChartData` JS array in a <script> tag)
// and writes it to data/kerala-rate.json for the static app to fetch.
//
// No API key, no scraping library needed — Node's built-in fetch + a regex
// against the page's own chart-data literal. robots.txt on this host is
// `Allow: /`; this runs at most a few times a day via GitHub Actions cron.

import { writeFile, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const SOURCE_URL = "https://keralagoldrates.com/today-22k-gold-rate-kerala/";
const USER_AGENT = "Mozilla/5.0 (compatible; GoldlockerBot/1.0; +https://github.com/caludejomingit/goldlocker; personal gold-rate tracker, a few fetches/day)";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = path.join(__dirname, "..", "data", "kerala-rate.json");

async function main() {
  const res = await fetch(SOURCE_URL, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) {
    throw new Error(`Fetch failed: ${res.status} ${res.statusText}`);
  }
  const html = await res.text();

  const match = html.match(/const\s+todayChartData\s*=\s*"((?:[^"\\]|\\.)*)"/);
  if (!match) {
    throw new Error("Could not find todayChartData on the page — site structure may have changed.");
  }

  const jsonText = match[1].replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  const raw = JSON.parse(jsonText);
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error("todayChartData parsed but was empty or not an array.");
  }

  // Multiple intraday updates share a date; the feed is newest-first, so the
  // first occurrence of each date is that day's latest reading.
  const byDate = new Map();
  for (const row of raw) {
    if (!row.date || !row.rate_22k) continue;
    if (byDate.has(row.date)) continue;
    byDate.set(row.date, {
      date: row.date,
      rate18K: Number(row.rate_18k),
      rate22K: Number(row.rate_22k),
      rate24K: Number(row.rate_24k),
    });
  }

  const history = Array.from(byDate.values())
    .filter((r) => r.rate18K > 0 && r.rate22K > 0 && r.rate24K > 0)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  if (history.length === 0) {
    throw new Error("No valid dated rate rows parsed.");
  }

  const output = {
    source: SOURCE_URL,
    note: "Kerala state-wide gold rate. Kothamangalam-specific rates aren't separately published; jeweller making charges (not the base metal rate) are what vary by city.",
    fetchedAt: new Date().toISOString(),
    history,
  };

  let previous = null;
  try {
    previous = JSON.parse(await readFile(OUTPUT_PATH, "utf8"));
  } catch {
    // no previous file yet — first run
  }

  const changed = !previous || JSON.stringify(previous.history) !== JSON.stringify(output.history);

  await writeFile(OUTPUT_PATH, JSON.stringify(output, null, 2) + "\n", "utf8");

  console.log(`Wrote ${history.length} days of history to ${OUTPUT_PATH}`);
  console.log(`Latest: ${history[history.length - 1].date} — 22K ₹${history[history.length - 1].rate22K}/g`);
  console.log(changed ? "Data changed." : "Data unchanged from previous run.");

  // Signal to the GitHub Actions step whether a commit is needed.
  if (process.env.GITHUB_OUTPUT) {
    await writeFile(process.env.GITHUB_OUTPUT, `changed=${changed}\n`, { flag: "a" });
  }
}

main().catch((err) => {
  console.error("Scrape failed:", err.message);
  process.exitCode = 1;
});
