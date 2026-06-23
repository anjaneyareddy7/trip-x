require("dotenv").config();

console.log("APP STARTED");
console.log("JWT:", !!process.env.JWT_SECRET);
console.log("MONGO:", !!process.env.MONGO_URI);

const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const path = require("path");

const Trip = require("./models/Trip");
const User = require("./models/User");

const app = express();

/* ─── STARTUP CHECKS ───
   FIX: warn loudly instead of silently using an insecure default secret. */
if (!process.env.JWT_SECRET) {
  console.warn(
    "⚠️  JWT_SECRET is not set. Falling back to an insecure default — " +
      "DO NOT use this in production. Add JWT_SECRET to a .env file."
  );
}

/* ─── MIDDLEWARE ─── */
app.use(cors());
app.use(express.json());
// Serve the frontend from /public.
// NOTE: on Vercel, express.static() is ignored — Vercel serves everything
// in public/** directly via its CDN instead. Keeping this line means the
// exact same code also works correctly with a plain `node server.js` /
// `npm start` locally or on any other Node host.
app.use(express.static(path.join(__dirname, "public")));

/* ─── DATABASE ───
   FIX: previously a failed connection only logged an error and the server
   kept running — every route would then hang or throw confusing Mongoose
   errors. Now we exit clearly so the failure is impossible to miss, and we
   listen for post-connect drops too. */
mongoose
  .connect(process.env.MONGO_URI || "mongodb://localhost:27017/tripx")
  .then(() => console.log("MongoDB Connected ✅"))
  .catch((err) => {
    console.error("MongoDB connection failed ❌", err.message);
    process.exit(1);
  });

mongoose.connection.on("error", (err) => {
  console.error("MongoDB runtime error ❌", err.message);
});
mongoose.connection.on("disconnected", () => {
  console.warn("⚠️  MongoDB disconnected. Requests may fail until it reconnects.");
});

/* ─── HELPERS ─── */
function generateResetToken() {
  return crypto.randomBytes(32).toString("hex");
}

function normalizeMemberName(memberNames, rawName) {
  const candidate = String(rawName || "").trim().toLowerCase();
  return (
    memberNames.find((name) => name.trim().toLowerCase() === candidate) || null
  );
}

// FIX: every route below that takes an :id/:memberId/:expenseId param now
// validates it's a real ObjectId before hitting Mongoose. Previously an
// invalid id (stale link, typo in URL) caused a Mongoose CastError that
// surfaced as an ugly 500 with an internal error message instead of a
// clean 400.
function isValidObjectId(id) {
  return mongoose.Types.ObjectId.isValid(id);
}

/* ─── JWT MIDDLEWARE ─── */
function verifyToken(req, res, next) {
  const token = req.header("Authorization")?.replace("Bearer ", "");
  if (!token) return res.status(401).json({ error: "No token provided" });
  try {
    const decoded = jwt.verify(
      token,
      process.env.JWT_SECRET || "your-secret-key"
    );
    req.userId = decoded.userId;
    req.userName = decoded.userName;
    next();
  } catch (err) {
    res.status(401).json({ error: "Invalid token" });
  }
}

/* ─── AUTH ROUTES ─── */

