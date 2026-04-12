# Weave Agent Project Rules

## Structure
- All new code lives in src/v2/ only.
- Do not touch src/*.js legacy files unless explicitly asked.
- The legacy Next.js app build is broken by design — do not attempt to fix it unless that is the stated task.

## Scope
- If a task requires touching more than 5 files outside src/v2/, stop and confirm first.
- Do not modify AGENTS.md, package.json, or vercel.json without explicit instruction.

## Testing
- Local node --experimental-strip-types execution cannot make outbound network calls.
