# Mi Coffee Skill

Browse the miHoYo coffee shop menu, view drink details, manage the shopping cart, and place orders.

## Capabilities

- **List drinks** — Fetch all available drink products from the coffee shop menu.
- **View drink details** — Get detailed info for a specific drink including customization options (temperature, sweetness, etc.).
- **View shopping cart** — Check the current contents of the shopping cart.
- **Update shopping cart** — Add drinks with selected attributes to the cart.

## Available Tools

### getDrinkings (read)

Fetches the current drink menu from the miHoYo coffee shop (shop 012). Returns the full product page including drink names, prices, descriptions, and availability.

**Parameters:** None — the shop and product type are pre-configured.

### getDrinkInfo (read)

Fetches detailed information for a specific drink product. The response includes available attribute options (e.g. temperature, sweetness) that must be presented to the user for selection before adding to cart.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `no` | string | yes | Product number (e.g. `"000441"`). Obtain from the `getDrinkings` response. |

### getShoppingCart (read)

Fetches the current shopping cart contents. Returns the list of all items currently in the cart. **Must be called before `updateShoppingCart`** to ensure existing items are preserved.

**Parameters:** None.

### updateShoppingCart (write)

Replaces the entire shopping cart with the provided items array. The `items` parameter is a JSON string representing the **complete** cart — existing items plus any newly added items.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `items` | string | yes | JSON string of the full cart array. See [Cart Item Schema](#cart-item-schema) below. |

#### Cart Item Schema

Each item in the cart array must have:

```json
{
  "no": "000441",
  "name": "心想柿成",
  "imageUrl": "https://...",
  "categoryId": "1",
  "num": 1,
  "specialCardVoucher": null,
  "attributes": [
    { "id": "2", "name": "温度", "itemId": "4", "itemName": "少冰" },
    { "id": "1", "name": "甜度", "itemId": "67", "itemName": "无额外加糖" }
  ]
}
```

- `no` — Product number from `getDrinkInfo`.
- `name` — Product name from `getDrinkInfo`.
- `imageUrl` — Product image URL from `getDrinkInfo`.
- `categoryId` — Category ID from `getDrinkInfo`.
- `num` — Quantity (typically `1`).
- `specialCardVoucher` — Set to `null` unless the user has a voucher.
- `attributes` — Array of selected attribute options. Each entry has `id` and `name` (the attribute group, e.g. temperature) and `itemId` and `itemName` (the selected option within that group, e.g. less ice).

## Order Flow

Follow these steps **in order** when the user wants to add a drink to the cart:

```
getDrinkings → user picks a drink from the menu
      ↓
getDrinkInfo(no) → get product detail with attribute options
      ↓
Prompt user to select attributes (temperature, sweetness, etc.)
      ↓
getShoppingCart → get current cart contents
      ↓
Append new item (with no, name, imageUrl, categoryId, num, selected attributes) to existing cart array
      ↓
updateShoppingCart(items) → save the updated full cart array
```

### Step 1 — Browse the Menu

**Function:** `getDrinkings`

Fetch the full drink menu. Present the available drinks to the user so they can pick one. Extract the product `no` from the chosen drink.

### Step 2 — Get Drink Details

**Function:** `getDrinkInfo`
**Params:** `no`

Fetch the detail for the selected drink. The response includes `attributes` — an array of attribute groups (e.g. "温度" / temperature, "甜度" / sweetness), each with available options. **Present these options to the user and ask them to choose.**

### Step 3 — Get Current Cart

**Function:** `getShoppingCart`

Fetch the current cart contents. This returns an array of existing items (may be empty).

### Step 4 — Update Cart

**Function:** `updateShoppingCart`
**Params:** `items`

Construct the new cart item using:
- `no`, `name`, `imageUrl`, `categoryId` from the `getDrinkInfo` response
- `num`: `1` (or the user-specified quantity)
- `specialCardVoucher`: `null`
- `attributes`: the user's selected options mapped to `{ id, name, itemId, itemName }` from the attribute groups

Append this item to the existing cart array from Step 3, then pass the full array as a JSON string to `updateShoppingCart`.

## Critical Rules

1. **Always call `getShoppingCart` before `updateShoppingCart`.** The update replaces the entire cart — omitting existing items will delete them.
2. **Always call `getDrinkInfo` before adding to cart.** The attribute options must come from the API response, not be guessed.
3. **Always prompt the user for attribute selections** when the drink has configurable attributes (temperature, sweetness, etc.). Do not pick defaults silently.
4. **The `items` parameter must be the complete cart array** — all existing items plus the new one.

## Usage

Use this skill when the user wants to:

- See what drinks are available at the miHoYo coffee shop
- Browse the coffee shop menu
- Check drink options and customizations
- Add a drink to the shopping cart
- View the current shopping cart