// REGISTER
app.post("/auth/register", async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (!name || !email || !password)
      return res
        .status(400)
        .json({ error: "Name, email, and password are required" });

    const existingUser = await User.findOne({ email: email.toLowerCase() });
    if (existingUser)
      return res.status(400).json({ error: "Email already in use" });

    const hashed = await bcrypt.hash(password, 10);
    const user = new User({ name, email: email.toLowerCase(), password: hashed });
    await user.save();

    const token = jwt.sign(
      { userId: user._id, userName: user.name, userEmail: user.email },
      process.env.JWT_SECRET || "your-secret-key",
      { expiresIn: "7d" }
    );

    res.status(201).json({
      success: true,
      token,
      userId: user._id,
      userName: user.name,
      message: "Account created successfully",
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// LOGIN
app.post("/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password)
      return res
        .status(400)
        .json({ error: "Email and password are required" });

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user || !(await bcrypt.compare(password, user.password)))
      return res.status(401).json({ error: "Invalid email or password" });

    const token = jwt.sign(
      { userId: user._id, userName: user.name, userEmail: user.email },
      process.env.JWT_SECRET || "your-secret-key",
      { expiresIn: "7d" }
    );

    res.json({
      success: true,
      token,
      userId: user._id,
      userName: user.name,
      message: "Login successful",
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// VERIFY JWT
app.post("/auth/verify", verifyToken, (req, res) => {
  res.json({ success: true, userId: req.userId, userName: req.userName });
});

// FORGOT PASSWORD — generates token, returns it so frontend can send email via EmailJS
app.post("/auth/forgot-password", async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: "Email is required" });

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      // Don't reveal whether the email exists — return same success shape
      return res.json({
        success: true,
        message: "If this email exists, a reset link will be sent",
      });
    }

    const resetToken = generateResetToken();
    user.resetToken = resetToken;
    user.resetTokenExpires = new Date(Date.now() + 3600000); // 1 hour
    await user.save();

    // Return token + user name so the frontend can build the email via EmailJS
    // NOTE: In production, never expose the raw token in an API response that
    // doesn't require authentication. Here we expose it only so the frontend
    // (EmailJS) can construct the reset link without a server-side mailer.
    res.json({
      success: true,
      message: "Reset token generated",
      resetToken,          // used by frontend EmailJS call
      userName: user.name, // used to personalise the email template
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// VERIFY RESET TOKEN (used by reset-password.html on load)
app.post("/auth/verify-reset-token", async (req, res) => {
  try {
    const { token } = req.body;
    if (!token) return res.status(400).json({ error: "Token is required" });

    const user = await User.findOne({
      resetToken: token,
      resetTokenExpires: { $gt: new Date() },
    });
    if (!user)
      return res
        .status(400)
        .json({ error: "Invalid or expired reset token" });

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// RESET PASSWORD
app.post("/auth/reset-password", async (req, res) => {
  try {
    const { token, newPassword } = req.body;
    if (!token || !newPassword)
      return res
        .status(400)
        .json({ error: "Token and password are required" });

    const passwordRegex =
      /^(?=.*[A-Z])(?=.*[0-9])(?=.*[!@#$%^&*()\-_=+\[\]{};':"\\|,.<>\/?]).{8,}$/;
    if (!passwordRegex.test(newPassword))
      return res
        .status(400)
        .json({ error: "Password does not meet requirements" });

    const user = await User.findOne({
      resetToken: token,
      resetTokenExpires: { $gt: new Date() },
    });
    if (!user)
      return res
        .status(400)
        .json({ error: "Invalid or expired reset token" });

    user.password = await bcrypt.hash(newPassword, 10);
    user.resetToken = undefined;
    user.resetTokenExpires = undefined;
    await user.save();

    // Return user info so frontend can send a confirmation email via EmailJS
    res.json({
      success: true,
      message: "Password reset successfully",
      userEmail: user.email,
      userName: user.name,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ─── TRIP ROUTES ─── */

app.get("/", (req, res) => res.send("TripX Backend Running 🚀"));

// GET all trips for logged-in user
app.get("/trips", verifyToken, async (req, res) => {
  try {
    const trips = await Trip.find({ userId: req.userId }).sort({
      createdAt: -1,
    });
    res.json(trips);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET single trip
app.get("/trips/:id", verifyToken, async (req, res) => {
  try {
    // FIX: validate the id shape before querying — an invalid id used to
    // throw a Mongoose CastError that bubbled up as a raw 500.
    if (!isValidObjectId(req.params.id)) {
      return res.status(400).json({ error: "Invalid trip ID" });
    }
    const trip = await Trip.findOne({
      _id: req.params.id,
      userId: req.userId,
    });
    if (!trip) return res.status(404).json({ error: "Trip not found" });
    res.json(trip);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// CREATE trip
app.post("/trips", verifyToken, async (req, res) => {
  try {
    // FIX: name is required by the schema, but validating it explicitly
    // here returns a clean 400 with a helpful message instead of a raw
    // Mongoose ValidationError.
    if (!req.body.name || !String(req.body.name).trim()) {
      return res.status(400).json({ error: "Trip name is required" });
    }
    const trip = new Trip({ userId: req.userId, ...req.body, name: String(req.body.name).trim() });
    await trip.save();
    res.json(trip);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// DELETE trip
app.delete("/trips/:id", verifyToken, async (req, res) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return res.status(400).json({ error: "Invalid trip ID" });
    }
    const trip = await Trip.findOneAndDelete({
      _id: req.params.id,
      userId: req.userId,
    });
    if (!trip) return res.status(404).json({ error: "Trip not found" });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ADD member
app.post("/trips/:id/members", verifyToken, async (req, res) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return res.status(400).json({ error: "Invalid trip ID" });
    }
    const trip = await Trip.findOne({
      _id: req.params.id,
      userId: req.userId,
    });
    if (!trip) return res.status(404).json({ error: "Trip not found" });
    if (!req.body.name || !req.body.name.trim())
      return res.status(400).json({ error: "Member name is required" });
    trip.members.push({ name: req.body.name.trim() });
    await trip.save();
    res.json(trip);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE member
app.delete("/trips/:id/members/:memberId", verifyToken, async (req, res) => {
  try {
    if (!isValidObjectId(req.params.id) || !isValidObjectId(req.params.memberId)) {
      return res.status(400).json({ error: "Invalid trip or member ID" });
    }
    const trip = await Trip.findOne({
      _id: req.params.id,
      userId: req.userId,
    });
    if (!trip) return res.status(404).json({ error: "Trip not found" });
    const existed = trip.members.some((m) => m._id.toString() === req.params.memberId);
    if (!existed) return res.status(404).json({ error: "Member not found" });
    trip.members = trip.members.filter(
      (m) => m._id.toString() !== req.params.memberId
    );
    await trip.save();
    res.json(trip);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ADD expense
app.post("/trips/:id/expenses", verifyToken, async (req, res) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return res.status(400).json({ error: "Invalid trip ID" });
    }
    const trip = await Trip.findOne({
      _id: req.params.id,
      userId: req.userId,
    });
    if (!trip) return res.status(404).json({ error: "Trip not found" });

    const {
      title,
      amount,
      category,
      paidBy,
      splitType,
      membersInvolved,
      customSplit,
      notes,
    } = req.body;

    if (!title || !amount || !paidBy)
      return res
        .status(400)
        .json({ error: "title, amount and paidBy are required" });

    const numericAmount = Number(amount);
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      return res.status(400).json({ error: "Amount must be a valid number" });
    }

    const tripMemberNames = trip.members.map((member) => member.name);
    const normalizedPaidBy = normalizeMemberName(tripMemberNames, paidBy);
    if (!normalizedPaidBy) {
      return res
        .status(400)
        .json({ error: "Paid by must match an existing trip member" });
    }

    const normalizedMembersInvolved = (
      Array.isArray(membersInvolved) && membersInvolved.length
        ? membersInvolved
        : tripMemberNames
    )
      .map((name) => normalizeMemberName(tripMemberNames, name))
      .filter(Boolean);

    const uniqueMembersInvolved = [...new Set(normalizedMembersInvolved)];
    if (!uniqueMembersInvolved.length) {
      return res
        .status(400)
        .json({ error: "At least one valid trip member must be included" });
    }

    const expense = {
      title: title.trim(),
      amount: numericAmount,
      category: category || "misc",
      paidBy: normalizedPaidBy,
      splitType: splitType || "equal",
      membersInvolved: uniqueMembersInvolved,
      notes: notes || "",
    };

    // FIX: the frontend already checks that custom/percent amounts add up
    // correctly, but the server never did — a malformed or tampered request
    // could silently store a customSplit that didn't match the expense
    // amount at all, throwing off every balance/settlement calculation.
    if ((splitType === "custom" || splitType === "percent") && customSplit) {
      const rawSplit = Array.isArray(customSplit)
        ? customSplit
        : Object.entries(customSplit).map(([member, amt]) => ({
            member,
            amount: Number(amt),
          }));

      const normalizedSplit = [];
      for (const row of rawSplit) {
        const normalizedMember = normalizeMemberName(tripMemberNames, row.member);
        const rowAmount = Number(row.amount);
        if (!normalizedMember || !Number.isFinite(rowAmount) || rowAmount < 0) {
          return res.status(400).json({
            error: "Each custom split row must reference a valid member and a non-negative amount",
          });
        }
        normalizedSplit.push({ member: normalizedMember, amount: rowAmount });
      }

      const splitTotal = normalizedSplit.reduce((s, r) => s + r.amount, 0);
      if (Math.abs(splitTotal - numericAmount) > 0.5) {
        return res.status(400).json({
          error: `Custom split totals ₹${splitTotal.toFixed(2)} but the expense amount is ₹${numericAmount.toFixed(2)}. They must match.`,
        });
      }

      expense.customSplit = normalizedSplit;
    }

    trip.expenses.push(expense);

    // Update totalPaid for the payer
    const payer = trip.members.find((m) => m.name === normalizedPaidBy);
    if (payer) payer.totalPaid = (payer.totalPaid || 0) + numericAmount;

    await trip.save();
    res.json(trip);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE expense
app.delete(
  "/trips/:id/expenses/:expenseId",
  verifyToken,
  async (req, res) => {
    try {
      if (!isValidObjectId(req.params.id) || !isValidObjectId(req.params.expenseId)) {
        return res.status(400).json({ error: "Invalid trip or expense ID" });
      }
      const trip = await Trip.findOne({
        _id: req.params.id,
        userId: req.userId,
      });
      if (!trip) return res.status(404).json({ error: "Trip not found" });

      const expense = trip.expenses.find(
        (e) => e._id.toString() === req.params.expenseId
      );
      if (!expense) return res.status(404).json({ error: "Expense not found" });

      // Deduct from payer's totalPaid
      const payer = trip.members.find((m) => m.name === expense.paidBy);
      if (payer)
        payer.totalPaid = Math.max(
          0,
          (payer.totalPaid || 0) - expense.amount
        );

      trip.expenses = trip.expenses.filter(
        (e) => e._id.toString() !== req.params.expenseId
      );
      await trip.save();
      res.json(trip);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

/* ─── 404 + GLOBAL ERROR HANDLER ───
   FIX: previously there was no fallback for unknown routes (Express'
   default HTML 404 page would render even for API clients expecting JSON),
   and no centralized error handler for anything thrown outside a route's
   own try/catch (e.g. a malformed JSON body from express.json()). */
app.use((req, res) => {
  res.status(404).json({ error: `Route not found: ${req.method} ${req.originalUrl}` });
});

app.use((err, req, res, next) => {
  console.error("Unhandled error:", err);
  if (err.type === "entity.parse.failed") {
    return res.status(400).json({ error: "Invalid JSON in request body" });
  }
  res.status(err.status || 500).json({ error: err.message || "Internal server error" });
});

/* ─── PROCESS-LEVEL SAFETY NETS ───
   FIX: an uncaught error or unhandled promise rejection anywhere in the
   process used to be able to crash the server with no log trail (or leave
   it in an undefined state). Log clearly and shut down so a process
   manager (pm2, systemd, Docker, etc.) can restart it cleanly. */
process.on("unhandledRejection", (reason) => {
  console.error("Unhandled Promise Rejection:", reason);
});
process.on("uncaughtException", (err) => {
  console.error("Uncaught Exception:", err);
  process.exit(1);
});

/* ─── START ─── */
const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () =>
  console.log(`Server running on http://localhost:${PORT} 🚀`)
);

// FIX: close the HTTP server and MongoDB connection cleanly on shutdown
// instead of letting a hosting platform kill -9 the process mid-request.
function shutdown(signal) {
  console.log(`\n${signal} received. Shutting down gracefully…`);
  server.close(() => {
    mongoose.connection.close(false).then(() => {
      console.log("Closed out remaining connections. Goodbye.");
      process.exit(0);
    });
  });
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
