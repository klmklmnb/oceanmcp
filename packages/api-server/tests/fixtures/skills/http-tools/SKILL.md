---
name: http-tools
description: HTTP request tools for fetching data from public APIs. Use when the user needs to make HTTP requests, check API status, or fetch data from URLs.
---

# HTTP Tools

Server-side HTTP tools that use `fetch()` to make real network requests.
These tools demonstrate code tools that depend on the server-provided `fetch` function.

## Available Tools

- **httpGet**: Make a GET request to any URL and return the response
- **checkUrl**: Check if a URL is reachable and return status info
- **fetchJson**: Fetch a JSON endpoint and optionally extract a specific path

## Notes

- These tools use the server-side `fetch` (not browser fetch)
- Cookies and browser credentials are NOT available
- Use for public APIs and endpoints that don't require browser auth

## Testing

Try these:
- "Check if https://httpbin.org/get is reachable"
- "Fetch JSON from https://httpbin.org/json"
- "Make a GET request to https://httpbin.org/headers"

See `references/api-examples.md` for more example endpoints.
