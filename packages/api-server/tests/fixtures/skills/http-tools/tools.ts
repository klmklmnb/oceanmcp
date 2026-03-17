export default {
  httpGet: {
    id: "httpGet",
    name: "HTTP GET",
    description:
      "Make a GET request to a URL and return the response body, status, " +
      "and selected headers. Supports text and JSON responses.",
    type: "code",
    operationType: "read",
    code: `
      const { url, headers: extraHeaders } = args;
      const reqHeaders = { "User-Agent": "OceanMCP-HttpTool/1.0" };
      if (extraHeaders) {
        Object.assign(reqHeaders, extraHeaders);
      }

      const startTime = Date.now();
      const res = await fetch(url, { headers: reqHeaders });
      const elapsed = Date.now() - startTime;

      const contentType = res.headers.get("content-type") || "";
      let body;
      if (contentType.includes("application/json")) {
        body = await res.json();
      } else {
        const text = await res.text();
        body = text.length > 5000 ? text.slice(0, 5000) + "... (truncated)" : text;
      }

      return {
        url,
        status: res.status,
        statusText: res.statusText,
        contentType,
        elapsedMs: elapsed,
        body,
      };
    `,
    parameters: [
      {
        name: "url",
        type: "string",
        description: "The URL to fetch",
        required: true,
      },
      {
        name: "headers",
        type: "object",
        description: "Optional extra request headers as key-value pairs",
        required: false,
      },
    ],
  },

  checkUrl: {
    id: "checkUrl",
    name: "Check URL",
    description:
      "Check if a URL is reachable. Returns status code, response time, " +
      "and basic response info without downloading the full body.",
    type: "code",
    operationType: "read",
    code: `
      const { url, timeoutMs } = args;
      const timeout = timeoutMs || 10000;

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout);

      try {
        const startTime = Date.now();
        const res = await fetch(url, {
          method: "HEAD",
          signal: controller.signal,
          headers: { "User-Agent": "OceanMCP-HttpTool/1.0" },
        });
        clearTimeout(timer);
        const elapsed = Date.now() - startTime;

        return {
          url,
          reachable: true,
          status: res.status,
          statusText: res.statusText,
          elapsedMs: elapsed,
          contentType: res.headers.get("content-type"),
          contentLength: res.headers.get("content-length"),
          server: res.headers.get("server"),
        };
      } catch (err) {
        clearTimeout(timer);
        return {
          url,
          reachable: false,
          error: err.message || String(err),
        };
      }
    `,
    parameters: [
      {
        name: "url",
        type: "string",
        description: "The URL to check",
        required: true,
      },
      {
        name: "timeoutMs",
        type: "number",
        description: "Timeout in milliseconds (default: 10000)",
        required: false,
      },
    ],
  },

  fetchJson: {
    id: "fetchJson",
    name: "Fetch JSON",
    description:
      "Fetch a JSON endpoint and optionally extract a value using " +
      'a dot-notation path (e.g. "data.items[0].name").',
    type: "code",
    operationType: "write",
    code: `
      const { url, path } = args;

      const res = await fetch(url, {
        headers: {
          "Accept": "application/json",
          "User-Agent": "OceanMCP-HttpTool/1.0",
        },
      });

      if (!res.ok) {
        return { error: "HTTP " + res.status + ": " + res.statusText, url };
      }

      const json = await res.json();

      if (!path) {
        return { url, data: json };
      }

      // Navigate the dot-path
      const segments = path.replace(/\\[(\\d+)\\]/g, ".$1").split(".");
      let current = json;
      for (const seg of segments) {
        if (current == null) break;
        current = current[seg];
      }

      return {
        url,
        path,
        value: current,
        found: current !== undefined,
      };
    `,
    parameters: [
      {
        name: "url",
        type: "string",
        description: "The JSON endpoint URL to fetch",
        required: true,
      },
      {
        name: "path",
        type: "string",
        description:
          'Optional dot-notation path to extract (e.g. "data.items[0].name")',
        required: false,
      },
    ],
  },
};
