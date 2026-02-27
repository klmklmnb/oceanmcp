# Mi Food (米饭) Skill

Browse the miHoYo catering menu (米饭), view available meal segments, check daily food offerings, and pre-order meals for pickup.

This skill supports two distinct flows:

- **In-place eating (堂食)** — Browse the on-site cafeteria menu for dine-in.
- **Pre-order (预订)** — Browse available shops, view their menus, and add meals to the pre-order shopping cart.

## Capabilities

- **Get user info** — Fetch the current user's catering account information.
- **Get dining address** — Retrieve the user's configured dining location (building).
- **Get meal segments** — List available active meal segments (breakfast, lunch, dinner, etc.).
- **Get in-place menu** — Fetch the on-site cafeteria food menu for dine-in.
- **Get preorder shops** — List available shops for pre-ordering meals.
- **Get preorder shop menu** — Fetch a specific shop's pre-order menu.
- **Get preorder shopping cart** — View the current pre-order cart contents.
- **Add meals to preorder cart** — Update the pre-order shopping cart with selected meals.

## Shared Tools

These tools are used by **both** the in-place eating and pre-order flows.

### getMiFoodUserInfo (read)

Fetches the current user's catering account information. Returns user profile data needed as context for subsequent operations.

**Parameters:** None.

### getUserDiningAddress (read)

Fetches the user's dining address configuration. The response includes the `buildingId` which is required when fetching menus or managing the cart.

**Parameters:** None.

### getMealSegments (read)

Fetches all meal segments and returns only the **active** ones (where `status === true`). Each segment contains a `mealSegmentId` that identifies the meal time (e.g. breakfast, lunch, dinner).

**Parameters:** None.

## In-Place Eating Tools

### getMenu (read)

Fetches the food menu for a given date, meal segment, and building. Returns the full menu with all available food items and categories for dine-in.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `date` | string | yes | Date in `YYYY-MM-DD` format (e.g. `"2026-02-27"`). |
| `mealSegmentId` | number | yes | Meal segment ID (e.g. `2` for lunch). Obtain from `getMealSegments`. |
| `buildingId` | number | yes | Building ID for the dining location. Obtain from `getUserDiningAddress`. |

## Pre-order Tools

### getPreorderShops (read)

Fetches the list of available shops that offer pre-order meals for a given date, meal segment, and building. Returns shop information including `shopId` needed for fetching each shop's menu.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `date` | string | yes | Date in `YYYY-MM-DD` format (e.g. `"2026-02-27"`). |
| `mealSegmentId` | number | yes | Meal segment ID. Obtain from `getMealSegments`. |
| `buildingId` | number | yes | Building ID for the dining location. Obtain from `getUserDiningAddress`. |

### getPreorderShopMenu (read)

Fetches the pre-order menu for a specific shop. Returns the menu items available for pre-ordering from that shop. Call this for **each shop** returned by `getPreorderShops` and merge the results to get the complete preorder menu.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `date` | string | yes | Date in `YYYY-MM-DD` format (e.g. `"2026-02-27"`). |
| `mealSegmentId` | number | yes | Meal segment ID. Obtain from `getMealSegments`. |
| `buildingId` | number | yes | Building ID for the dining location. Obtain from `getUserDiningAddress`. |
| `shopId` | number | yes | Shop ID to fetch the menu for. Obtain from `getPreorderShops`. |

### getMealsShoppingCart (read)

Fetches the current pre-order shopping cart contents for a given building. Returns the list of meal items currently in the cart. **Must be called before `addMealsToShoppingCart`** to preserve existing items.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `buildingId` | number | yes | Building ID for the dining location. Obtain from `getUserDiningAddress`. |

### addMealsToShoppingCart (write)

