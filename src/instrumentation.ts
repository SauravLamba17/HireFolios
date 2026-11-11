// Next.js calls register() once per runtime when the server starts. Keep this file free of
// top-level imports: it is also compiled for the edge runtime. All start-up work is in instrumentation-node.ts.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./instrumentation-node");
  }
}
