// Next.js calls register() once when the server starts.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { boot } = await import("./lib/boot");
  try {
    await boot();
  } catch (e) {
    // Don't serve on a half-migrated database: exit so Docker (restart: unless-stopped) tries again.
    console.error("start-up failed:", e);
    process.exit(1);
  }
}
