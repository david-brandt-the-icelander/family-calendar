// Checks a vendored copy of icelander-auth against its STAMP.json: every file unchanged since it was copied
// from icelander.net/packages/icelander-auth with sync.sh. Throws if not. A repository's tests call it:
//   import { checkVendored } from "../vendor/icelander-auth/check.mjs"; checkVendored();
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

export function checkVendored(dir = new URL(".", import.meta.url)) {
  const stamp = JSON.parse(readFileSync(new URL("STAMP.json", dir), "utf8"));
  const changed = Object.entries(stamp.files).filter(([file, hash]) => createHash("sha256").update(readFileSync(new URL(file, dir))).digest("hex") !== hash);
  if (changed.length) throw new Error(`vendor/icelander-auth was edited here (${changed.map(([f]) => f).join(", ")}): change it in icelander.net/packages/icelander-auth and copy it with sync.sh`);
  return stamp.version;
}
