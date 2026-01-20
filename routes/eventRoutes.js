import express from "express";
import { createEvent, getEvents } from "../controllers/eventController.js";

const router = express.Router();

// ✅ Public route for users
router.get("/events", getEvents);

// ✅ Admin route (later we can protect this with admin auth middleware)
router.post("/admin/events", createEvent);

export default router;
