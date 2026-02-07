# Fix GitHub → Render Connection (No New Deployments Showing)

If you push to GitHub but Render doesn’t start a new deployment, use this checklist.

---

## 1. Confirm Render is using the right GitHub repo

1. Go to **https://dashboard.render.com**
2. Open your **backend** Web Service.
3. Click **Settings** (left sidebar).
4. Under **Build & Deploy** find **Repository**.
5. Check:
   - **Repository** = the GitHub repo that actually contains your code (e.g. `YourUsername/Samstudios` or whatever you push to).
   - If it’s wrong: click **Connect account** or **Change repository** and reconnect the correct repo.

---

## 2. Check the branch Render deploys from

1. In the same service, **Settings** → **Build & Deploy**.
2. Find **Branch** (e.g. `main` or `master`).
3. Render only deploys when you push to **this branch**. Pushes to other branches won’t trigger a deploy.
4. If you’ve been pushing to a different branch (e.g. `develop`), either:
   - Change **Branch** in Render to that branch, or  
   - Merge/push your changes to the branch Render is watching (e.g. `main`).

---

## 3. Set Root Directory (important for this repo)

Your backend lives in **`global-backend`** inside the repo, not at the repo root.

1. **Settings** → **Build & Deploy**.
2. Find **Root Directory**.
3. Set it to: **`global-backend`**
4. If this was empty or wrong, Render was building the wrong folder. Save and trigger a new deploy.

---

## 4. Make sure Auto-Deploy is on

1. **Settings** → **Build & Deploy**.
2. Find **Auto-Deploy**.
3. Set to **Yes** so every push to the selected branch triggers a deploy.

---

## 5. Confirm GitHub permissions (Render’s GitHub app)

Render needs permission to see the repo and deploy.

1. In Render: **Account Settings** (top-right) → **Integrations** or **GitHub**.
2. Or in GitHub: **Settings** → **Integrations** → **Applications** → **Render**.
3. Ensure:
   - The **correct GitHub account** is connected.
   - The repo you use is **allowed** for Render (not blocked or not selected).
4. If unsure, **disconnect and reconnect** the GitHub account in Render, and re-select the repo when creating or editing the service.

---

## 6. Trigger a deploy after fixing settings

1. In Render, open your backend service.
2. **Manual Deploy** (top right) → **Deploy latest commit**.
3. This uses the latest commit from the branch and root directory you configured. Check the **Events** / **Logs** tab to see the build and run.

---

## 7. Optional: use a Deploy Hook (bypass GitHub connection)

If you can’t get auto-deploy to work, you can still deploy on every push using a **Deploy Hook**:

1. **Settings** → **Build & Deploy** → **Deploy Hook**.
2. Copy the **URL** (e.g. `https://api.render.com/deploy/srv/xxxxx?key=yyyy`).
3. In GitHub:
   - Repo → **Settings** → **Webhooks** → **Add webhook**.
   - **Payload URL**: paste the Deploy Hook URL.
   - **Content type**: `application/json`.
   - **Which events**: “Just the push event” (or “Let me select” → **Pushes**).
   - Save.
4. On every push to that repo, GitHub will call the hook and Render will deploy (branch still depends on how you configure the hook or filters, but usually it’s “latest push”).

---

## Quick checklist

| Check | Where | What to verify |
|-------|--------|----------------|
| Repo | Render → Service → Settings → Build & Deploy | Correct GitHub repo connected |
| Branch | Same | Branch = the one you push to (e.g. `main`) |
| Root Directory | Same | `global-backend` |
| Auto-Deploy | Same | **Yes** |
| Permissions | Render Account / GitHub Integrations | Render can access the repo |
| Deploy | Manual Deploy | “Deploy latest commit” runs and builds from `global-backend` |

After changing **Branch** or **Root Directory**, always run **Manual Deploy** once to confirm deployments work. Then push a small change to the correct branch and confirm a new deployment appears in the **Events** tab.
