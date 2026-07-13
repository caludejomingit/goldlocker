#!/usr/bin/env node
// Sends a Web Push notification with today's Kerala gold rate to the single
// stored subscription. Run by .github/workflows/daily-notification.yml at
// 10:00 AM IST daily. Reads data/kerala-rate.json (kept fresh by
// scrape-rate.mjs, which this workflow also runs first) rather than
// fetching live, so the notification always matches what the app shows.

import webpush from "web-push";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_PATH = path.join(__dirname, "..", "data", "kerala-rate.json");

const {
  VAPID_PUBLIC_KEY,
  VAPID_PRIVATE_KEY,
  VAPID_SUBJECT,
  PUSH_SUBSCRIPTION,
} = process.env;

async function main() {
  if (!PUSH_SUBSCRIPTION) {
    console.log("No PUSH_SUBSCRIPTION secret set yet — nobody has subscribed. Skipping.");
    return;
  }
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY || !VAPID_SUBJECT) {
    throw new Error("Missing VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT secrets.");
  }

  const subscription = JSON.parse(PUSH_SUBSCRIPTION);
  const data = JSON.parse(await readFile(DATA_PATH, "utf8"));
  const latest = data.history[data.history.length - 1];

  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

  const payload = JSON.stringify({
    title: "Goldlocker",
    body: `Today's 22K rate: ₹${latest.rate22K.toLocaleString("en-IN")}/gram`,
    url: "./",
  });

  try {
    await webpush.sendNotification(subscription, payload);
    console.log("Notification sent.");
  } catch (err) {
    // 404/410 means the browser unsubscribed or the subscription expired —
    // nothing to retry until the user re-subscribes and updates the secret.
    if (err.statusCode === 404 || err.statusCode === 410) {
      console.log(`Subscription is gone (HTTP ${err.statusCode}). Re-subscribe in the app and update the PUSH_SUBSCRIPTION secret.`);
      return;
    }
    throw err;
  }
}

main().catch((err) => {
  console.error("Send failed:", err.message || err);
  process.exitCode = 1;
});
