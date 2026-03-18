// ─── Demo Shared State Stores ────────────────────────────────────────────────
// Simple event-emitter stores shared between React components and tool executors.
// Uses useSyncExternalStore-compatible API for React integration.

// ─── TODO Store ──────────────────────────────────────────────────────────────

export interface TodoItem {
  id: string;
  title: string;
  description?: string;
  status: "pending" | "in-progress" | "done";
  priority: "high" | "medium" | "low";
  dueDate?: string;
  createdAt: string;
}

type Listener = () => void;

class TodoStore {
  private items: TodoItem[] = [];
  private listeners = new Set<Listener>();
  private nextId = 1;

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): TodoItem[] => {
    return this.items;
  };

  private emit() {
    // Create a new array reference so React detects the change
    this.items = [...this.items];
    this.listeners.forEach((l) => l());
  }

  add(item: Omit<TodoItem, "id" | "createdAt">): TodoItem {
    const newItem: TodoItem = {
      ...item,
      id: `todo-${this.nextId++}`,
      createdAt: new Date().toISOString(),
    };
    this.items = [...this.items, newItem];
    this.emit();
    return newItem;
  }

  update(id: string, updates: Partial<Omit<TodoItem, "id" | "createdAt">>): TodoItem | null {
    const index = this.items.findIndex((t) => t.id === id);
    if (index === -1) return null;
    const updated = { ...this.items[index], ...updates };
    this.items = [...this.items];
    this.items[index] = updated;
    this.emit();
    return updated;
  }

  delete(id: string): boolean {
    const before = this.items.length;
    this.items = this.items.filter((t) => t.id !== id);
    if (this.items.length !== before) {
      this.emit();
      return true;
    }
    return false;
  }

  clearCompleted(): number {
    const before = this.items.length;
    this.items = this.items.filter((t) => t.status !== "done");
    const removed = before - this.items.length;
    if (removed > 0) this.emit();
    return removed;
  }

  getAll(): TodoItem[] {
    return this.items;
  }

  reset(): void {
    this.items = [];
    this.nextId = 1;
    this.emit();
  }

  /** Bulk-load initial items without emitting per-item. */
  seed(items: Omit<TodoItem, "id" | "createdAt">[]): void {
    for (const item of items) {
      this.items.push({
        ...item,
        id: `todo-${this.nextId++}`,
        createdAt: new Date().toISOString(),
      });
    }
  }
}

export const todoStore = new TodoStore();

// ── Pre-populate with sample data so the demo is immediately interactive ─────
todoStore.seed([
  {
    title: "Set up CI/CD pipeline",
    description: "Configure GitHub Actions for automated testing and deployment",
    status: "in-progress",
    priority: "high",
    dueDate: "2026-03-20",
  },
  {
    title: "Write unit tests for auth module",
    description: "Cover login, signup, token refresh, and password reset flows",
    status: "pending",
    priority: "high",
    dueDate: "2026-03-22",
  },
  {
    title: "Refactor database queries",
    description: "Optimize N+1 queries in the user dashboard endpoint",
    status: "pending",
    priority: "medium",
    dueDate: "2026-03-25",
  },
  {
    title: "Update API documentation",
    description: "Sync OpenAPI spec with the latest endpoint changes",
    status: "pending",
    priority: "low",
    dueDate: "2026-03-28",
  },
  {
    title: "Design review for v2.0",
    description: "Review mockups and finalize the new dashboard layout",
    status: "done",
    priority: "medium",
    dueDate: "2026-03-15",
  },
]);

// ─── Flow Store ──────────────────────────────────────────────────────────────

export interface FlowNode {
  id: string;
  type?: "input" | "default" | "output";
  data: { label: string };
  position: { x: number; y: number };
  style?: Record<string, string | number>;
}

export interface FlowEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
  animated?: boolean;
  type?: string;
}

export interface FlowState {
  nodes: FlowNode[];
  edges: FlowEdge[];
}

