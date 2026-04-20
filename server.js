const express = require("express");
const dotenv = require("dotenv");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const connectDB = require("./config/db");

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
const contentRoutes = require("./routes/contentRoutes");
const adminLuckyDrawRuleRoutes = require("./routes/adminLuckyDrawRuleRoutes");
const userLuckyDrawRuleRoutes = require("./routes/userLuckyDrawRuleRoutes");
const adminNotificationsRoutes = require("./routes/adminNotificationsRoutes");

const http = require("http");
const { Server } = require("socket.io");
const ChatMessage = require("./models/ChatMessage");

dotenv.config();

async function startServer() {
  const app = express();

  app.set("trust proxy", true);
  
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // create uploads/chat folder if missing
  const uploadsDir = path.join(__dirname, "uploads", "chat");
  fs.mkdirSync(uploadsDir, { recursive: true });

  // serve uploaded files
  app.use("/uploads", express.static(path.join(__dirname, "uploads")));

  // CORS
  app.use(cors({ origin: true, credentials: true }));

  // Routes
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
  app.use("/api", contentRoutes);
  app.use("/api/admin/lucky-draw", adminLuckyDrawRuleRoutes);
  app.use("/api/lucky-draw", userLuckyDrawRuleRoutes);
  app.use("/api/admin/notifications", adminNotificationsRoutes);

  const server = http.createServer(app);

  const io = new Server(server, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"],
    },
  });

  io.on("connection", (socket) => {
    console.log("Socket connected:", socket.id);

    // admin typing indicator
    socket.on("admin:typing", ({ userId, typing }) => {
      if (!userId) return;
      io.to(`user:${userId}`).emit("chat:typing", { typing: !!typing });
    });

    // user joins room
    socket.on("user:join", ({ userId }) => {
      if (!userId) return;
      socket.join(`user:${userId}`);
    });

    // admin joins admin room
    socket.on("admin:join", () => {
      socket.join("admins");
    });

    // user sends text message
    socket.on("user:message", async ({ userId, message, tempId }) => {
      try {
        const msg = String(message || "").trim();
        if (!userId || !msg) return;
    
        const saved = await ChatMessage.create({
          userId,
          sender: "user",
          message: msg,
          createdAt: new Date(),
          type: "text",
          status: "sent",
        });
    
        io.to(`user:${userId}`).emit("chat:delivered", { tempId });
    
        io.to("admins").emit("chat:newMessage", {
          id: saved._id.toString(),
          userId,
          sender: "user",
          message: msg,
          createdAt: saved.createdAt,
          type: "text",
          status: "sent",
        });
      } catch (err) {
        console.error("user:message error", err);
      }
    });

    socket.on("chat:imageSent", (msg) => {
      try {
        if (!msg || !msg.userId) return;
    
        const payload = {
          id: msg.id,
          userId: msg.userId,
          sender: msg.sender || "user",
          message: msg.message || "",
          createdAt: msg.createdAt,
          status: msg.status || "sent",
          type: msg.type || "image",
          imageUrl: msg.imageUrl || "",
          fileName: msg.fileName || "",
        };
    
        io.to("admins").emit("chat:newMessage", payload);
        io.to(`user:${msg.userId}`).emit("chat:newMessage", payload);
      } catch (err) {
        console.error("chat:imageSent error", err);
      }
    });

    // admin sends text message
    socket.on("admin:message", async ({ userId, message, clientId }) => {
      try {
        const msg = String(message || "").trim();
        if (!userId || !msg) return;
    
        const saved = await ChatMessage.create({
          userId,
          sender: "admin",
          message: msg,
          createdAt: new Date(),
          type: "text",
          status: "sent",
        });
    
        io.to("admins").emit("chat:status", {
          clientId,
          messageId: saved._id.toString(),
          status: "sent",
        });
    
        io.to(`user:${userId}`).emit("chat:newMessage", {
          id: saved._id.toString(),
          userId,
          sender: "admin",
          message: msg,
          createdAt: saved.createdAt,
          status: "sent",
          type: "text",
        });
    
        io.to("admins").emit("chat:newMessage", {
          id: saved._id.toString(),
          clientId,
          userId,
          sender: "admin",
          message: msg,
          createdAt: saved.createdAt,
          status: "sent",
          type: "text",
        });
      } catch (err) {
        console.error("admin:message error", err);
      }
    });

    socket.on("disconnect", () => {
      console.log("Socket disconnected:", socket.id);
    });
  });

  const PORT = process.env.PORT || 8000;
  server.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on port ${PORT}`);
  });

  connectDB()
    .then(() => console.log("✅ MongoDB connected"))
    .catch((err) => console.error("❌ MongoDB connection failed:", err));
}

startServer().catch((err) => console.error("❌ Server failed:", err));