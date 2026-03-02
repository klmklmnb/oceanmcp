import {
  FUNCTION_TYPE,
  OPERATION_TYPE,
  PARAMETER_TYPE,
  type CodeFunctionDefinition,
  type FunctionDefinition,
} from "@ocean-mcp/shared";

// ---------------------------------------------------------------------------
// Headers for miHoYo coffee-shop API
// ---------------------------------------------------------------------------

const HEADERS = `{
  "accept": "application/json, text/plain, */*",
  "accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
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
  "x-mi-clientid": "6a0c975fecff0bab",
  "x-request-id": "front-1772072750938-6410-2176-764039554"
}`;

/** Headers without content-type (for requests with null body) */
const HEADERS_NO_CT = `{
  "accept": "application/json, text/plain, */*",
  "accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
  "cache-control": "no-cache",
  "pragma": "no-cache",
  "priority": "u=1, i",
  "sec-ch-ua": "\\"Not:A-Brand\\";v=\\"99\\", \\"Google Chrome\\";v=\\"145\\", \\"Chromium\\";v=\\"145\\"",
  "sec-ch-ua-mobile": "?0",
  "sec-ch-ua-platform": "\\"macOS\\"",
  "sec-fetch-dest": "empty",
  "sec-fetch-mode": "cors",
  "sec-fetch-site": "same-site",
  "x-mi-clientid": "6a0c975fecff0bab",
  "x-request-id": "front-1772072750938-6410-2176-764039554"
}`;

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

function makeGetDrinkings(): CodeFunctionDefinition {
  return {
    id: "getDrinkings",
    name: "Get Drinkings",
    cnName: "获取饮品列表",
    description:
      "Fetch the list of available drinks from the miHoYo coffee shop. Returns the product page with all current drink offerings.",
    type: FUNCTION_TYPE.CODE,
    operationType: OPERATION_TYPE.READ,
    code: `return fetch("https://api.agw.mihoyo.com/coffee-shop/out/v1/user/shop/product/page", {
  headers: ${HEADERS},
  referrer: "https://m.app.mihoyo.com/",
  body: JSON.stringify({ shopNo: "012", type: 2 }),
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

function makeGetDrinkInfo(): CodeFunctionDefinition {
  return {
    id: "getDrinkInfo",
    name: "Get Drink Info",
    cnName: "获取饮品详情",
    description:
      "Fetch detailed information for a specific drink by product number. Returns the product detail including available attribute options (e.g. temperature, sweetness) that the user must choose from when ordering.",
    type: FUNCTION_TYPE.CODE,
    operationType: OPERATION_TYPE.READ,
    code: `return fetch("https://api.agw.mihoyo.com/coffee-shop/out/v1/user/product/info", {
  headers: ${HEADERS},
  referrer: "https://m.app.mihoyo.com/",
  body: JSON.stringify({ no: args.no }),
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
        name: "no",
        type: PARAMETER_TYPE.STRING,
        description:
          "Product number of the drink (e.g. \"000441\"). Obtain from the getDrinkings response.",
        required: true,
      },
    ],
  };
}

function makeGetShoppingCart(): CodeFunctionDefinition {
  return {
    id: "getShoppingCart",
    name: "Get Shopping Cart",
    cnName: "获取购物车",
    description:
      "Fetch the current shopping cart contents. Returns the list of items currently in the cart. Use this before updating the cart to know the existing items.",
    type: FUNCTION_TYPE.CODE,
    operationType: OPERATION_TYPE.READ,
    code: `return fetch("https://api.agw.mihoyo.com/coffee-shop/out/v1/user/shop/get/shopping/cart", {
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

function makeUpdateShoppingCart(): CodeFunctionDefinition {
  return {
    id: "updateShoppingCart",
    name: "Update Shopping Cart",
    cnName: "更新购物车",
    description:
      "Update the shopping cart with a new full cart array. The items parameter must be a JSON string representing the complete cart array. Each item in the array should have: no (product number), name, imageUrl, categoryId, num (quantity), specialCardVoucher (null if none), and attributes (array of {id, name, itemId, itemName} representing selected options like temperature and sweetness). Always call getShoppingCart first, append the new item to the existing array, then pass the full array here.",
    type: FUNCTION_TYPE.CODE,
    operationType: OPERATION_TYPE.WRITE,
    code: `return fetch("https://api.agw.mihoyo.com/coffee-shop/out/v1/user/shop/update/shopping/cart", {
  headers: ${HEADERS},
  referrer: "https://m.app.mihoyo.com/",
  body: args.items,
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
        name: "items",
        type: PARAMETER_TYPE.STRING,
        description:
          'JSON string of the full cart array. Each element: { "no": string, "name": string, "imageUrl": string, "categoryId": string, "num": number, "specialCardVoucher": null, "attributes": [{ "id": string, "name": string, "itemId": string, "itemName": string }] }. Must include all existing cart items plus the newly added item.',
        required: true,
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Export all mi-coffee functions
// ---------------------------------------------------------------------------

export const miCoffeeFunctions: FunctionDefinition[] = [
  makeGetDrinkings(),
  makeGetDrinkInfo(),
  makeGetShoppingCart(),
  makeUpdateShoppingCart(),
];
