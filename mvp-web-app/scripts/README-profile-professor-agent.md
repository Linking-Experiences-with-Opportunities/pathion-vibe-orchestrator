# Profile Professor Agent

Creates/updates per-user profile report cards from session artifacts, using:
- `.user_sessions` session data
- `vizPayload`/`stateSnapshot`-derived evidence (when present)
- existing session narratives as grader input (with consistency validation)

Gemini acts as the "professor" synthesizing the final natural-language report card.

## Command

From `mvp-web-app`:

```bash
npm run profiles:professor
```

## Recommended secure usage

Use an environment variable instead of hardcoding keys in files:

```bash
export GEMINI_API_KEY="<your_key>"
npm run profiles:professor
```

## Useful flags

```bash
node scripts/profile-professor-agent.mjs \
  --sessions-dir ../.user_sessions \
  --out-dir ../.profiles \
  --model gemini-3-pro-preview
```

```bash
node scripts/profile-professor-agent.mjs --validate-only --dry-run
```

## Output

- `../.profiles/user_<userId>.json`: versioned profile report card for each user
- `../.profiles/index.json`: run summary across processed users

## Notes

- If Gemini call fails, the pipeline still writes a deterministic fallback report card.
- `--validate-only` skips model calls and only computes metrics + narrative checks.