class FlowStore {
  private state: FlowState = { nodes: [], edges: [] };
  private listeners = new Set<Listener>();
  private nextNodeId = 1;
  private nextEdgeId = 1;

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): FlowState => {
    return this.state;
  };

  private emit() {
    this.state = { ...this.state };
    this.listeners.forEach((l) => l());
  }

  addNode(node: Omit<FlowNode, "id"> & { id?: string }): FlowNode {
    const newNode: FlowNode = {
      ...node,
      id: node.id || `node-${this.nextNodeId++}`,
    };
    this.state = {
      ...this.state,
      nodes: [...this.state.nodes, newNode],
    };
    this.emit();
    return newNode;
  }

  updateNode(id: string, updates: Partial<Omit<FlowNode, "id">>): FlowNode | null {
    const index = this.state.nodes.findIndex((n) => n.id === id);
    if (index === -1) return null;
    const updated = { ...this.state.nodes[index] };
    if (updates.data) updated.data = { ...updated.data, ...updates.data };
    if (updates.position) updated.position = { ...updates.position };
    if (updates.style) updated.style = { ...updated.style, ...updates.style };
    if (updates.type !== undefined) updated.type = updates.type;
    const nodes = [...this.state.nodes];
    nodes[index] = updated;
    this.state = { ...this.state, nodes };
    this.emit();
    return updated;
  }

  deleteNode(id: string): boolean {
    const before = this.state.nodes.length;
    const nodes = this.state.nodes.filter((n) => n.id !== id);
    const edges = this.state.edges.filter((e) => e.source !== id && e.target !== id);
    if (nodes.length !== before) {
      this.state = { nodes, edges };
      this.emit();
      return true;
    }
    return false;
  }

  addEdge(edge: Omit<FlowEdge, "id"> & { id?: string }): FlowEdge {
    const newEdge: FlowEdge = {
      ...edge,
      id: edge.id || `edge-${this.nextEdgeId++}`,
    };
    this.state = {
      ...this.state,
      edges: [...this.state.edges, newEdge],
    };
    this.emit();
    return newEdge;
  }

  deleteEdge(id: string): boolean {
    const before = this.state.edges.length;
    const edges = this.state.edges.filter((e) => e.id !== id);
    if (edges.length !== before) {
      this.state = { ...this.state, edges };
      this.emit();
      return true;
    }
    return false;
  }

  clear(): void {
    this.state = { nodes: [], edges: [] };
    this.nextNodeId = 1;
    this.nextEdgeId = 1;
    this.emit();
  }

  getState(): FlowState {
    return this.state;
  }

  /** Simple auto-layout: arrange nodes in a top-down tree */
  autoLayout(): void {
    const nodes = [...this.state.nodes];
    const cols = Math.ceil(Math.sqrt(nodes.length));
    const spacingX = 220;
    const spacingY = 120;
    nodes.forEach((node, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      nodes[i] = {
        ...node,
        position: { x: col * spacingX + 50, y: row * spacingY + 50 },
      };
    });
    this.state = { ...this.state, nodes };
    this.emit();
  }

  reset(): void {
    this.clear();
  }
}

export const flowStore = new FlowStore();

// ─── Form Store ──────────────────────────────────────────────────────────────

export interface FormPreview {
  schema: Record<string, any> | null;
  title: string;
  lastSubmission: Record<string, any> | null;
}

class FormStore {
  private state: FormPreview = { schema: null, title: "", lastSubmission: null };
  private listeners = new Set<Listener>();

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): FormPreview => {
    return this.state;
  };

  private emit() {
    this.state = { ...this.state };
    this.listeners.forEach((l) => l());
  }

  setSchema(schema: Record<string, any>, title: string): void {
    this.state = { ...this.state, schema, title };
    this.emit();
  }

  setSubmission(data: Record<string, any>): void {
    this.state = { ...this.state, lastSubmission: data };
    this.emit();
  }

  reset(): void {
    this.state = { schema: null, title: "", lastSubmission: null };
    this.emit();
  }

  getState(): FormPreview {
    return this.state;
  }
}

export const formStore = new FormStore();

// ─── Order / Query Table Store ───────────────────────────────────────────────

export interface Order {
  id: string;
  customer: string;
  email: string;
  product: string;
  category: "Electronics" | "Clothing" | "Home & Kitchen" | "Books" | "Sports" | "Beauty";
  status: "delivered" | "shipped" | "processing" | "cancelled" | "refunded";
  orderDate: string; // YYYY-MM-DD
  amount: number;
  paymentMethod: "credit_card" | "paypal" | "bank_transfer" | "crypto";
  shippingRegion: "North America" | "Europe" | "Asia" | "Oceania" | "South America";
  couponUsed: boolean;
  rating: number | null; // 1-5 or null
  platform: "web" | "mobile_ios" | "mobile_android";
  fulfillment: "standard" | "express" | "same_day";
  quantity: number;
}

