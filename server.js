const express = require("express");
const dotenv = require("dotenv");
const cors = require("cors");
const connectDB = require("./config/db");

const adminRoutes = require("./routes/adminRoutes");
const authRoutes = require("./routes/authRoutes");
const agentRoutes = require("./routes/agentRoutes");
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
const pushRoutes = require("./routes/pushRoutes");
const notificationRoutes = require("./routes/notificationRoutes");
const targetedBonusRoutes = require("./routes/targetedBonusRoutes");

const http = require("http");
const { Server } = require("socket.io");
const ChatMessage = require("./models/ChatMessage");
const User = require("./models/User");
const { sendPushToUser } = require("./utils/pushService");

dotenv.config();

async function startServer() {
  const app = express();

  app.set("trust proxy", true);

  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // CORS
  app.use(cors({ origin: true, credentials: true }));

  // Routes
  app.use("/api/admin", adminRoutes);
  app.use("/api/auth", authRoutes);
  app.use("/api/agent", agentRoutes);
  app.use("/api/orders", ordersRoutes);
  app.use("/api/admin/orders", adminOrdersRoutes);
  app.use("/api/withdrawals", withdrawalsRoutes);
  app.use("/api/wallet-transactions", walletTransactionsRoutes);
  app.use("/api/signin", signinRoutes);
  app.use("/api/chat", chatRoutes);
  app.use("/api/push", pushRoutes);
  app.use("/api", eventRoutes);
  app.use("/api", vipRoutes);
  app.use("/api", contentRoutes);
  app.use("/api/admin/lucky-draw", adminLuckyDrawRuleRoutes);
  app.use("/api/lucky-draw", userLuckyDrawRuleRoutes);
  app.use("/api/admin/notifications", adminNotificationsRoutes);
  app.use("/api", notificationRoutes);
  app.use("/api/targeted-bonus", targetedBonusRoutes);
  
  const server = http.createServer(app);

  const io = new Server(server, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"],
    },
    transports: ["websocket"],
  });

  app.set("io", io);

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

        const user = await User.findById(userId)
          .select("uid phoneNumber")
          .lean();
        
        const saved = await ChatMessage.create({
          userId,
          uid: user?.uid || "",
          phoneNumber: user?.phoneNumber || "",
          sender: "user",
          message: msg,
          createdAt: new Date(),
          type: "text",
          status: "sent",
          adminRead: false,
        });

        io.to(`user:${userId}`).emit("chat:delivered", { tempId });

        io.to("admins").emit("chat:newMessage", {
          id: saved._id.toString(),
          userId,
          uid: saved.uid || "",
          phoneNumber: saved.phoneNumber || "",
          sender: "user",
          message: msg,
          createdAt: saved.createdAt,
          type: "text",
          status: "sent",
          adminRead: false,
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
          uid: msg.uid || "",
          phoneNumber: msg.phoneNumber || "",
          sender: msg.sender || "user",
          message: msg.message || "",
          createdAt: msg.createdAt,
          status: msg.status || "sent",
          type: msg.type || "image",
          imageUrl: msg.imageUrl || "",
          fileName: msg.fileName || "",
          adminRead:
            typeof msg.adminRead === "boolean"
              ? msg.adminRead
              : (msg.sender || "user") === "admin",
          userRead:
            typeof msg.userRead === "boolean"
              ? msg.userRead
              : (msg.sender || "user") === "admin"
              ? false
              : true,
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

        const user = await User.findById(userId)
         .select("uid phoneNumber")
         .lean();

        const saved = await ChatMessage.create({
          userId,
          uid: user?.uid || "",
          phoneNumber: user?.phoneNumber || "",
          sender: "admin",
          message: msg,
          createdAt: new Date(),
          type: "text",
          status: "sent",
          adminRead: true,
          userRead: false,
        });

        io.to("admins").emit("chat:status", {
          clientId,
          messageId: saved._id.toString(),
          status: "sent",
        });

        io.to(`user:${userId}`).emit("chat:newMessage", {
          id: saved._id.toString(),
          userId,
          uid: saved.uid || "",
          phoneNumber: saved.phoneNumber || "",
          sender: "admin",
          message: msg,
          createdAt: saved.createdAt,
          status: "sent",
          type: "text",
          adminRead: true,
          userRead: false,
        });

        await sendPushToUser(userId, {
          title: "Support Team",
          body: msg.length > 80 ? msg.slice(0, 80) + "..." : msg,
          url: "/chat.html",
          type: "chat",
          userId,
          messageId: saved._id.toString(),
        });

        io.to("admins").emit("chat:newMessage", {
          id: saved._id.toString(),
          clientId,
          userId,
          uid: saved.uid || "",
          phoneNumber: saved.phoneNumber || "",
          sender: "admin",
          message: msg,
          createdAt: saved.createdAt,
          status: "sent",
          type: "text",
          adminRead: true,
          userRead: false,
        });
      } catch (err) {
        console.error("admin:message error", err);
      }
    });

    socket.on("user:readAdminMessages", async ({ userId }) => {
      try {
        if (!userId) return;
    
        const result = await ChatMessage.updateMany(
          {
            userId,
            sender: "admin",
            userRead: { $ne: true },
          },
          {
            $set: {
              userRead: true,
              status: "read",
            },
          }
        );
    
        if (result.modifiedCount > 0) {
          io.to("admins").emit("chat:adminMessagesReadByUser", {
            userId,
            status: "read",
          });
        }
      } catch (err) {
        console.error("user:readAdminMessages error", err);
      }
    });

    socket.on("disconnect", () => {
      console.log("Socket disconnected:", socket.id);
    });
  });

  const PORT = process.env.PORT || 8000;

  try {
    await connectDB();
    console.log("✅ Database ready, starting server...");
  
    server.listen(PORT, "0.0.0.0", () => {
      console.log(`Server running on port ${PORT}`);
    });
  } catch (err) {
    console.error("❌ MongoDB connection failed:", err);
    process.exit(1);
  }
}

startServer().catch((err) => console.error("❌ Server failed:", err));