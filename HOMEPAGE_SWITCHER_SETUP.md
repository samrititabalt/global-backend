# Homepage Switcher – Backend Implementation

The backend now supports the **Homepage Switcher** so the active homepage applies for **all visitors**, not just one browser.

## What Was Added

### 1. New model: `models/SiteSetting.js`
- Stores key/value settings (e.g. `activeHomepage`).
- Used to persist which homepage is active across restarts and for all users.

### 2. Public route: `GET /api/public/active-homepage`
- **File:** `routes/public.js`
- **Auth:** None (public).
- **Response:** `{ "activeHomepage": "original" | "suspense" }`
- Defaults to `"original"` if no value is set.

### 3. Admin route: `PUT /api/admin/active-homepage`
- **File:** `routes/admin.js`
- **Auth:** Admin only (`protect` + `authorize('admin')`).
- **Body:** `{ "activeHomepage": "original" | "suspense" }`
- Saves the value to the database.

---

## What You Need To Do Manually

### 1. Backend (global-backend)

1. **Commit and push** the backend changes to your GitHub repo:
   - `models/SiteSetting.js` (new)
   - `routes/public.js` (GET `/active-homepage` added)
   - `routes/admin.js` (PUT `/active-homepage` added)

2. **Redeploy on Render**
   - If Render is set to auto-deploy from GitHub, push and wait for the deploy to finish.
   - Otherwise, trigger a manual deploy for the backend service in the Render dashboard.

3. **No env or DB migration needed**
   - `SiteSetting` uses your existing MongoDB; no new env vars or migration.

### 2. Frontend (global-frontend)

1. **Point the frontend at your Render backend**
   - In your frontend env (e.g. Vercel or `.env`), set:
     - `VITE_API_URL=https://YOUR-RENDER-BACKEND.onrender.com/api`
   - Replace `YOUR-RENDER-BACKEND` with your actual Render backend service URL.

2. **Redeploy the frontend**
   - Commit/push if needed, and let Vercel (or your host) redeploy so it uses the new API URL.

### 3. Test

1. Open the **Admin Dashboard** → **Homepage Switcher**.
2. Click **Suspense Tool homepage**.
   - You should **not** see a 404; the request should succeed.
3. Open the main site in an **incognito window** (or another browser) and visit `/`.
   - You should see the **Suspense Tool** homepage, so the setting applies for everyone.

---

## Summary

| Where            | What to do |
|------------------|------------|
| **Backend repo** | Commit & push `SiteSetting.js` and the route changes in `public.js` and `admin.js`. |
| **Render**       | Ensure the backend has redeployed (auto or manual). |
| **Frontend env** | Set `VITE_API_URL` to your Render backend API URL. |
| **Frontend host**| Redeploy the frontend so it uses the updated env. |

After that, the Homepage Switcher will control the live homepage for all visitors.
