import {
  FUNCTION_TYPE,
  OPERATION_TYPE,
  PARAMETER_TYPE,
  type CodeFunctionDefinition,
  type FunctionDefinition,
} from "@ocean-mcp/shared";

// ---------------------------------------------------------------------------
// Headers for miHoYo catering (miFood) API
// ---------------------------------------------------------------------------

const HEADERS = `{
  "accept": "application/json, text/plain, */*",
  "accept-language": "zh-CN",
  "cache-control": "no-cache",
  "content-type": "application/json",
  "pragma": "no-cache",
  "priority": "u=1, i",
  "sec-ch-ua": "\\"Not:A-Brand\\";v=\\"99\\", \\"Google Chrome\\";v=\\"145\\", \\"Chromium\\";v=\\"145\\"",
  "sec-ch-ua-mobile": "?0",
  "sec-ch-ua-platform": "\\"macOS\\"",
  "sec-fetch-dest": "empty",
  "sec-fetch-mode": "cors",
  "sec-fetch-site": "same-site",
  "x-mi-clientid": "9cb95b7534cec557",
  "x-request-id": "front-1772163532570-51-9345-259214977"
}`;

/** Headers without content-type (for requests with null body) */
const HEADERS_NO_CT = `{
  "accept": "application/json, text/plain, */*",
  "accept-language": "zh-CN",
  "cache-control": "no-cache",
  "pragma": "no-cache",
  "priority": "u=1, i",
  "sec-ch-ua": "\\"Not:A-Brand\\";v=\\"99\\", \\"Google Chrome\\";v=\\"145\\", \\"Chromium\\";v=\\"145\\"",
  "sec-ch-ua-mobile": "?0",
  "sec-ch-ua-platform": "\\"macOS\\"",
  "sec-fetch-dest": "empty",
  "sec-fetch-mode": "cors",
  "sec-fetch-site": "same-site",
  "x-mi-clientid": "9cb95b7534cec557",
  "x-request-id": "front-1772163532570-51-9345-259214977"
}`;

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

function makeGetMiFoodUserInfo(): CodeFunctionDefinition {
  return {
    id: "getMiFoodUserInfo",
    name: "Get MiFood User Info",
    description:
      "Fetch the current user's catering account information from miFood (米饭). Returns user profile data needed for subsequent catering operations.",
    type: FUNCTION_TYPE.CODE,
    operationType: OPERATION_TYPE.READ,
    code: `return fetch("https://api.agw.mihoyo.com/catering-user/v1/common/get_user", {
  headers: ${HEADERS_NO_CT},
  referrer: "https://m.app.mihoyo.com/",
  body: null,
  method: "POST",
  mode: "cors",
  credentials: "include",
}).then(response => response.json())
  .then(res => {
    if (res.code !== 0) { throw new Error(res.message); }
    return res.data;
  });
`,
    parameters: [],
  };
}

function makeGetUserDiningAddress(): CodeFunctionDefinition {
  return {
    id: "getUserDiningAddress",
    name: "Get User Dining Address",
    description:
      "Fetch the current user's dining address information. Returns the user's configured dining location including buildingId, which is required for fetching the menu.",
    type: FUNCTION_TYPE.CODE,
    operationType: OPERATION_TYPE.READ,
    code: `return fetch("https://api.agw.mihoyo.com/catering-user/v1/address/dining/user/get", {
  headers: ${HEADERS},
  referrer: "https://m.app.mihoyo.com/",
  body: "{}",
  method: "POST",
  mode: "cors",
  credentials: "include",
}).then(response => response.json())
  .then(res => {
    if (res.code !== 0) { throw new Error(res.message); }
    return res.data;
  });
`,
    parameters: [],
  };
}

function makeGetMealSegments(): CodeFunctionDefinition {
  return {
    id: "getMealSegments",
    name: "Get Meal Segments",
    description:
      "Fetch available meal segments (e.g. breakfast, lunch, dinner). Returns only active meal segments (status === true). Each segment contains a mealSegmentId needed for fetching the menu.",
    type: FUNCTION_TYPE.CODE,
    operationType: OPERATION_TYPE.READ,
    code: `return fetch("https://api.agw.mihoyo.com/catering-user/v1/shopping/meal/segment/get", {
  headers: ${HEADERS_NO_CT},
  referrer: "https://m.app.mihoyo.com/",
  body: null,
  method: "POST",
  mode: "cors",
  credentials: "include",
}).then(response => response.json())
  .then(res => {
    if (res.code !== 0) { throw new Error(res.message); }
    return res.data.mealSegmentList.filter(item => item.status === true);
  });
`,
    parameters: [],
  };
}

