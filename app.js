const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const cookieParser = require("cookie-parser");
const rateLimit = require("express-rate-limit");
const authRoutes = require("./routes/authRoutes");
const adminRoutes = require("./routes/adminRoutes");
const path = require("path");

const app = express();

// Security + parsing middleware
app.use(helmet());
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(cookieParser());
app.use("/api/auth", authRoutes);
app.use("/api/admin", adminRoutes);
app.use(express.static(path.join(__dirname, "..", "public")));

// Rate limit (basic protection)
app.use(
  rateLimit({
    windowMs: 15 * 60 * 1000, // 15 min
    max: 200, // requests per IP
  })
);

// Test route
app.get("/", (req, res) => {
  res.json({ message: "✅ Backend is running!" });
});

module.exports = app;
