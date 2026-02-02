import type { FunctionDefinition } from "../types";

const BIZ_ID = "73";
const APP_ID = "5836";
const DEPLOY_APP_ID = "1470";
const APP_GROUP = "neone";
const HEADERS = `{
"accept": "application/json",
"accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
  "cache-control": "no-cache",
  "x-mi-clientid": "6639999cb81c0cc1",
  "x-version": "2.21.0"
}`;

export const mockFunctions: FunctionDefinition[] = [
  // READ functions (safe, immediate execution)
  // {
  //   id: "listClusters",
  //   name: "List Clusters",
  //   description: "Get a list of all available clusters",
  //   type: "read",
  //   code: `return { clusters: [
  //     { id: "cluster-1", name: "Production", status: "running" },
  //     { id: "cluster-2", name: "Staging", status: "running" },
  //     { id: "cluster-3", name: "Development", status: "stopped" }
  //   ]}`,
  //   parameters: [],
  // },
  // {
  //   id: "getClusterDetails",
  //   name: "Get Cluster Details",
  //   description: "Get detailed information about a specific cluster",
  //   type: "read",
  //   code: `return { 
  //     id: args.clusterId, 
  //     name: "Cluster " + args.clusterId,
  //     nodes: 3,
  //     cpu: "45%",
  //     memory: "62%",
  //     uptime: "14d 6h"
  //   }`,
  //   parameters: [
  //     { name: "clusterId", type: "string", description: "The cluster ID" },
  //   ],
  // },
  // {
  //   id: "getClusterLogs",
  //   name: "Get Cluster Logs",
  //   description: "Fetch recent logs from a cluster",
  //   type: "read",
  //   code: `return { logs: [
  //     "[INFO] Service started",
  //     "[INFO] Health check passed",
  //     "[WARN] High memory usage detected"
  //   ]}`,
  //   parameters: [{ name: "clusterId", type: "string" }],
  // },

  // // WRITE functions (require user approval)
  // {
  //   id: "restartCluster",
  //   name: "Restart Cluster",
  //   description: "Restart a cluster (causes brief downtime)",
  //   type: "write",
  //   code: `console.log("Restarting cluster:", args.clusterId); return { success: true, message: "Cluster " + args.clusterId + " is restarting..." }`,
  //   parameters: [{ name: "clusterId", type: "string" }],
  // },
  // {
  //   id: "scaleCluster",
  //   name: "Scale Cluster",
  //   description: "Change the number of nodes in a cluster",
  //   type: "write",
  //   code: `console.log("Scaling", args.clusterId, "to", args.nodeCount, "nodes"); return { success: true, message: "Scaled to " + args.nodeCount + " nodes" }`,
  //   parameters: [
  //     { name: "clusterId", type: "string" },
  //     { name: "nodeCount", type: "number", description: "Target number of nodes" },
  //   ],
  // },
  // {
  //   id: "deleteCluster",
  //   name: "Delete Cluster",
  //   description: "Permanently delete a cluster and all its data",
  //   type: "write",
  //   code: `console.log("Deleting cluster:", args.clusterId); return { success: true, deleted: args.clusterId, message: "Cluster deleted successfully" }`,
  //   parameters: [{ name: "clusterId", type: "string" }],
  // },
  // {
  //   id: "deleteClusterLog",
  //   name: "Delete Cluster Log",
  //   description: "Delete specific logs from a cluster",
  //   type: "write",
  //   code: `console.log("Deleting cluster log:", args.clusterId); return { success: true, deleted: args.clusterId, message: "Cluster log deleted successfully" }`,
  //   parameters: [{ name: "clusterId", type: "string" }],
  // },
  {
    id: "listAppClusters",
    name: "List App Clusters",
    description: "Fetch the list of app clusters",
    type: "read",
    code: `return fetch("https://api.agw.mihoyo.com/eee-prod-cn/trinity/v1/deploy/list_app_clusters?biz_id=${BIZ_ID}&app_id=${APP_ID}", {
      headers: ${HEADERS},
      method: "GET",
      credentials: "include",
    }).then(response => response.json())
      .then(res => res?.data?.clusters || []);
`,
    parameters: [],
  },
  {
    id: "getDeployGroups",
    name: "Get Deploy Groups",
    description: "Fetch application deploy groups information from a specific cluster",
    type: "read",
    code: `const url = new URL("https://api.agw.mihoyo.com/eee-prod-cn/trinity/v1/application/deploy/group");
url.searchParams.set("app_id", ${APP_ID});
url.searchParams.set("biz_id", ${BIZ_ID});
url.searchParams.set("scope_type", "app");
url.searchParams.set("app_group", ${APP_GROUP});
url.searchParams.set("dc", "global");
url.searchParams.set("env", args.env);
url.searchParams.set("cluster_id", args.cluster_id);
return fetch(url.toString(), {
  headers: ${HEADERS},
  method: "GET",
  credentials: "include",
}).then(response => response.json()).then(res => res?.data?.groups || []);
`,
    parameters: [
      { name: "env", type: "string", description: "Environment (e.g., testing, prod)" },
      { name: "cluster_id", type: "string", description: "Cluster ID (the id field from cluster list item)" },
    ],
  },
  {
    id: "createCluster",
    name: "Create Cluster",
    description: "Create a new cluster",
    type: "write",
    code: `return fetch("https://api.agw.mihoyo.com/eee-prod-cn/trinity/v1/deploy/cluster", {
  body: JSON.stringify({
    app_id: ${APP_ID},
    biz_id: ${BIZ_ID},
    scope_type: "app",
    environment: {},
    cluster_tag: "",
    chinese_name: "",
    env: args.env,
    deploy_app_id: ${DEPLOY_APP_ID}
  }),
  method: "POST",
  mode: "cors",
  credentials: "include",
  headers: ${HEADERS},
}).then(response => response.json());
`,
    parameters: [
      { name: "env", type: "string", description: "Environment (e.g., testing, prod)" },
    ],
  },
];
