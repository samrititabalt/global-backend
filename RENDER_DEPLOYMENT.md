# Render Deployment Instructions

## GitHub not triggering deployments?

If you push to GitHub but Render doesn’t show a new deployment, see **[GITHUB_RENDER_CONNECTION.md](./GITHUB_RENDER_CONNECTION.md)** for step-by-step fixes. Most often the issue is one of:

- **Wrong branch** – Render is set to deploy from `main` but you’re pushing to another branch (or the opposite).
- **Wrong root directory** – This backend lives in the `global-backend` folder; in Render → Settings → Build & Deploy, set **Root Directory** to `global-backend`.
- **Wrong repo** – The service is connected to a different GitHub repo than the one you’re pushing to.

## Quick Redeploy Steps

1. **Go to your Render Dashboard**: https://dashboard.render.com
2. **Navigate to your backend service**
3. **Click "Manual Deploy"** → **"Deploy latest commit"**
   OR
   **Click "Events"** → **"Clear build cache"** → Then trigger a new deploy

## Important Notes for Render

### Puppeteer Requirements

Puppeteer requires Chrome/Chromium to be installed. Render may need additional configuration:

**Option 1: Let Puppeteer download Chromium (Recommended)**
- Puppeteer will automatically download Chromium on first install
- This may take 5-10 minutes during build
- No additional configuration needed

**Option 2: Use System Chrome (if available)**
- Set environment variable: `PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser`
- Or: `PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome`

### Build Configuration

If deployment fails with Puppeteer, you may need to:

1. **Add Build Command** (in Render dashboard):
   ```
   npm install && npm run build
   ```
   Or if no build script:
   ```
   npm install
   ```

2. **Add Start Command**:
   ```
   node server.js
   ```

3. **Environment Variables** (if needed):
   - `PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=false` (to ensure Chromium downloads)
   - `PUPPETEER_EXECUTABLE_PATH` (if using system Chrome)

### Memory Requirements

Puppeteer can be memory-intensive. Ensure your Render service has:
- **At least 512MB RAM** (1GB recommended)
- **Sufficient disk space** for Chromium (~200MB)

### Troubleshooting

If deployment hangs or fails:

1. **Clear Build Cache**: Render Dashboard → Your Service → Events → Clear build cache
2. **Check Build Logs**: Look for Puppeteer download progress
3. **Increase Timeout**: Render may need longer build time for Puppeteer
4. **Check Memory**: Ensure service has enough RAM

### Alternative: Make Puppeteer Optional

If Puppeteer continues to cause issues, we can make it optional and fall back to a simpler PDF generation method. Let me know if you need this.

## Current Status

✅ `package.json` is valid JSON
✅ All dependencies are listed correctly
✅ Server routes are properly configured
✅ Document converter routes are registered

The code is ready for deployment!
