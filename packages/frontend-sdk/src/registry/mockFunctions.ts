import {
  FUNCTION_TYPE,
  OPERATION_TYPE,
  PARAMETER_TYPE,
  type CodeFunctionDefinition,
} from "@ocean-mcp/shared";
import { hoyocloudFunctions } from "./preregistered";

// ---------------------------------------------------------------------------
// Exported mock functions
// ---------------------------------------------------------------------------

/**
 * Pre-registered mock functions for testing.
 * These are bundled with the SDK and available immediately.
 */
export const mockFunctions: CodeFunctionDefinition[] = [
  ...hoyocloudFunctions,
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
      "Returns the text content of the page or a specific CSS selector",
    type: FUNCTION_TYPE.CODE,
    operationType: OPERATION_TYPE.READ,
    code: `const selector = args.selector || 'body';
    const el = document.querySelector(selector);
    if (!el) return { error: 'Element not found: ' + selector };
    return {
      text: el.textContent?.trim().substring(0, 5000),
      html: el.innerHTML.substring(0, 5000),
      tagName: el.tagName,
    }`,
    parameters: [
      {
        name: "selector",
        type: PARAMETER_TYPE.STRING,
        description: "CSS selector to query (defaults to 'body')",
        required: false,
      },
    ],
  },
  {
    id: "clickElement",
    name: "Click Element",
    description: "Clicks an element matching the given CSS selector",
    type: FUNCTION_TYPE.CODE,
    operationType: OPERATION_TYPE.WRITE,
    code: `const el = document.querySelector(args.selector);
    if (!el) return { error: 'Element not found: ' + args.selector };
    el.click();
    return { success: true, selector: args.selector }`,
    parameters: [
      {
        name: "selector",
        type: PARAMETER_TYPE.STRING,
        description: "CSS selector of the element to click",
        required: true,
      },
    ],
  },
  {
    id: "fillInput",
    name: "Fill Input",
    description: "Sets the value of an input element",
    type: FUNCTION_TYPE.CODE,
    operationType: OPERATION_TYPE.WRITE,
    code: `const el = document.querySelector(args.selector);
    if (!el) return { error: 'Element not found: ' + args.selector };
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
    if (nativeInputValueSetter) {
      nativeInputValueSetter.call(el, args.value);
    } else {
      el.value = args.value;
    }
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return { success: true, selector: args.selector, value: args.value }`,
    parameters: [
      {
        name: "selector",
        type: PARAMETER_TYPE.STRING,
        description: "CSS selector of the input",
        required: true,
      },
      {
        name: "value",
        type: PARAMETER_TYPE.STRING,
        description: "Value to set",
        required: true,
      },
    ],
  },
];