export interface OrderFilters {
  search: string;
  category: string[];
  status: string[];
  dateFrom: string;
  dateTo: string;
  amountMin: string;
  amountMax: string;
  paymentMethod: string;
  shippingRegion: string[];
  couponUsed: "any" | "yes" | "no";
  rating: string;
  platform: string[];
  fulfillment: string;
}

export interface OrderStoreState {
  filters: OrderFilters;
  filteredOrders: Order[];
  totalOrders: number;
}

const DEFAULT_FILTERS: OrderFilters = {
  search: "",
  category: [],
  status: [],
  dateFrom: "",
  dateTo: "",
  amountMin: "",
  amountMax: "",
  paymentMethod: "",
  shippingRegion: [],
  couponUsed: "any",
  rating: "",
  platform: [],
  fulfillment: "",
};

class OrderStore {
  private orders: Order[] = [];
  private filters: OrderFilters = { ...DEFAULT_FILTERS };
  private _snapshot: OrderStoreState | null = null;
  private listeners = new Set<Listener>();

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): OrderStoreState => {
    if (!this._snapshot) {
      const filtered = this.applyFilters();
      this._snapshot = { filters: this.filters, filteredOrders: filtered, totalOrders: this.orders.length };
    }
    return this._snapshot;
  };

  private emit() {
    this._snapshot = null;
    this.listeners.forEach((l) => l());
  }

  private applyFilters(): Order[] {
    const f = this.filters;
    return this.orders.filter((o) => {
      // Text search
      if (f.search) {
        const q = f.search.toLowerCase();
        if (
          !o.id.toLowerCase().includes(q) &&
          !o.customer.toLowerCase().includes(q) &&
          !o.email.toLowerCase().includes(q) &&
          !o.product.toLowerCase().includes(q)
        ) return false;
      }
      if (f.category.length > 0 && !f.category.includes(o.category)) return false;
      if (f.status.length > 0 && !f.status.includes(o.status)) return false;
      if (f.dateFrom && o.orderDate < f.dateFrom) return false;
      if (f.dateTo && o.orderDate > f.dateTo) return false;
      if (f.amountMin && o.amount < Number(f.amountMin)) return false;
      if (f.amountMax && o.amount > Number(f.amountMax)) return false;
      if (f.paymentMethod && o.paymentMethod !== f.paymentMethod) return false;
      if (f.shippingRegion.length > 0 && !f.shippingRegion.includes(o.shippingRegion)) return false;
      if (f.couponUsed === "yes" && !o.couponUsed) return false;
      if (f.couponUsed === "no" && o.couponUsed) return false;
      if (f.rating) {
        if (f.rating === "none" && o.rating !== null) return false;
        if (f.rating !== "none" && o.rating !== Number(f.rating)) return false;
      }
      if (f.platform.length > 0 && !f.platform.includes(o.platform)) return false;
      if (f.fulfillment && o.fulfillment !== f.fulfillment) return false;
      return true;
    });
  }

  getFilters(): OrderFilters {
    return { ...this.filters };
  }

  setFilters(updates: Partial<OrderFilters>): OrderFilters {
    this.filters = { ...this.filters, ...updates };
    this.emit();
    return this.getFilters();
  }

  resetFilters(): OrderFilters {
    this.filters = { ...DEFAULT_FILTERS };
    this.emit();
    return this.getFilters();
  }

  getFilteredOrders(): Order[] {
    return this.applyFilters();
  }

  getAllOrders(): Order[] {
    return this.orders;
  }

  seed(orders: Order[]): void {
    this.orders = orders;
  }
}

export const orderStore = new OrderStore();

// ── Seed with 50 realistic e-commerce orders ─────────────────────────────────

const SEED_CUSTOMERS = [
  { name: "Alice Chen", email: "alice@example.com" },
  { name: "Bob Williams", email: "bob@example.com" },
  { name: "Carol Martinez", email: "carol@example.com" },
  { name: "David Kim", email: "david@example.com" },
  { name: "Emma Johnson", email: "emma@example.com" },
  { name: "Frank Liu", email: "frank@example.com" },
  { name: "Grace Park", email: "grace@example.com" },
  { name: "Henry Brown", email: "henry@example.com" },
  { name: "Ivy Thompson", email: "ivy@example.com" },
  { name: "Jack Wilson", email: "jack@example.com" },
  { name: "Karen Davis", email: "karen@example.com" },
  { name: "Leo Garcia", email: "leo@example.com" },
];

