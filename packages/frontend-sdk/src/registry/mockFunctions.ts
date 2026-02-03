import type { FunctionDefinition } from "../types";

const BIZ_ID = "73";
const APP_ID = "5836";
const DEPLOY_APP_ID = "1470";
const APP_GROUP = "neone";
const APP_NAME = "dx-test";
const HEADERS = `{
"accept": "application/json",
"accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
  "cache-control": "no-cache",
  "x-mi-clientid": "6639999cb81c0cc1",
  "x-version": "2.21.0"
}`;
const CLUSTER_ENV_DESC =
  "Cluster env for dest dir (testing/pre/prod). Map user intent: test/testing/uat -> testing; pp/pre/pre-release -> pre; prod/production -> prod";
const CLUSTER_ID_DESC =
  "Target cluster ID. Determine by listing clusters and matching the env derived from user input.";
const CLUSTER_TAG_DESC =
  "Cluster tag: only set to 'uat' for the uat env; leave empty otherwise.";

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
    description:
      'Fetch the list of app clusters (in testing env with multiple clusters, infer real env via cluster_tag: empty string means test, "uat" means uat)',
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
    description:
      "Fetch application deploy groups information from a specific cluster",
    type: "read",
    code: `const url = new URL("https://api.agw.mihoyo.com/eee-prod-cn/trinity/v1/application/deploy/group");
url.searchParams.set("app_id", ${APP_ID});
url.searchParams.set("biz_id", ${BIZ_ID});
url.searchParams.set("scope_type", "app");
url.searchParams.set("app_group", "${APP_GROUP}");
url.searchParams.set("dc", "global");
url.searchParams.set("env", args.env);
url.searchParams.set("cluster_id", args.cluster_id);
url.searchParams.set("app_name", "${APP_NAME}");
return fetch(url.toString(), {
  headers: ${HEADERS},
  method: "GET",
  credentials: "include",
}).then(response => response.json()).then(res => res?.data?.groups || []);
`,
    parameters: [
      {
        name: "env",
        type: "string",
        description: CLUSTER_ENV_DESC,
        required: true,
      },
      {
        name: "cluster_id",
        type: "string",
        description: CLUSTER_ID_DESC,
        required: true,
      },
    ],
  },
  {
    id: "getDeployGroupArchives",
    name: "Get Deploy Group Archives",
    description:
      "Fetch the archive list for a deploy group in the specified env; first fetch the deploy group list, then find the target group, extract its id, and pass it as service_group_id",
    type: "read",
    code: `const url = new URL("https://api.agw.mihoyo.com/eee-prod-cn/trinity/v1/application/deploy/archive/search_with_rule");
url.searchParams.set("env", args.env);
url.searchParams.set("service_group_id", args.service_group_id);
url.searchParams.set("app_name", "${APP_NAME}");
url.searchParams.set("app_group", "${APP_GROUP}");
url.searchParams.set("dc", "global");
return fetch(url.toString(), {
  body: null,
  method: "GET",
  mode: "cors",
  credentials: "include",
  headers: ${HEADERS},
}).then(response => response.json());
`,
    parameters: [
      {
        name: "env",
        type: "string",
        description: CLUSTER_ENV_DESC,
        required: true,
      },
      {
        name: "service_group_id",
        type: "string",
        description:
          "Deploy group id (never prompt the user; always extract the id from the target item in the deploy group list for the same env).",
        required: true,
      },
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
    cluster_tag: args.cluster_tag || "",
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
      {
        name: "env",
        type: "string",
        description: CLUSTER_ENV_DESC,
        required: true,
      },
      {
        name: "cluster_tag",
        type: "string",
        description: CLUSTER_TAG_DESC,
        required: false,
      },
    ],
  },
  {
    id: "createDeployGroup",
    name: "Create Deploy Group",
    description: `Create a deploy group (check the group list first, if a group with the same name exists in the same env, do not call this function)`,
    type: "write",
    code: `const publicPath = args.public_path;
if (!publicPath || !publicPath.startsWith("/")) {
  throw new Error("public_path must start with '/'");
}

const bucketTag = args.bucket_tag || "intranet";
if (bucketTag !== "intranet" && bucketTag !== "external_network") {
  throw new Error('bucket_tag must be "intranet" or "external_network"');
}

const clusterEnv = args.cluster_env;
const clusterTag = args.cluster_tag || "";

let ossUploadBucket = "";
if (clusterEnv === "testing") {
  if (bucketTag === "intranet") {
    ossUploadBucket = clusterTag === "uat" ? "ee-infra-seed-ydy-uat" : "ee-infra-seed-ydy-test";
  } else {
    ossUploadBucket = clusterTag === "uat" ? "ee-infra-seed-uat" : "ee-infra-seed-test";
  }
} else {
  throw new Error("oss_upload_bucket rules not defined for env: " + clusterEnv);
}

const domain = args.domain;
const ossUploadDestDir = \`\${domain}\${publicPath}-\${clusterEnv}\`;

return fetch("https://api.agw.mihoyo.com/eee-prod-cn/trinity/v1/deploy/group/bulk", {
  body: JSON.stringify({
    app_id: ${APP_ID},
    biz_id: ${BIZ_ID},
    scope_type: "app",
    group_type: "frontend-static",
    service_type: "frontend-static",
    group_name: args.group_name,
    group_chinese_name: "",
    description: "",
    archive_tag: "",
    zest_tag: "",
    environment: {},
    frontend_static_group: {
      bucket_tag: bucketTag,
      oss_upload_bucket: ossUploadBucket,
      domain,
      public_path: publicPath,
      oss_upload_dest_dir: ossUploadDestDir,
      oss_upload_cdn_refresh_method: "disable",
      traffic_redirection_enabled: false,
      redirection_config: [],
      cache_effective_range: 1,
      cache_control: "no-cache",
      expires: "",
      pragma: false,
      response_header_config: [],
      cloud_vendor: 0,
      cdn_refresh_type: 0,
      cdn_preheat_type: 0,
      gray_switch: false,
      gray_type: 0,
      gray_config: {},
    },
    cluster_id: Number(args.cluster_id),
  }),
  method: "POST",
  mode: "cors",
  credentials: "include",
  headers: ${HEADERS},
}).then(response => response.json());
`,
    parameters: [
      {
        name: "domain",
        type: "string",
        description:
          "Domain for frontend static group, should be specified by the user",
        required: true,
      },
      {
        name: "public_path",
        type: "string",
        description:
          "Public path starting with '/', should be specified by the user",
        required: true,
      },
      {
        name: "bucket_tag",
        type: "string",
        description:
          'Bucket tag: "intranet" or "external_network", defaults to "intranet" if not specified',
        required: true,
      },
      {
        name: "cluster_env",
        type: "string",
        description: CLUSTER_ENV_DESC,
        required: true,
      },
      {
        name: "cluster_id",
        type: "string",
        description: CLUSTER_ID_DESC,
        required: true,
      },
      {
        name: "cluster_tag",
        type: "string",
        description: CLUSTER_TAG_DESC,
        required: false,
      },
      {
        name: "group_name",
        type: "string",
        description:
          "Deploy group name. The AI should try: 1) user-specified value, 2) cluster_tag, 3) cluster_env.",
        required: true,
      },
    ],
  },
  {
    id: "createDeployWorkOrder",
    name: "Create Deploy Work Order",
    description:
      "Create a new deploy work order to deploy an archive to a specific deploy group; first fetch the deploy group list to get group_id, then fetch the archive list to get archive_id",
    type: "write",
    code: `const name = "【" + args.env + "】【${APP_NAME}】" + args.deploy_group_name;
const reason = "申请发布【" + args.env + "】";

return fetch("https://api.agw.mihoyo.com/eee-prod-cn/trinity/v1/deploy_workflow/workflow/create", {
  body: JSON.stringify({
    app_id: ${APP_ID},
    biz_id: ${BIZ_ID},
    scope_type: "app",
    name,
    reason,
    is_use_new_deployment_stream: true,
    env: args.env,
    service_type: "frontend-static",
    params: {
      cluster_id: Number(args.cluster_id),
      group_id: Number(args.group_id),
      job_type: 1,
      archive_id: Number(args.archive_id),
    },
    task_type: "frontend_static_deploy",
  }),
  method: "POST",
  mode: "cors",
  credentials: "include",
  headers: ${HEADERS},
}).then(response => response.json());
`,
    parameters: [
      {
        name: "env",
        type: "string",
        description: CLUSTER_ENV_DESC,
        required: true,
      },
      {
        name: "cluster_id",
        type: "string",
        description: CLUSTER_ID_DESC,
        required: true,
      },
      {
        name: "group_id",
        type: "string",
        description:
          "Deploy group id (extract from the target item in the deploy group list for the same env).",
        required: true,
      },
      {
        name: "archive_id",
        type: "string",
        description:
          "Archive id (the id field from the archive list item to deploy).",
        required: true,
      },
      {
        name: "deploy_group_name",
        type: "string",
        description:
          "Deploy group name (used for generating the work order name).",
        required: true,
      },
    ],
  },
];
