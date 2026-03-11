---
name: math-utils
description: Math utility tools for performing calculations. Use when the user asks for arithmetic, statistics, or number formatting.
---

# Math Utils Skill

This skill provides server-side math tools via CodeFunctionDefinition.

## Available Tools

- **calculate**: Evaluate a math expression (add, subtract, multiply, divide)
- **statistics**: Compute mean, median, min, max of a number array
- **formatNumber**: Format a number with locale-specific separators

## Usage

When the user asks for calculations, use the `calculate` tool.
For statistical analysis of number sets, use `statistics`.
For number formatting (e.g. currency, percentages), use `formatNumber`.
