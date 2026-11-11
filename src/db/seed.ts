// `npm run db:seed` (loads .env if present). The logic is in seed-core.ts.
import { pgClient } from "@/db";
import { seed } from "./seed-core";

seed()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => pgClient.end());
