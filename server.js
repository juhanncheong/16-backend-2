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

  await connectDB();
  console.log("✅ MongoDB connected, starting server...");

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
  socket.on("admin:message", ({ userId, message }) => {
    const msg = String(message || "").trim();
    if (!userId || !msg) return;

    const createdAt = new Date().toISOString();

    chatDB.prepare(`
      INSERT INTO chat_messages (userId, sender, message, createdAt)
      VALUES (?, ?, ?, ?)
    `).run(userId, "admin", msg, createdAt);

    io.to(`user:${userId}`).emit("chat:newMessage", {
      userId,
      sender: "admin",
      message: msg,
      createdAt,
    });

    io.to("admins").emit("chat:newMessage", {
      userId,
      sender: "admin",
      message: msg,
      createdAt,
    });
  });

  socket.on("disconnect", () => {
    console.log("Socket disconnected:", socket.id);
  });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
}

startServer().catch((err) => console.error("❌ Server failed:", err));
