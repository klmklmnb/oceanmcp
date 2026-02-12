import { tool } from "ai";
import { z } from "zod";

const SERVER_STATUS = {
  HEALTHY: "healthy",
} as const;

/** Example server-side tool — retrieves server status information */
export const getServerStatus = tool({
  description: "Get the current server status and health information",
  inputSchema: z.object({}),
  execute: async () => {
    return {
      status: SERVER_STATUS.HEALTHY,
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      connections: 0, // Will be updated by the connection manager
    };
  },
});

/** Example server-side tool — echoes input for testing */
export const echo = tool({
  description: "Echo back the input for testing purposes",
  inputSchema: z.object({
    message: z.string().describe("The message to echo back"),
  }),
  execute: async ({ message }: { message: string }) => {
    return { echo: message, timestamp: new Date().toISOString() };
  },
});
