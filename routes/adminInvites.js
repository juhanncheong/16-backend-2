const express = require("express");
const crypto = require("crypto");
const InvitationCode = require("../models/InvitationCode"); // ✅ FIXED PATH

const router = express.Router();

const CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function makeCode(length = 8) {
  let code = "";
  for (let i = 0; i < length; i++) {
    const idx = crypto.randomInt(0, CHARS.length);
    code += CHARS[idx];
  }
  return code;
}

async function generateUniqueCodes(count = 1) {
  const created = [];
  const maxTries = 50;

  let tries = 0;
  while (created.length < count && tries < maxTries) {
    tries++;

    const remaining = count - created.length;
    const docs = [];

    for (let i = 0; i < remaining; i++) {
      docs.push({
        code: makeCode(),
        isUsed: false,
        usedBy: null,
        usedAt: null,
      });
    }

    try {
      const inserted = await InvitationCode.insertMany(docs, { ordered: false });
      created.push(...inserted); // ✅ FIXED
    } catch (err) {
      // ✅ If duplicates, Mongo may still insert some docs
      if (err.code === 11000) {
        if (err.insertedDocs?.length) {
          created.push(...err.insertedDocs);
        }
        continue;
      }
      throw err;
    }
  }

  if (created.length < count) {
    throw new Error("Could not generate enough unique codes. Try again.");
  }

  return created;
}

// ✅ GET all invite codes (latest first)
router.get("/", async (req, res) => {
  try {
    const invites = await InvitationCode.find().sort({ createdAt: -1 }).lean();
    res.json({ ok: true, invites });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

// ✅ POST generate 1 or 10
router.post("/generate", async (req, res) => {
  try {
    const count = Number(req.body?.count || 1);

    if (![1, 10].includes(count)) {
      return res.status(400).json({
        ok: false,
        message: "count must be 1 or 10",
      });
    }

    const created = await generateUniqueCodes(count);

    res.json({
      ok: true,
      message: `Generated ${count} invite code(s)`,
      created: created.map((x) => x.code),
    });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

module.exports = router;
