# Test Skill Zip Packages

Test zips for the CodeFunctionDefinition support in zip skill tools.ts.

Located in: `/tmp/ocean-mcp-test-skills/zips/`

## 01-math-skill.zip — Root-level skill with code tools

**Structure**: Root-level SKILL.md + tools.ts (Case 1)
**Tests**: Root-level zip skills now import tools.ts (was previously a gap)

Tools (all CodeFunctionDefinition):
- `calculate` — Math expression evaluator (add/subtract/multiply/divide) with enum params
- `statistics` — Computes mean, median, min, max, sum for number arrays
- `formatNumber` — Formats numbers with separators, decimals, prefix/suffix

Try: "Calculate 42 * 17", "Stats for [3, 7, 1, 9, 5]", "Format 1234567.89 as USD"

## 02-multi-skill.zip — Multi-skill subdirectories with code tools

**Structure**: 3 subdirectory skills (Case 2)
**Tests**: Subdirectory skills with tools.ts all import and wrap correctly

Skills:
- `string-utils` — transformString (case conversion), analyzeString (word/char/line count)
- `json-utils` — jsonQuery (dot-path extraction), jsonTransform (pick/omit/flatten)
- `date-utils` — dateInfo (date parsing/formatting), dateDiff (date difference calc)

Try: "Convert 'hello world' to camelCase", "Query path 'users[0].name' from {...}"

## 03-mixed-tools.zip — Mixed AI SDK Tool + CodeFunctionDefinition

**Structure**: Root-level SKILL.md + tools.ts with mixed exports (Case 1)
**Tests**: Same export map contains both tool types; auto-detection works

Tools:
- `echo` — **Vercel AI SDK Tool** (native tool() with Zod schema + execute)
- `encodeBase64` — **CodeFunctionDefinition** (auto-wrapped)
- `decodeBase64` — **CodeFunctionDefinition** (auto-wrapped)
- `generateUUID` — **CodeFunctionDefinition** (auto-wrapped)

Try: "Echo 'hello'", "Encode 'secret' in base64", "Generate 5 UUIDs"

## 04-http-tools.zip — Fetch-based code tools with resources

**Structure**: Root-level SKILL.md + tools.ts + references/ directory (Case 1)
**Tests**: Code tools that use the server-provided fetch(), plus resource files

Tools (all CodeFunctionDefinition using fetch):
- `httpGet` — GET request with response body, status, timing
- `checkUrl` — HEAD request to check reachability with timeout
- `fetchJson` — JSON fetch with optional dot-path extraction

Resources:
- `references/api-examples.md` — Example public API endpoints

Try: "Check if https://httpbin.org/get is reachable", "Fetch JSON from https://jsonplaceholder.typicode.com/posts/1"
