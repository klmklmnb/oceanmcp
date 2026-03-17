---
name: env-deploy
description: Environment deployment tools. Use when the user wants to deploy to a specific environment or manage deployments. Demonstrates askUser-driven workflows where the user must choose an environment or deployment target before proceeding.
---

# Environment Deploy Skill

This skill demonstrates how `askUser` is triggered within a workflow.

The `deploy` tool asks the user to pick a target environment (via `askUser`) before executing the deployment. If there are 3 or fewer environments, buttons are shown; otherwise a dropdown is used.

## Available Tools

- **deploy**: Deploy the current project to a chosen environment
- **rollback**: Rollback a deployment (asks the user to choose a version to rollback to)

## Usage

- Ask: "Deploy to production" (triggers askUser with ≤3 environments → buttons)
- Ask: "Rollback the deployment" (triggers askUser with >3 versions → dropdown)
