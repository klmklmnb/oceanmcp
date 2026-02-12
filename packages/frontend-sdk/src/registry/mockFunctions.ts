import type { CodeFunctionDefinition } from "@ocean-mcp/shared";

/**
 * Pre-registered mock functions for testing.
 * These are bundled with the SDK and available immediately.
 */
export const mockFunctions: CodeFunctionDefinition[] = [
  {
    id: "getCurrentPageInfo",
    name: "Get Current Page Info",
    description:
      "Returns information about the current page (URL, title, meta)",
    type: "code",
    operationType: "read",
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
    type: "code",
    operationType: "read",
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
        type: "string",
        description: "CSS selector to query (defaults to 'body')",
        required: false,
      },
    ],
  },
  {
    id: "fetchAPI",
    name: "Fetch API",
    description:
      "Makes a fetch request using the browser's authenticated session (cookies/tokens included)",
    type: "code",
    operationType: "read",
    code: `const response = await fetch(args.url, {
      method: args.method || 'GET',
      headers: args.headers || {},
      body: args.body ? JSON.stringify(args.body) : undefined,
      credentials: 'include',
    });
    const contentType = response.headers.get('content-type') || '';
    let data;
    if (contentType.includes('application/json')) {
      data = await response.json();
    } else {
      data = await response.text();
    }
    return { status: response.status, statusText: response.statusText, data }`,
    parameters: [
      {
        name: "url",
        type: "string",
        description: "The URL to fetch",
        required: true,
      },
      {
        name: "method",
        type: "string",
        description: "HTTP method (GET, POST, etc.)",
        required: false,
      },
      {
        name: "headers",
        type: "object",
        description: "Request headers",
        required: false,
      },
      {
        name: "body",
        type: "object",
        description: "Request body (for POST/PUT)",
        required: false,
      },
    ],
  },
  {
    id: "clickElement",
    name: "Click Element",
    description: "Clicks an element matching the given CSS selector",
    type: "code",
    operationType: "write",
    code: `const el = document.querySelector(args.selector);
    if (!el) return { error: 'Element not found: ' + args.selector };
    el.click();
    return { success: true, selector: args.selector }`,
    parameters: [
      {
        name: "selector",
        type: "string",
        description: "CSS selector of the element to click",
        required: true,
      },
    ],
  },
  {
    id: "fillInput",
    name: "Fill Input",
    description: "Sets the value of an input element",
    type: "code",
    operationType: "write",
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
        type: "string",
        description: "CSS selector of the input",
        required: true,
      },
      {
        name: "value",
        type: "string",
        description: "Value to set",
        required: true,
      },
    ],
  },
];
