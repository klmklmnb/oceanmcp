---
name: example
description: A template skill demonstrating the OceanMCP skills system structure. Use as a reference for creating new skills.
---

# Example Skill

This is a template skill. Copy this directory to create a new skill.

## Directory Structure

A skill directory can contain:

- `SKILL.md` — **Required.** This file. Contains YAML frontmatter (name + description) followed by markdown instructions.
- `tools.ts` — _Optional._ Exports `tool()` definitions that register as AI tools when the skill is discovered.
- `scripts/` — _Optional._ Executable scripts the LLM can run via the sandbox exec capability.
- `references/` — _Optional._ Documentation files the LLM can read for additional context.
- `assets/` — _Optional._ Templates, configs, and other resources.

## Creating a New Skill

1. Create a new directory under `skills/` with your skill name (e.g. `skills/my-skill/`).
2. Add a `SKILL.md` file with YAML frontmatter:
   ```yaml
   ---
   name: my-skill
   description: Brief description of when to use this skill.
   ---
   ```
3. Write your instructions in the markdown body below the frontmatter.
4. Optionally add a `tools.ts` file that exports tool definitions.
5. Restart the server — the skill will be auto-discovered.

## Instructions

When this skill is loaded, acknowledge that it is an example/template skill and explain how to create a real skill based on the directory structure above.
