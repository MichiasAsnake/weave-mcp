import { CompilerErrorSchema } from "./intent-zod.ts";
import type { CompilerError } from "./types.ts";

export function makeCompilerError(
  code: CompilerError["code"],
  message: string,
  details: Record<string, unknown> = {},
): CompilerError {
  return CompilerErrorSchema.parse({ code, message, details });
}
