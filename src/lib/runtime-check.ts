// The app refuses to start on a Node.js or PostgreSQL major version other than the pinned one
// (deploy/windows/versions.json, the same file the installer, the packager and package.json "engines" follow).
import versions from "../../deploy/windows/versions.json";

export const PINNED = { node: versions.node.major, postgresql: versions.postgresql.major } as const;

/** null when fine, else the message to stop with. `nodeVersion` like "24.15.0" (process.versions.node). */
export function nodeVersionProblem(nodeVersion: string, pinned = PINNED.node) {
  const major = Number(nodeVersion.split(".")[0]);
  return major === pinned ? null : `Node.js ${nodeVersion} is not supported: this release needs Node.js ${pinned}.x (deploy/windows/versions.json).`;
}

/** `serverVersionNum` is PostgreSQL's server_version_num, e.g. 160015 for 16.15. */
export function postgresVersionProblem(serverVersionNum: number, pinned = PINNED.postgresql) {
  const major = Math.floor(serverVersionNum / 10000);
  return major === pinned
    ? null
    : `PostgreSQL ${major} is not supported: this release needs PostgreSQL ${pinned}.x (deploy/windows/versions.json). Check DATABASE_URL points at the right server.`;
}