const SEED_PRODUCTS: { name: string; category: Order["category"]; price: number }[] = [
  { name: "Wireless Headphones", category: "Electronics", price: 129.99 },
  { name: "Smart Watch Pro", category: "Electronics", price: 299.99 },
  { name: "USB-C Hub", category: "Electronics", price: 49.99 },
  { name: "Bluetooth Speaker", category: "Electronics", price: 79.99 },
  { name: "Laptop Stand", category: "Electronics", price: 39.99 },
  { name: "Running Shoes", category: "Sports", price: 119.99 },
  { name: "Yoga Mat", category: "Sports", price: 34.99 },
  { name: "Tennis Racket", category: "Sports", price: 89.99 },
  { name: "Winter Jacket", category: "Clothing", price: 189.99 },
  { name: "Cotton T-Shirt Pack", category: "Clothing", price: 29.99 },
  { name: "Denim Jeans", category: "Clothing", price: 69.99 },
  { name: "Silk Scarf", category: "Clothing", price: 45.99 },
  { name: "Coffee Maker", category: "Home & Kitchen", price: 149.99 },
  { name: "Air Fryer", category: "Home & Kitchen", price: 99.99 },
  { name: "Ceramic Knife Set", category: "Home & Kitchen", price: 59.99 },
  { name: "Scented Candle Set", category: "Home & Kitchen", price: 24.99 },
  { name: "JavaScript Patterns", category: "Books", price: 44.99 },
  { name: "System Design Interview", category: "Books", price: 39.99 },
  { name: "The Art of War", category: "Books", price: 12.99 },
  { name: "Face Serum Kit", category: "Beauty", price: 64.99 },
  { name: "Organic Shampoo", category: "Beauty", price: 18.99 },
  { name: "Sunscreen SPF50", category: "Beauty", price: 22.99 },
];

const SEED_STATUSES: Order["status"][] = ["delivered", "delivered", "delivered", "shipped", "shipped", "processing", "processing", "cancelled", "refunded"];
const SEED_PAYMENTS: Order["paymentMethod"][] = ["credit_card", "credit_card", "credit_card", "paypal", "paypal", "bank_transfer", "crypto"];
const SEED_REGIONS: Order["shippingRegion"][] = ["North America", "North America", "Europe", "Europe", "Asia", "Asia", "Oceania", "South America"];
const SEED_PLATFORMS: Order["platform"][] = ["web", "web", "web", "mobile_ios", "mobile_ios", "mobile_android"];
const SEED_FULFILLMENTS: Order["fulfillment"][] = ["standard", "standard", "standard", "express", "express", "same_day"];

function seedOrders(): Order[] {
  const orders: Order[] = [];
  for (let i = 0; i < 50; i++) {
    const cust = SEED_CUSTOMERS[i % SEED_CUSTOMERS.length];
    const prod = SEED_PRODUCTS[i % SEED_PRODUCTS.length];
    const qty = 1 + (i % 5);
    const day = String(1 + (i % 28)).padStart(2, "0");
    const month = i < 25 ? "02" : "03";
    orders.push({
      id: `ORD-${String(i + 1).padStart(3, "0")}`,
      customer: cust.name,
      email: cust.email,
      product: prod.name,
      category: prod.category,
      status: SEED_STATUSES[i % SEED_STATUSES.length],
      orderDate: `2026-${month}-${day}`,
      amount: Math.round(prod.price * qty * 100) / 100,
      paymentMethod: SEED_PAYMENTS[i % SEED_PAYMENTS.length],
      shippingRegion: SEED_REGIONS[i % SEED_REGIONS.length],
      couponUsed: i % 3 === 0,
      rating: i % 7 === 0 ? null : 1 + (i % 5),
      platform: SEED_PLATFORMS[i % SEED_PLATFORMS.length],
      fulfillment: SEED_FULFILLMENTS[i % SEED_FULFILLMENTS.length],
      quantity: qty,
    });
  }
  return orders;
}

orderStore.seed(seedOrders());

// ─── Tab Store ───────────────────────────────────────────────────────────────

export type DemoTab = "form" | "todo" | "flow" | "table";

class TabStore {
  private current: DemoTab = "todo";
  private listeners = new Set<Listener>();

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): DemoTab => {
    return this.current;
  };

  private emit() {
    this.listeners.forEach((l) => l());
  }

  get(): DemoTab {
    return this.current;
  }

  set(tab: DemoTab): void {
    if (tab !== this.current) {
      this.current = tab;
      // Keep URL hash in sync
      window.location.hash = tab;
      this.emit();
    }
  }
}

export const tabStore = new TabStore();
