# Deploying TripX to Vercel

This project is already structured for Vercel's zero-config Express support:
- `server.js` at the project root exports/runs the Express app — Vercel
  auto-detects this and turns it into a single serverless Function.
- All frontend files (`index.html`, `login.html`, `script.js`, etc.) live in
  `public/` — Vercel serves this folder directly via its CDN.
  (`express.static()` is ignored on Vercel, which is why these had to move
  out of the project root.)

No `vercel.json` is required.

## 1. Push the project to GitHub
Vercel deploys from a Git repository.
```bash
cd tripx
git init
git add .
git commit -m "Initial commit"
# create a new repo on GitHub, then:
git remote add origin https://github.com/<your-username>/<repo-name>.git
git branch -M main
git push -u origin main
```

## 2. Get a MongoDB Atlas connection string (if you don't have one)
Vercel functions don't have a fixed IP, so under your Atlas cluster's
**Network Access**, add `0.0.0.0/0` ("Allow access from anywhere") — or use
the official Vercel ↔ MongoDB Atlas integration from the Vercel Marketplace,
which can configure this and the connection string for you automatically.

## 3. Import the project on Vercel
1. Go to https://vercel.com/new
2. Import your GitHub repo
3. Framework Preset: Vercel should auto-detect **Express** — leave the
   default build settings as-is.

## 4. Add environment variables
In the import screen (or later under **Project Settings → Environment
Variables**), add:

| Name        | Value                                              |
|-------------|-----------------------------------------------------|
| `MONGO_URI` | your MongoDB Atlas connection string                |
| `JWT_SECRET`| a long random string — generate with the command below |

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

Add both for **Production**, **Preview**, and **Development** environments.

## 5. Deploy
Click **Deploy**. Vercel will install dependencies and deploy automatically.

## 6. Redeploying after changes
Every `git push` to your connected branch triggers a new deployment
automatically. To deploy manually instead, use the CLI:
```bash
npm i -g vercel
vercel login
vercel          # creates a preview deployment
vercel --prod   # promotes/deploys straight to production
```

## Notes
- EmailJS keys in `forgot-password.html` / `reset-password.html` are public
  client-side keys (by EmailJS design) — they can stay in the HTML, no
  Vercel environment variable needed for those.
- The app's `API` constant uses `window.location.origin`, so it
  automatically points at whatever domain Vercel gives your deployment —
  no code changes needed after deploying.
