type BridgeFn = (...args: any[]) => any;

const handlers = new Map<string, BridgeFn>();

export const chatBridge = {
  register(name: string, fn: BridgeFn) {
    handlers.set(name, fn);
  },

  unregister(name: string) {
    handlers.delete(name);
  },

  unregisterAll() {
    handlers.clear();
  },

  async call<T = void>(name: string, ...args: any[]): Promise<T> {
    const fn = handlers.get(name);
    if (!fn) {
      throw new Error(
        `[OceanMCP] Bridge method "${name}" not available. Is the chat widget mounted?`,
      );
    }
    return fn(...args);
  },

  has(name: string): boolean {
    return handlers.has(name);
  },

  get isReady() {
    return handlers.size > 0;
  },
};
