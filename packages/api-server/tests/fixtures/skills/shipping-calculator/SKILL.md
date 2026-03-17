---
name: shipping-calculator
description: Calculate shipping costs and delivery estimates. Demonstrates JSON Schema parameter definitions with nested objects, constraints, and enums.
---

# Shipping Calculator Skill

Calculate shipping costs for packages based on weight, dimensions, destination, and service options.

## Usage

Use the `calculateShippingCost` tool to get cost estimates. It accepts detailed package specifications using JSON Schema-defined parameters with nested objects and constraints.

Use the `trackShipment` tool to check the status of an existing shipment by tracking number.

## Notes

- Weight must be between 0.01 and 100 kg
- Dimensions are in centimeters
- Supported service levels: standard, express, overnight
- Insurance is optional and based on declared value
