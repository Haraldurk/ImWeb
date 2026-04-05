import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// Recreate __dirname for ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Directories
const INPUT_DIR = path.join(__dirname, "_raw_videos");
const OUTPUT_DIR = path.join(__dirname, "_imweb_ready");

// Supported extensions
const VALID_EXTENSIONS = [".mp4", ".mov", ".webm", ".avi", ".mkv"];

// Ensure directories exist
if (!fs.existsSync(INPUT_DIR)) fs.mkdirSync(INPUT_DIR);
if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR);

const runFFmpeg = (inputFile, outputFile) => {
  return new Promise((resolve, reject) => {
    // The exact All-Intra parameters for ImWeb
    const args = [
      "-i",
      inputFile,
      "-c:v",
      "libx264",
      "-preset",
      "fast",
      "-tune",
      "fastdecode",
      "-profile:v",
      "main",
      "-g",
      "1", // Force All-Intra (Keyframe every frame)
      "-crf",
      "18", // High quality
      "-vf",
      "scale=trunc(iw/2)*2:trunc(ih/2)*2", // NEW: Forces even-numbered dimensions to prevent crashes
      "-pix_fmt",
      "yuv420p", // WebGL/Browser compatibility
      "-c:a",
      "aac",     // Re-encode audio to AAC for browser compatibility
      "-b:a",
      "192k",    // Good quality audio
      "-sn",     // Strip subtitles/data tracks
      "-map",
      "0:v:0",   // Primary video track
      "-map",
      "0:a?",    // Audio if present (? = optional, won't fail if no audio)
      "-y", // Overwrite if exists
      outputFile,
    ];

    const process = spawn("ffmpeg", args);

    process.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`FFmpeg exited with code ${code}`));
    });
  });
};

async function processVideos() {
  console.log(`\n🎬 ImWeb Video Preparer`);
  console.log(`-------------------------\n`);

  const files = fs.readdirSync(INPUT_DIR);
  const videos = files.filter((f) =>
    VALID_EXTENSIONS.includes(path.extname(f).toLowerCase()),
  );

  if (videos.length === 0) {
    console.log(`No videos found in ${INPUT_DIR}.`);
    console.log(`Drop some clips in there and run this again.\n`);
    return;
  }

  console.log(`Found ${videos.length} videos to process...\n`);

  for (let i = 0; i < videos.length; i++) {
    const file = videos[i];
    const inputFile = path.join(INPUT_DIR, file);

    // Always output as .mp4
    const filenameNoExt = path.basename(file, path.extname(file));
    const outputFile = path.join(OUTPUT_DIR, `${filenameNoExt}_ALL-I.mp4`);

    console.log(`[${i + 1}/${videos.length}] Processing: ${file}...`);

    try {
      await runFFmpeg(inputFile, outputFile);
      console.log(`  ✅ Done: ${filenameNoExt}_ALL-I.mp4`);
    } catch (err) {
      console.error(`  ❌ Error processing ${file}:`, err.message);
    }
  }

  // Write/update manifest.json so ImWeb auto-loads all clips on startup
  const allReady = fs.readdirSync(OUTPUT_DIR)
    .filter(f => f.endsWith('.mp4') || f.endsWith('.webm'))
    .sort();
  const manifest = { clips: allReady };
  fs.writeFileSync(path.join(OUTPUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2));
  console.log(`📋 manifest.json updated — ${allReady.length} clip(s) listed.`);

  console.log(
    `\n🎉 All done! Your videos are in ${OUTPUT_DIR} and ready for ImWeb.\n`,
  );
}

// Check if FFmpeg is installed before running
const checkFFmpeg = spawn("ffmpeg", ["-version"]);
checkFFmpeg.on("error", () => {
  console.error("❌ FFmpeg is not installed or not in your system's PATH.");
  console.error(
    "Please install FFmpeg (e.g., 'brew install ffmpeg' or 'apt install ffmpeg') and try again.",
  );
  process.exit(1);
});
checkFFmpeg.on("close", () => {
  processVideos();
});
