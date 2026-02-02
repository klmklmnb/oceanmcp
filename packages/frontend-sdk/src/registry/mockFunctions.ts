import type { FunctionDefinition } from "../types";

export const mockFunctions: FunctionDefinition[] = [
  // READ functions (safe, immediate execution)
  {
    id: "listClusters",
    name: "List Clusters",
    description: "Get a list of all available clusters",
    type: "read",
    code: `return { clusters: [
      { id: "cluster-1", name: "Production", status: "running" },
      { id: "cluster-2", name: "Staging", status: "running" },
      { id: "cluster-3", name: "Development", status: "stopped" }
    ]}`,
    parameters: [],
  },
  {
    id: "getClusterDetails",
    name: "Get Cluster Details",
    description: "Get detailed information about a specific cluster",
    type: "read",
    code: `return { 
      id: args.clusterId, 
      name: "Cluster " + args.clusterId,
      nodes: 3,
      cpu: "45%",
      memory: "62%",
      uptime: "14d 6h"
    }`,
    parameters: [
      { name: "clusterId", type: "string", description: "The cluster ID" },
    ],
  },
  {
    id: "getClusterLogs",
    name: "Get Cluster Logs",
    description: "Fetch recent logs from a cluster",
    type: "read",
    code: `return { logs: [
      "[INFO] Service started",
      "[INFO] Health check passed",
      "[WARN] High memory usage detected"
    ]}`,
    parameters: [{ name: "clusterId", type: "string" }],
  },

  // WRITE functions (require user approval)
  {
    id: "restartCluster",
    name: "Restart Cluster",
    description: "Restart a cluster (causes brief downtime)",
    type: "write",
    code: `console.log("Restarting cluster:", args.clusterId); return { success: true, message: "Cluster " + args.clusterId + " is restarting..." }`,
    parameters: [{ name: "clusterId", type: "string" }],
  },
  {
    id: "scaleCluster",
    name: "Scale Cluster",
    description: "Change the number of nodes in a cluster",
    type: "write",
    code: `console.log("Scaling", args.clusterId, "to", args.nodeCount, "nodes"); return { success: true, message: "Scaled to " + args.nodeCount + " nodes" }`,
    parameters: [
      { name: "clusterId", type: "string" },
      { name: "nodeCount", type: "number", description: "Target number of nodes" },
    ],
  },
  {
    id: "deleteCluster",
    name: "Delete Cluster",
    description: "Permanently delete a cluster and all its data",
    type: "write",
    code: `console.log("Deleting cluster:", args.clusterId); return { success: true, deleted: args.clusterId, message: "Cluster deleted successfully" }`,
    parameters: [{ name: "clusterId", type: "string" }],
  },
  {
    id: "deleteClusterLog",
    name: "Delete Cluster Log",
    description: "Delete specific logs from a cluster",
    type: "write",
    code: `console.log("Deleting cluster log:", args.clusterId); return { success: true, deleted: args.clusterId, message: "Cluster log deleted successfully" }`,
    parameters: [{ name: "clusterId", type: "string" }],
  },
];
