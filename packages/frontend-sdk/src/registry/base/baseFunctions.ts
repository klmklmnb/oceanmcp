import {
  FUNCTION_TYPE,
  OPERATION_TYPE,
  PARAMETER_TYPE,
  type CodeFunctionDefinition,
  type JSONSchemaParameters,
} from "@ocean-mcp/shared";

// ---------------------------------------------------------------------------
// Exported base functions
// ---------------------------------------------------------------------------

/**
 * Pre-registered base functions that ship with the SDK.
 * These are bundled with the SDK and available immediately.
 *
 * Note: Domain-specific tools (e.g. hoyocloud) are now registered via
 * skills (see preregistered/devops-skill.ts) instead of being listed here.
 */
export const baseFunctions: CodeFunctionDefinition[] = [
  {
    id: "getCurrentPageInfo",
    name: "Get Current Page Info",
    description:
      "Returns information about the current page (URL, title, meta)",
    type: FUNCTION_TYPE.CODE,
    operationType: OPERATION_TYPE.READ,
    code: `return {
      url: window.location.href,
      title: document.title,
      pathname: window.location.pathname,
      search: window.location.search,
      referrer: document.referrer,
      userAgent: navigator.userAgent,
    }`,
    parameters: [],
  },
  {
    id: "getPageContent",
    name: "Get Page Content",
    description:
      "Returns the text content of the page for one or more CSS selectors. " +
      "Accepts a single selector string or an array of selectors. " +
      "Each selector uses querySelectorAll so multiple matches are returned.",
    type: FUNCTION_TYPE.CODE,
    operationType: OPERATION_TYPE.READ,
    code: `const raw = args.selectors || ['body'];
    const selectors = Array.isArray(raw) ? raw : [raw];
    const results = [];
    for (const selector of selectors) {
      const els = document.querySelectorAll(selector);
      if (els.length === 0) {
        results.push({ selector, error: 'No elements found: ' + selector });
        continue;
      }
      const matches = [];
      els.forEach((el, i) => {
        matches.push({
          index: i,
          text: el.textContent?.trim().substring(0, 5000),
          html: el.innerHTML.substring(0, 5000),
          tagName: el.tagName,
        });
      });
      results.push({ selector, count: els.length, matches });
    }
    if (results.length === 1) return results[0];
    return results;`,
    parameters: [
      {
        name: "selectors",
        type: PARAMETER_TYPE.STRING_ARRAY,
        description:
          "Array of CSS selectors to query (defaults to ['body']). Also accepts a single string.",
        required: false,
      },
    ],
  },
  // {
  //   id: "clickElement",
  //   name: "Click Element",
  //   description: "Clicks an element matching the given CSS selector",
  //   type: FUNCTION_TYPE.CODE,
  //   operationType: OPERATION_TYPE.WRITE,
  //   code: `const el = document.querySelector(args.selector);
  //   if (!el) return { error: 'Element not found: ' + args.selector };
  //   el.click();
  //   return { success: true, selector: args.selector }`,
  //   parameters: [
  //     {
  //       name: "selector",
  //       type: PARAMETER_TYPE.STRING,
  //       description: "CSS selector of the element to click",
  //       required: true,
  //     },
  //   ],
  // },
  // {
  //   id: "fillInput",
  //   name: "Fill Input",
  //   description: "Sets the value of an input element",
  //   type: FUNCTION_TYPE.CODE,
  //   operationType: OPERATION_TYPE.WRITE,
  //   code: `const el = document.querySelector(args.selector);
  //   if (!el) return { error: 'Element not found: ' + args.selector };
  //   const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
  //   if (nativeInputValueSetter) {
  //     nativeInputValueSetter.call(el, args.value);
  //   } else {
  //     el.value = args.value;
  //   }
  //   el.dispatchEvent(new Event('input', { bubbles: true }));
  //   el.dispatchEvent(new Event('change', { bubbles: true }));
  //   return { success: true, selector: args.selector, value: args.value }`,
  //   parameters: [
  //     {
  //       name: "selector",
  //       type: PARAMETER_TYPE.STRING,
  //       description: "CSS selector of the input",
  //       required: true,
  //     },
  //     {
  //       name: "value",
  //       type: PARAMETER_TYPE.STRING,
  //       description: "Value to set",
  //       required: true,
  //     },
  //   ],
  // },
  {
    id: "getCurrentDate",
    name: "Get Current Date",
    description:
      "Returns the current date and time from the user's browser, including locale, timezone, and various formatted representations",
    type: FUNCTION_TYPE.CODE,
    operationType: OPERATION_TYPE.READ,
    code: `const now = new Date();
    const locale = navigator.language || 'en-US';
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return {
      iso: now.toISOString(),
      locale: locale,
      timeZone: timeZone,
      localeString: now.toLocaleString(locale, { timeZone }),
      date: now.toLocaleDateString(locale, { timeZone }),
      time: now.toLocaleTimeString(locale, { timeZone }),
      year: now.getFullYear(),
      month: now.getMonth() + 1,
      day: now.getDate(),
      dayOfWeek: now.toLocaleDateString(locale, { weekday: 'long', timeZone }),
      timestamp: now.getTime(),
      timezoneOffset: now.getTimezoneOffset(),
    }`,
    parameters: [],
  },
  {
    id: "updateTitle",
    name: "Update Page Title",
    description:
      "Sets the document title of the current page. " +
      "This is a write operation with autoApprove enabled, so it executes immediately without user confirmation.",
    type: FUNCTION_TYPE.CODE,
    operationType: OPERATION_TYPE.WRITE,
    autoApprove: true,
    code: `const prev = document.title;
    document.title = args.title;
    return { success: true, previousTitle: prev, newTitle: args.title }`,
    parameters: [
      {
        name: "title",
        type: PARAMETER_TYPE.STRING,
        description: "The new page title to set",
        required: true,
      },
    ],
  },
];

