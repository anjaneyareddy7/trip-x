const mongoose = require("mongoose");

/*
 * FIX: This file was missing entirely from the upload, even though
 * server.js does `require("./models/Trip")`. Without it Node throws:
 *   Error: Cannot find module './models/Trip'
 * and the server crashes on startup before it ever listens on a port.
 * Schema below matches every field server.js and the front-end
 * (index.html / script.js / trip-detail.html) read or write.
 */

const customSplitSchema = new mongoose.Schema(
  {
    member: { type: String, required: true, trim: true },
    amount: { type: Number, required: true, min: 0 },
  },
  { _id: false }
);

const expenseSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    amount: { type: Number, required: true, min: 0.01 },
    category: {
      type: String,
      enum: ["food", "transport", "accommodation", "activities", "shopping", "misc"],
      default: "misc",
    },
    paidBy: { type: String, required: true, trim: true },
    splitType: {
      type: String,
      enum: ["equal", "payerOnly", "custom", "percent"],
      default: "equal",
    },
    membersInvolved: { type: [String], default: [] },
    customSplit: { type: [customSplitSchema], default: undefined },
    notes: { type: String, default: "", trim: true },
  },
  { timestamps: true }
);

const memberSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    totalPaid: { type: Number, default: 0 },
  }
);

const tripSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    name: { type: String, required: [true, "Trip name is required"], trim: true },
    destination: { type: String, default: "", trim: true },
    budget: { type: Number, default: 0, min: 0 },
    startDate: { type: Date },
    description: { type: String, default: "", trim: true },
    members: { type: [memberSchema], default: [] },
    expenses: { type: [expenseSchema], default: [] },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Trip", tripSchema);
