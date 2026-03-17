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
}

export const todoStore = new TodoStore();

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