// ---------------------------------------------------------------------------
// JSON Schema test tools — demonstrate the new JSON Schema parameter format
// ---------------------------------------------------------------------------

/**
 * Test tools using JSON Schema parameters instead of ParameterDefinition[].
 *
 * These demonstrate the richer type definitions possible with JSON Schema:
 * - Nested object properties
 * - Number constraints (min/max)
 * - String patterns and enums
 * - Array item schemas
 * - Default values
 */
export const jsonSchemaTestTools: CodeFunctionDefinition[] = [
  {
    id: "calculateShipping",
    name: "Calculate Shipping Cost",
    cnName: "计算运费",
    description:
      "Calculate shipping cost for a package based on weight, destination, and shipping options.",
    type: FUNCTION_TYPE.CODE,
    operationType: OPERATION_TYPE.READ,
    code: `
      const { weight, destination, express, insurance } = args;
      const baseRate = 10;
      const perKg = express ? 8 : 5;
      const insuranceFee = insurance?.enabled ? (insurance.value || 0) * 0.02 : 0;
      const cost = baseRate + weight * perKg + insuranceFee;
      return {
        weight,
        destination,
        express: express || false,
        insurance: insurance || { enabled: false },
        cost: Math.round(cost * 100) / 100,
        currency: "CNY",
        estimatedDays: express ? "1-2" : "3-5",
      };
    `,
    parameters: {
      type: "object",
      required: ["weight", "destination"],
      properties: {
        weight: {
          type: "number",
          description: "包裹重量（千克）",
          minimum: 0.1,
          maximum: 50,
        },
        destination: {
          type: "string",
          description: "目的地国家/城市",
        },
        express: {
          type: "boolean",
          description: "是否使用加急物流",
          default: false,
        },
        insurance: {
          type: "object",
          description: "保险选项",
          properties: {
            enabled: {
              type: "boolean",
              description: "是否购买保险",
              default: false,
            },
            value: {
              type: "number",
              description: "物品申报价值（元）",
              minimum: 0,
            },
          },
          additionalProperties: false,
        },
      },
      additionalProperties: false,
    } satisfies JSONSchemaParameters,
  },
  {
    id: "createUser",
    name: "Create User Profile",
    cnName: "创建用户资料",
    description:
      "Create a new user profile with detailed information. Demonstrates nested objects and array types in JSON Schema.",
    type: FUNCTION_TYPE.CODE,
    operationType: OPERATION_TYPE.WRITE,
    code: `
      return {
        id: "usr_" + Math.random().toString(36).substr(2, 9),
        ...args,
        createdAt: new Date().toISOString(),
      };
    `,
    parameters: {
      type: "object",
      required: ["name", "email", "role"],
      properties: {
        name: {
          type: "string",
          description: "用户姓名",
          minLength: 1,
          maxLength: 100,
        },
        email: {
          type: "string",
          description: "电子邮箱",
          format: "email",
        },
        role: {
          type: "string",
          description: "用户角色",
          enum: ["admin", "editor", "viewer"],
        },
        age: {
          type: "number",
          description: "年龄",
          minimum: 0,
          maximum: 150,
        },
        tags: {
          type: "array",
          description: "用户标签",
          items: {
            type: "string",
          },
          minItems: 0,
          maxItems: 10,
          uniqueItems: true,
        },
        address: {
          type: "object",
          description: "地址信息",
          properties: {
            street: { type: "string", description: "街道地址" },
            city: { type: "string", description: "城市" },
            country: { type: "string", description: "国家", default: "CN" },
            zipCode: {
              type: "string",
              description: "邮编",
              pattern: "^[0-9]{6}$",
            },
          },
          required: ["city", "country"],
        },
      },
      additionalProperties: false,
    } satisfies JSONSchemaParameters,
  },
];
