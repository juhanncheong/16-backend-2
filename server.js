const express = require("express");
const dotenv = require("dotenv");
const cors = require("cors");
const connectDB = require("./config/db");

const adminInvitesRoutes = require("./routes/adminInvites");
const adminRoutes = require("./routes/adminRoutes");
const authRoutes = require("./routes/authRoutes");
const ordersRoutes = require("./routes/ordersRoutes");
const adminOrdersRoutes = require("./routes/adminOrdersRoutes");
const withdrawalsRoutes = require("./routes/withdrawalsRoutes");
const walletTransactionsRoutes = require("./routes/walletTransactionsRoutes");
const signinRoutes = require("./routes/signinRoutes");
const chatRoutes = require("./routes/chatRoutes");
const eventRoutes = require("./routes/eventRoutes");
const vipRoutes = require("./routes/vipRoutes");

const http = require("http");
const { Server } = require("socket.io");
const chatDB = require("./chatDB");

dotenv.config();

async function startServer() {
  const app = express();

  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // ✅ CORS: allow your frontend (Live Server / Vite / localhost)
  app.use(cors({ origin: true, credentials: true }));
  
  // ✅ Routes
  app.use("/api/admin/invites", adminInvitesRoutes);
  app.use("/api/admin", adminRoutes);
  app.use("/api/auth", authRoutes);

  app.use("/api/orders", ordersRoutes);
  app.use("/api/admin/orders", adminOrdersRoutes);
  app.use("/api/withdrawals", withdrawalsRoutes);
  app.use("/api/wallet-transactions", walletTransactionsRoutes);
  app.use("/api/signin", signinRoutes);
  app.use("/api/chat", chatRoutes);
  app.use("/api", eventRoutes);
  app.use("/api", vipRoutes);

  const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

// ✅ socket connection
io.on("connection", (socket) => {
  console.log("Socket connected:", socket.id);

  // ✅ Admin typing indicator (live)
  socket.on("admin:typing", ({ userId, typing }) => {
    if (!userId) return;
    io.to(`user:${userId}`).emit("chat:typing", { typing: !!typing });
  });

  // user joins room
  socket.on("user:join", ({ userId }) => {
    socket.join(`user:${userId}`);
  });

  // admin joins admin room
  socket.on("admin:join", () => {
    socket.join("admins");
  });

// user sends msg
socket.on("user:message", ({ userId, message, tempId }) => {
  const msg = String(message || "").trim();
  if (!msg) return;

  const createdAt = new Date().toISOString();

  chatDB.prepare(`
    INSERT INTO chat_messages (userId, sender, message, createdAt)
    VALUES (?, ?, ?, ?)
  `).run(userId, "user", msg, createdAt);

  // ✅ delivery confirm back to user ONLY
  io.to(`user:${userId}`).emit("chat:delivered", { tempId });

  // ✅ send message to admin panel
  io.to("admins").emit("chat:newMessage", {
    userId,
    sender: "user",
    message: msg,
    createdAt,
  });
});

// admin replies
socket.on("admin:message", ({ userId, message, clientId }) => {
  const msg = String(message || "").trim();
  if (!userId || !msg) return;

  const createdAt = new Date().toISOString();

  // ✅ save message to DB
  const result = chatDB.prepare(`
    INSERT INTO chat_messages (userId, sender, message, createdAt)
    VALUES (?, ?, ?, ?)
  `).run(userId, "admin", msg, createdAt);

  // ✅ status update back to admin UI (for ✓ ticks)
  io.to("admins").emit("chat:status", {
    clientId,                 // matches your optimistic message id
    messageId: result.lastInsertRowid, // real DB id
    status: "sent",
  });

  // ✅ send to user
  io.to(`user:${userId}`).emit("chat:newMessage", {
    id: result.lastInsertRowid,
    userId,
    sender: "admin",
    message: msg,
    createdAt,
    status: "sent",
  });

  // ✅ show on admin chat screen too
  io.to("admins").emit("chat:newMessage", {
    id: result.lastInsertRowid,
    clientId,
    userId,
    sender: "admin",
    message: msg,
    createdAt,
    status: "sent",
  });
});

  socket.on("disconnect", () => {
    console.log("Socket disconnected:", socket.id);
  });
});

// Start server first
const PORT = process.env.PORT || 8000;
server.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
});

// Connect DB in background (don’t block startup)
connectDB()
  .then(() => console.log("✅ MongoDB connected"))
  .catch((err) => console.error("❌ MongoDB connection failed:", err));

}

startServer().catch((err) => console.error("❌ Server failed:", err));
