/**
 * Script to protect homepage video file from accidental deletion
 * This creates a .gitkeep file and ensures the videos directory exists
 */

const fs = require('fs');
const path = require('path');

const videosDir = path.join(process.cwd(), 'uploads', 'videos');
const videoFile = path.join(videosDir, 'homepage-video.mp4');
const gitkeepFile = path.join(videosDir, '.gitkeep');
const readmeFile = path.join(videosDir, 'README.md');

// Ensure videos directory exists
if (!fs.existsSync(videosDir)) {
  fs.mkdirSync(videosDir, { recursive: true });
  console.log('Created videos directory:', videosDir);
}

// Create .gitkeep to ensure directory is tracked
if (!fs.existsSync(gitkeepFile)) {
  fs.writeFileSync(gitkeepFile, '# This directory contains uploaded videos\n');
  console.log('Created .gitkeep file');
}

// Create README to warn about video file
const readmeContent = `# Homepage Video Directory

## Important: Do NOT delete homepage-video.mp4

This directory contains the homepage background video file.

**File:** homepage-video.mp4
**Purpose:** Background video for the homepage hero section
**Status:** Managed via Admin Dashboard

### Protection
- This file is tracked in the database (VideoStatus model)
- Deletion will be detected and logged
- Admin Dashboard will show deletion status and reason

### If Video is Deleted
1. Check Admin Dashboard for deletion reason
2. Re-upload video via Admin Dashboard
3. Video will automatically be restored

### File Location
\`uploads/videos/homepage-video.mp4\`
`;

if (!fs.existsSync(readmeFile)) {
  fs.writeFileSync(readmeFile, readmeContent);
  console.log('Created README.md file');
}

// Check if video file exists
if (fs.existsSync(videoFile)) {
  const stats = fs.statSync(videoFile);
  console.log(`Video file exists: ${videoFile}`);
  console.log(`Size: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
  console.log(`Last modified: ${stats.mtime}`);
} else {
  console.log(`Video file not found: ${videoFile}`);
  console.log('Upload video via Admin Dashboard to restore');
}

console.log('Video file protection check completed');
