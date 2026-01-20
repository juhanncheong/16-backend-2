const jwt = require("jsonwebtoken");
const User = require("../models/User");

const protect = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    // Expect: "Bearer TOKEN"
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ message: "No token provided" });
    }

    const token = authHeader.split(" ")[1];

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // ✅ normalize userId (support all token formats)
    const userId = decoded.userId || decoded.id || decoded._id;

    if (!userId) {
      return res.status(401).json({
        message: "Invalid token payload (missing userId)",
      });
    }

    // ✅ always attach a clean user object
    req.user = {
      _id: String(userId),    
      id: String(userId),     
      userId: String(userId),  
      role: decoded.role || "user",
    };

    // ✅ Update lastOnlineAt (only if last update > 60s ago)
    User.updateOne(
      {
        _id: req.user.userId, // ✅ IMPORTANT: use normalized ID
        $or: [
          { lastOnlineAt: { $exists: false } },
          { lastOnlineAt: { $lt: new Date(Date.now() - 60 * 1000) } }, // older than 60 seconds
        ],
      },
      { $set: { lastOnlineAt: new Date() } }
    ).catch(() => {});

    next();
  } catch (error) {
    return res.status(401).json({ message: "Invalid or expired token" });
  }
};

const adminOnly = (req, res, next) => {
  if (req.user?.role !== "admin") {
    return res.status(403).json({ message: "Admin access only" });
  }
  next();
};

module.exports = { protect, adminOnly };
