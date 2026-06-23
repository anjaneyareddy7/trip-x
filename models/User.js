const mongoose = require("mongoose");

/*
 * FIX: This file was missing entirely from the upload, even though
 * server.js does `require("./models/User")`. Without it Node throws:
 *   Error: Cannot find module './models/User'
 * and the server never starts. Re-created here to match every field
 * server.js actually reads/writes (name, email, password, resetToken,
 * resetTokenExpires).
 */

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Name is required"],
      trim: true,
    },
    email: {
      type: String,
      required: [true, "Email is required"],
      unique: true,
      lowercase: true,
      trim: true,
    },
    password: {
      type: String,
      required: [true, "Password is required"],
    },
    resetToken: {
      type: String,
      default: undefined,
    },
    resetTokenExpires: {
      type: Date,
      default: undefined,
    },
  },
  { timestamps: true }
);

// Index for fast lookups during login / forgot-password / verify-reset-token
userSchema.index({ email: 1 });
userSchema.index({ resetToken: 1 });

module.exports = mongoose.model("User", userSchema);
