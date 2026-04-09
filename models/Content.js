const mongoose = require("mongoose");

const contentSectionSchema = new mongoose.Schema(
  {
    heading: { type: String, trim: true, default: "" },
    paragraphs: [{ type: String, trim: true }],
  },
  { _id: false }
);

const contentSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    summary: {
      type: String,
      default: "",
      trim: true,
    },
    version: {
      type: String,
      default: "v1.0",
      trim: true,
    },
    sections: {
      type: [contentSectionSchema],
      default: [],
    },
    isPublished: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Content", contentSchema);