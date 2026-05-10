const mongoose = require("mongoose");

let isConnected = false;

const connectDB = async () => {
  if (isConnected && mongoose.connection.readyState === 1) {
    console.log("✅ MongoDB already connected");
    return mongoose.connection;
  }

  const mongoUri = process.env.MONGO_URI;

  if (!mongoUri) {
    console.error("❌ MONGO_URI is missing in environment variables");
    process.exit(1);
  }

  try {
    mongoose.connection.on("connected", () => {
      console.log("✅ Mongoose connected");
    });

    mongoose.connection.on("error", (err) => {
      console.error("❌ Mongoose connection error:", err.message);
    });

    mongoose.connection.on("disconnected", () => {
      console.warn("⚠️ Mongoose disconnected");
    });

    const conn = await mongoose.connect(mongoUri, {
      serverSelectionTimeoutMS: 30000,
      socketTimeoutMS: 45000,
      connectTimeoutMS: 30000,
      maxPoolSize: 10,
      minPoolSize: 0,
      retryWrites: true,
    });

    isConnected = true;

    console.log(`✅ MongoDB Connected: ${conn.connection.host}`);
    return conn;
  } catch (error) {
    console.error("❌ MongoDB connection error:", error);
    process.exit(1);
  }
};

module.exports = connectDB;