function makeGetMenu(): CodeFunctionDefinition {
  return {
    id: "getMenu",
    name: "Get Menu",
    description:
      "Fetch the food menu for a specific date, meal segment, and building. Returns the full menu with available food items. Requires date, mealSegmentId (from getMealSegments), and buildingId (from getUserDiningAddress).",
    type: FUNCTION_TYPE.CODE,
    operationType: OPERATION_TYPE.READ,
    code: `return fetch("https://api.agw.mihoyo.com/catering-user/v1/offline/menu/get", {
  headers: ${HEADERS},
  referrer: "https://m.app.mihoyo.com/",
  body: JSON.stringify({ date: args.date, mealSegmentId: args.mealSegmentId, buildingId: args.buildingId }),
  method: "POST",
  mode: "cors",
  credentials: "include",
}).then(response => response.json())
  .then(res => {
    if (res.code !== 0) { throw new Error(res.message); }
    return res.data;
  });
`,
    parameters: [
      {
        name: "date",
        type: PARAMETER_TYPE.STRING,
        description:
          'Date for the menu in YYYY-MM-DD format (e.g. "2026-02-27"). Defaults to today\'s date.',
        required: true,
      },
      {
        name: "mealSegmentId",
        type: PARAMETER_TYPE.NUMBER,
        description:
          "Meal segment ID (e.g. 2 for lunch). Obtain from the getMealSegments response.",
        required: true,
      },
      {
        name: "buildingId",
        type: PARAMETER_TYPE.NUMBER,
        description:
          "Building ID for the dining location. Obtain from the getUserDiningAddress response.",
        required: true,
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Pre-order tool definitions
// ---------------------------------------------------------------------------

function makeGetPreorderShops(): CodeFunctionDefinition {
  return {
    id: "getPreorderShops",
    name: "Get Preorder Shops",
    description:
      "Fetch the list of available shops for pre-ordering meals on a given date, meal segment, and building. Returns shop information including shopId needed for fetching each shop's menu. Requires date, mealSegmentId (from getMealSegments), and buildingId (from getUserDiningAddress).",
    type: FUNCTION_TYPE.CODE,
    operationType: OPERATION_TYPE.READ,
    code: `return fetch("https://api.agw.mihoyo.com/catering-user/v2/shopping/online/shop/get", {
  headers: ${HEADERS},
  referrer: "https://m.app.mihoyo.com/",
  body: JSON.stringify({ date: args.date, mealSegmentId: args.mealSegmentId, buildingId: args.buildingId }),
  method: "POST",
  mode: "cors",
  credentials: "include",
}).then(response => response.json())
  .then(res => {
    if (res.code !== 0) { throw new Error(res.message); }
    return res.data;
  });
`,
    parameters: [
      {
        name: "date",
        type: PARAMETER_TYPE.STRING,
        description:
          'Date for the preorder in YYYY-MM-DD format (e.g. "2026-02-27").',
        required: true,
      },
      {
        name: "mealSegmentId",
        type: PARAMETER_TYPE.NUMBER,
        description:
          "Meal segment ID (e.g. 3 for dinner). Obtain from the getMealSegments response.",
        required: true,
      },
      {
        name: "buildingId",
        type: PARAMETER_TYPE.NUMBER,
        description:
          "Building ID for the dining location. Obtain from the getUserDiningAddress response.",
        required: true,
      },
    ],
  };
}

function makeGetPreorderShopMenu(): CodeFunctionDefinition {
  return {
    id: "getPreorderShopMenu",
    name: "Get Preorder Shop Menu",
    description:
      "Fetch the pre-order menu for a specific shop. Returns the menu items available for pre-ordering from that shop. Call this for each shop returned by getPreorderShops and merge the results to get the full preorder menu.",
    type: FUNCTION_TYPE.CODE,
    operationType: OPERATION_TYPE.READ,
    code: `return fetch("https://api.agw.mihoyo.com/catering-user/v2/shopping/online/menu/get", {
  headers: ${HEADERS},
  referrer: "https://m.app.mihoyo.com/",
  body: JSON.stringify({ date: args.date, mealSegmentId: args.mealSegmentId, buildingId: args.buildingId, shopId: args.shopId }),
  method: "POST",
  mode: "cors",
  credentials: "include",
}).then(response => response.json())
  .then(res => {
    if (res.code !== 0) { throw new Error(res.message); }
    return res.data;
  });
`,
    parameters: [
      {
        name: "date",
        type: PARAMETER_TYPE.STRING,
        description:
          'Date for the preorder in YYYY-MM-DD format (e.g. "2026-02-27").',
        required: true,
      },
      {
        name: "mealSegmentId",
        type: PARAMETER_TYPE.NUMBER,
        description:
          "Meal segment ID. Obtain from the getMealSegments response.",
        required: true,
      },
      {
        name: "buildingId",
        type: PARAMETER_TYPE.NUMBER,
        description:
          "Building ID for the dining location. Obtain from the getUserDiningAddress response.",
        required: true,
      },
      {
        name: "shopId",
        type: PARAMETER_TYPE.NUMBER,
        description:
          "Shop ID to fetch the menu for. Obtain from the getPreorderShops response.",
        required: true,
      },
    ],
  };
}

function makeGetMealsShoppingCart(): CodeFunctionDefinition {
  return {
    id: "getMealsShoppingCart",
    name: "Get Meals Shopping Cart",
    description:
      "Fetch the current pre-order shopping cart contents for a given building. Returns the list of meal items currently in the cart. Must be called before addMealsToShoppingCart to preserve existing items.",
    type: FUNCTION_TYPE.CODE,
    operationType: OPERATION_TYPE.READ,
    code: `return fetch("https://api.agw.mihoyo.com/catering-user/v2/shopping_cart/list", {
  headers: ${HEADERS},
  referrer: "https://m.app.mihoyo.com/",
  body: JSON.stringify({ buildingId: args.buildingId }),
  method: "POST",
  mode: "cors",
  credentials: "include",
}).then(response => response.json())
  .then(res => {
    if (res.code !== 0) { throw new Error(res.message); }
    return res.data;
  });
`,
    parameters: [
      {
        name: "buildingId",
        type: PARAMETER_TYPE.NUMBER,
        description:
          "Building ID for the dining location. Obtain from the getUserDiningAddress response.",
        required: true,
      },
    ],
  };
}

function makeAddMealsToShoppingCart(): CodeFunctionDefinition {
  return {
    id: "addMealsToShoppingCart",
    name: "Add Meals to Shopping Cart",
    description:
      "Update the pre-order shopping cart with a full cart array. The cartList parameter must be a JSON string representing the complete cart array (existing items + newly added items). Always call getMealsShoppingCart first, merge the current cart with new items, then pass the full array here. Each cart item should include: date, mealSegmentId, mealSegmentName, mealName, mealId, menuId, imageUrlKey, menuRelateMealId, floorId, buildingId (item-level), fullFloorName, shopId, shopImageUrlKey, shopName, menuKind, createTime, description, and optionally salesCount/status.",
    type: FUNCTION_TYPE.CODE,
    operationType: OPERATION_TYPE.WRITE,
    code: `return fetch("https://api.agw.mihoyo.com/catering-user/v2/shopping_cart/update", {
  headers: ${HEADERS},
  referrer: "https://m.app.mihoyo.com/",
  body: JSON.stringify({ cartList: JSON.parse(args.cartList), buildingId: args.buildingId }),
  method: "POST",
  mode: "cors",
  credentials: "include",
}).then(response => response.json())
  .then(res => {
    if (res.code !== 0) { throw new Error(res.message); }
    return res.data;
  });
`,
    parameters: [
      {
        name: "cartList",
        type: PARAMETER_TYPE.STRING,
        showName: "购物车菜品",
        description:
          'JSON string of the full cart array. Each element should contain: date, mealSegmentId, mealSegmentName, mealName, mealId, menuId, imageUrlKey, menuRelateMealId, floorId, buildingId, fullFloorName, shopId, shopImageUrlKey, shopName, menuKind, createTime, description. Must include all existing cart items plus newly added items.',
        required: true,
        columns: {
          mealName: { label: "菜品名称" },
          shopName: { label: "店铺" },
          date: { label: "日期" },
          mealSegmentName: { label: "餐段" },
          description: { label: "描述" },
          menuKind: { label: "类别" },
          fullFloorName: { label: "楼层" },
        },
      },
      {
        name: "buildingId",
        type: PARAMETER_TYPE.NUMBER,
        description:
          "Building ID for the dining location. Obtain from the getUserDiningAddress response.",
        required: true,
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Export all mi-food functions
// ---------------------------------------------------------------------------

export const miFoodFunctions: FunctionDefinition[] = [
  // In-place eating tools
  makeGetMiFoodUserInfo(),
  makeGetUserDiningAddress(),
  makeGetMealSegments(),
  makeGetMenu(),
  // Pre-order tools
  makeGetPreorderShops(),
  makeGetPreorderShopMenu(),
  makeGetMealsShoppingCart(),
  makeAddMealsToShoppingCart(),
];