Replaces the entire pre-order shopping cart with the provided cart array. The `cartList` parameter is a JSON string representing the **complete** cart — existing items plus any newly added items.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `cartList` | string | yes | JSON string of the full cart array. See [Pre-order Cart Item Schema](#pre-order-cart-item-schema) below. |
| `buildingId` | number | yes | Building ID for the dining location. Obtain from `getUserDiningAddress`. |

#### Pre-order Cart Item Schema

Each item in the cart array should have:

```json
{
  "date": "2026-02-27",
  "mealSegmentId": 3,
  "mealSegmentName": "晚餐",
  "mealName": "<微辣>藤椒牛肉轻食（有少量藤椒红油）",
  "mealId": 0,
  "menuId": 9455,
  "imageUrlKey": "2025089034407972864",
  "menuRelateMealId": 488296,
  "floorId": 0,
  "buildingId": 0,
  "fullFloorName": "英业达-北楼",
  "shopId": 451,
  "shopImageUrlKey": "2014191001763151872",
  "shopName": "优味鲜餐饮",
  "menuKind": "standardMenu",
  "createTime": 1772170425066,
  "description": "牛腱子120g&鲜玉米段50g&..."
}
```

- `date` — Date in `YYYY-MM-DD` format.
- `mealSegmentId` / `mealSegmentName` — Meal segment info from `getMealSegments`.
- `mealName` — Meal name from the shop menu.
- `mealId` — Meal ID (use `0` if not provided).
- `menuId` — Menu ID from the shop menu response.
- `imageUrlKey` — Image URL key from the shop menu response.
- `menuRelateMealId` — Menu-meal relation ID from the shop menu response.
- `floorId` / `buildingId` — Floor and building IDs (item-level, may differ from the top-level `buildingId`).
- `fullFloorName` — Full floor name from the shop menu response.
- `shopId` / `shopImageUrlKey` / `shopName` — Shop info from `getPreorderShops`.
- `menuKind` — Menu kind (e.g. `"standardMenu"`).
- `createTime` — Timestamp when the item was added (use `Date.now()`).
- `description` — Meal description from the shop menu response.

## In-Place Eating Flow (堂食)

Follow these steps **in order** when the user wants to see the dine-in food menu:

```
getMiFoodUserInfo → get user context
      ↓
getUserDiningAddress → extract buildingId from the response
      ↓
getMealSegments → get active meal segments, extract the desired mealSegmentId
      ↓
getMenu(date, mealSegmentId, buildingId) → fetch the in-place menu
```

### Step 1 — Get User Info

**Function:** `getMiFoodUserInfo`

Fetch the current user's catering account information. This establishes the user context for the session.

### Step 2 — Get Dining Address

**Function:** `getUserDiningAddress`

Fetch the user's dining address. Extract the `buildingId` from the response — this is required for the menu request.

### Step 3 — Get Meal Segments

**Function:** `getMealSegments`

Fetch available meal segments. The response is pre-filtered to only include active segments (`status === true`). Present the available segments to the user if there are multiple options, or automatically select the appropriate one based on the current time of day. Extract the `mealSegmentId` from the chosen segment.

### Step 4 — Get Menu

**Function:** `getMenu`
**Params:** `date`, `mealSegmentId`, `buildingId`

Fetch the menu using:
- `date`: today's date in `YYYY-MM-DD` format (or the user-specified date)
- `mealSegmentId`: from Step 3
- `buildingId`: from Step 2

Present the food menu to the user with item names, descriptions, and any other relevant details.

## Pre-order Flow (预订)

Follow these steps **in order** when the user wants to pre-order meals:

```
getMiFoodUserInfo → get user context
      ↓
getUserDiningAddress → extract buildingId
      ↓
getMealSegments → get active meal segments, extract mealSegmentId
      ↓
getPreorderShops(date, mealSegmentId, buildingId) → get list of shops
      ↓
For each shop: getPreorderShopMenu(date, mealSegmentId, buildingId, shopId) → merge all results
      ↓
Present merged menu to user → user picks meals
      ↓
getMealsShoppingCart(buildingId) → get current cart
      ↓
Merge current cart with new items → addMealsToShoppingCart(cartList, buildingId)
```

### Step 1–3 — Get User Info, Dining Address, and Meal Segments

Same as the in-place eating flow. Use `getMiFoodUserInfo`, `getUserDiningAddress`, and `getMealSegments` to obtain `buildingId` and `mealSegmentId`.

### Step 4 — Get Preorder Shops

**Function:** `getPreorderShops`
**Params:** `date`, `mealSegmentId`, `buildingId`

Fetch the list of available shops for pre-ordering. Extract the `shopId` from each shop in the response.

### Step 5 — Get Preorder Shop Menus

**Function:** `getPreorderShopMenu`
**Params:** `date`, `mealSegmentId`, `buildingId`, `shopId`

Call this for **each shop** returned in Step 4. Merge all the shop menu results together to build the complete pre-order menu. Present the full merged menu to the user so they can pick meals to order.

### Step 6 — Get Current Cart

**Function:** `getMealsShoppingCart`
**Params:** `buildingId`

Fetch the current pre-order shopping cart. This returns an array of existing items (may be empty).

### Step 7 — Update Cart

**Function:** `addMealsToShoppingCart`
**Params:** `cartList`, `buildingId`

Construct new cart items from the user's selected meals using fields from the shop menu response (`menuId`, `menuRelateMealId`, `mealName`, `imageUrlKey`, `description`, etc.) and shop info (`shopId`, `shopName`, `shopImageUrlKey`). Set `createTime` to `Date.now()`.

Merge these new items with the existing cart array from Step 6, then pass the full array as a JSON string to `addMealsToShoppingCart`.

## Critical Rules

### General

1. **Use the correct date format.** The `date` parameter must be in `YYYY-MM-DD` format.
2. **Do not guess IDs.** Always obtain `buildingId`, `mealSegmentId`, `shopId`, `menuId`, `menuRelateMealId`, etc. from their respective API responses rather than using hardcoded values.
3. **Always start with the shared steps.** Both flows require `getMiFoodUserInfo` → `getUserDiningAddress` → `getMealSegments` first.

### In-Place Eating

4. **Follow the in-place flow order.** `getMenu` requires `buildingId` from `getUserDiningAddress` and `mealSegmentId` from `getMealSegments`.
5. **Only use active meal segments.** The `getMealSegments` tool already filters for `status === true`.

### Pre-order

6. **Iterate all shops.** Call `getPreorderShopMenu` for **every** shop returned by `getPreorderShops` and merge the results. Do not skip shops.
7. **Always call `getMealsShoppingCart` before `addMealsToShoppingCart`.** The update replaces the entire cart — omitting existing items will delete them.
8. **The `cartList` parameter must be the complete cart array** — all existing items from `getMealsShoppingCart` plus newly added items.
9. **Do not mix in-place and preorder tools.** Use `getMenu` for dine-in browsing and `getPreorderShops` + `getPreorderShopMenu` for pre-order browsing. They serve different purposes and use different API versions.

## Usage

Use this skill when the user wants to:

- Check what food is available at the miHoYo cafeteria (米饭)
- Browse today's food menu (in-place eating)
- See what meals are available for a specific meal time (breakfast, lunch, dinner)
- Look up the catering menu for a specific date
- Pre-order meals for pickup
- Browse available pre-order shops and their menus
- Add meals to the pre-order shopping cart
- View the current pre-order shopping cart
