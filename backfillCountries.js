const mongoose = require("mongoose");
const dotenv = require("dotenv");
const connectDB = require("./config/db");
const User = require("./models/User");

dotenv.config();

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isSkippableIp(ip) {
  if (!ip) return true;

  const v = String(ip).trim().toLowerCase();

  return (
    !v ||
    v === "::1" ||
    v === "127.0.0.1" ||
    v === "localhost" ||
    v === "admin_created" ||
    v.startsWith("192.168.") ||
    v.startsWith("10.") ||
    v.startsWith("172.") ||
    v.startsWith("169.254.") ||
    v.startsWith("fc") ||
    v.startsWith("fd") ||
    v.startsWith("fe80:")
  );
}

async function lookupCountry(ip) {
  const url = `https://ipapi.co/${encodeURIComponent(ip)}/json/`;

  const resp = await fetch(url, {
    method: "GET",
    headers: {
      Accept: "application/json",
      "User-Agent": "country-backfill-script/1.0",
    },
  });

  const text = await resp.text();

  if (resp.status === 429) {
    const err = new Error(`HTTP 429 - ${text}`);
    err.code = 429;
    throw err;
  }

  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status} - ${text}`);
  }

  let data = {};
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Invalid JSON response: ${text}`);
  }

  if (data?.error) {
    throw new Error(data.reason || data.message || "API returned error");
  }

  const country = data?.country_code || data?.country || null;
  return country ? String(country).trim().toUpperCase() : null;
}

async function backfillCountries() {
  const users = await User.find({
    registeredIp: { $nin: [null, "", "ADMIN_CREATED"] },
    $or: [{ registeredCountry: null }, { registeredCountry: "" }],
  }).select("_id phoneNumber registeredIp registeredCountry");

  console.log(`Users to backfill: ${users.length}`);

  let updated = 0;
  let skipped = 0;
  let failed = 0;

  for (const user of users) {
    const ip = String(user.registeredIp || "").trim();

    if (isSkippableIp(ip)) {
      console.log(`Skipped: ${user.phoneNumber} ${ip}`);
      skipped++;
      continue;
    }

    try {
      const country = await lookupCountry(ip);

      if (!country) {
        console.log(`No country: ${user.phoneNumber} ${ip}`);
        failed++;
      } else {
        user.registeredCountry = country;
        await user.save();
        console.log(`Updated: ${user.phoneNumber} ${ip} -> ${country}`);
        updated++;
      }
    } catch (err) {
      if (err.code === 429) {
        console.log("Rate limit hit. Stop now and rerun later.");
        break;
      }

      console.log(`Failed: ${user.phoneNumber} ${ip} -> ${err.message}`);
      failed++;
    }

    await sleep(2000);
  }

  console.log("----------");
  console.log("Done");
  console.log(`Updated: ${updated}`);
  console.log(`Skipped: ${skipped}`);
  console.log(`Failed: ${failed}`);
}

connectDB()
  .then(async () => {
    console.log("MongoDB connected");
    await backfillCountries();
    await mongoose.connection.close();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error("Backfill failed:", err);
    try {
      await mongoose.connection.close();
    } catch {}
    process.exit(1);
  });