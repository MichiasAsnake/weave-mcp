import { createHash } from "node:crypto";

import { stableJsonStringify } from "../shared/json.ts";

export function sha256(value: unknown): string {
  return createHash("sha256").update(stableJsonStringify(value)).digest("hex");
}
