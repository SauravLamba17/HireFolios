// After `next build` (postbuild): bundle the operator scripts that must run where there is no source or tsx — the AWS
// container and the office release — into <dist>/standalone/tools/*.js (one self-contained file each).
//   node tools/backup-s3.js [--list | --restore latest --yes]
//   node tools/migrate-files-to-s3.js [--apply]
import { build } from "esbuild";

const dist = process.env.NEXT_DIST_DIR || ".next";
for (const name of ["backup-s3", "migrate-files-to-s3"]) {
  await build({
    entryPoints: [`scripts/${name}.ts`],
    outfile: `${dist}/standalone/tools/${name}.js`,
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node24",
    conditions: ["react-server"], // "server-only" resolves to its empty server build
    tsconfig: "tsconfig.json",
    legalComments: "none",
    logLevel: "warning",
  });
}
console.log(`tools: ${dist}/standalone/tools/{backup-s3,migrate-files-to-s3}.js`);
