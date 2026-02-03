import type { FunctionDefinition } from "../types";

// Mihoyo constants
const MIHOYO_BIZ_ID = "73";
const MIHOYO_APP_ID = "5836";
const MIHOYO_DEPLOY_APP_ID = "1470";
const MIHOYO_APP_GROUP = "neone";
const MIHOYO_APP_NAME = "dx-test";

// LML constants
const LML_BIZ_ID = "103";
const LML_APP_ID = "6024";
const LML_DEPLOY_APP_ID = "1658";
const LML_APP_GROUP = "apaas";
const LML_APP_NAME = "dx-test";

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
  // =====================
  // Mihoyo Functions
  // =====================
  {
    id: "listAppClustersMihoyo",
    name: "List App Clusters For Mihoyo",
    description:
      'Fetch the list of app clusters (in testing env with multiple clusters, infer real env via cluster_tag: empty string means test, "uat" means uat)',
    type: "read",
    code: `return fetch("https://api.agw.mihoyo.com/eee-prod-cn/trinity/v1/deploy/list_app_clusters?biz_id=${MIHOYO_BIZ_ID}&app_id=${MIHOYO_APP_ID}", {
      headers: ${HEADERS},
      method: "GET",
      credentials: "include",
    }).then(response => response.json())
      .then(res => res?.data?.clusters || []);
`,
    parameters: [],
  },
  {
    id: "getDeployGroupsMihoyo",
    name: "Get Deploy Groups For Mihoyo",
    description:
      "Fetch application deploy groups information from a specific cluster",
    type: "read",
    code: `const url = new URL("https://api.agw.mihoyo.com/eee-prod-cn/trinity/v1/application/deploy/group");
url.searchParams.set("app_id", ${MIHOYO_APP_ID});
url.searchParams.set("biz_id", ${MIHOYO_BIZ_ID});
url.searchParams.set("scope_type", "app");
url.searchParams.set("app_group", "${MIHOYO_APP_GROUP}");
url.searchParams.set("dc", "global");
url.searchParams.set("env", args.env);
url.searchParams.set("cluster_id", args.cluster_id);
url.searchParams.set("app_name", "${MIHOYO_APP_NAME}");
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
    id: "getDeployGroupDetailMihoyo",
    name: "Get Deploy Group Detail For Mihoyo",
    description:
      "Fetch the detail of a specific deploy group by group_id. Use this to get full configuration of a deploy group.",
    type: "read",
    code: `const url = new URL("https://api.agw.mihoyo.com/eee-prod-cn/trinity/v1/application/deploy/group");
url.searchParams.set("group_id", args.group_id);
url.searchParams.set("app_id", "${MIHOYO_APP_ID}");
url.searchParams.set("biz_id", "${MIHOYO_BIZ_ID}");
return fetch(url.toString(), {
  method: "GET",
  mode: "cors",
  credentials: "include",
  headers: ${HEADERS},
}).then(response => response.json()).then(res => res?.data || null);
`,
    parameters: [
      {
        name: "group_id",
        type: "string",
        description:
          "Deploy group id (extract from the target item in the deploy group list).",
        required: true,
      },
    ],
  },
  {
    id: "getDeployGroupArchivesMihoyo",
    name: "Get Deploy Group Archives For Mihoyo",
    description:
      "Fetch the archive list for a deploy group in the specified env; first fetch the deploy group list, then find the target group, extract its id, and pass it as service_group_id",
    type: "read",
    code: `const url = new URL("https://api.agw.mihoyo.com/eee-prod-cn/trinity/v1/application/deploy/archive/search_with_rule");
url.searchParams.set("env", args.env);
url.searchParams.set("service_group_id", args.service_group_id);
url.searchParams.set("app_name", "${MIHOYO_APP_NAME}");
url.searchParams.set("app_group", "${MIHOYO_APP_GROUP}");
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
    id: "listAllReviewStreamsMihoyo",
    name: "List All Review Streams For Mihoyo",
    description:
      "Fetch all review streams for the app. MUST be called before creating a deploy work order in prod env to check review requirements.",
    type: "read",
    code: `const url = new URL("https://api.agw.mihoyo.com/eee-prod-cn/trinity/v1/custom_review/list_all_review_stream");
url.searchParams.set("app_id", "${MIHOYO_APP_ID}");
url.searchParams.set("biz_id", "${MIHOYO_BIZ_ID}");
url.searchParams.set("scope_type", "app");
url.searchParams.set("review_stream_type", "3");
url.searchParams.set("env", args.env);
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
        description:
          "Environment to query review streams for (typically 'prod' for production deployments).",
        required: true,
      },
    ],
  },
  {
    id: "createClusterMihoyo",
    name: "Create Cluster For Mihoyo",
    description: "Create a new cluster",
    type: "write",
    code: `return fetch("https://api.agw.mihoyo.com/eee-prod-cn/trinity/v1/deploy/cluster", {
  body: JSON.stringify({
    app_id: ${MIHOYO_APP_ID},
    biz_id: ${MIHOYO_BIZ_ID},
    scope_type: "app",
    environment: {},
    cluster_tag: args.cluster_tag || "",
    chinese_name: "",
    env: args.env,
    deploy_app_id: ${MIHOYO_DEPLOY_APP_ID}
  }),
  method: "POST",
  mode: "cors",
  credentials: "include",
  headers: ${HEADERS},
}).then(response => response.json()).then(res => {
  const r = res?.data || { id: '' };
  if (r.cluster_id) {
    r.id = r.cluster_id;
  }
  return r;
});
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
    id: "createDeployGroupMihoyo",
    name: "Create Deploy Group For Mihoyo",
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
} else if (clusterEnv === "prod") {
  if (bucketTag === "intranet") {
    ossUploadBucket = "ee-infra-seed-ydy-prod";
  } else {
    ossUploadBucket = "ee-infra-seed-prod";
  }
} else if (clusterEnv === "pre") {
  if (bucketTag === "intranet") {
    ossUploadBucket = "ee-infra-seed-ydy-pp";
  } else {
    ossUploadBucket = "ee-infra-seed-pp";
  }
} else {
  throw new Error("oss_upload_bucket rules not defined for env: " + clusterEnv);
}

const domain = args.domain;
const ossUploadDestDir = \`\${domain}\${publicPath}-\${clusterEnv}\`;

return fetch("https://api.agw.mihoyo.com/eee-prod-cn/trinity/v1/deploy/group/bulk", {
  body: JSON.stringify({
    app_id: ${MIHOYO_APP_ID},
    biz_id: ${MIHOYO_BIZ_ID},
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
    id: "createDeployWorkOrderMihoyo",
    name: "Create Deploy Work Order For Mihoyo",
    description:
      "Create a new deploy work order to deploy an archive to a specific deploy group; first fetch the deploy group list to get group_id, then fetch the archive list to get archive_id. For prod env, MUST call listAllReviewStreamsMihoyo first to get review_stream_id before creating the work order.",
    type: "write",
    code: `const name = "【" + args.env + "】【${MIHOYO_APP_NAME}】" + args.deploy_group_name;
const reason = "申请发布【" + args.env + "】";

return fetch("https://api.agw.mihoyo.com/eee-prod-cn/trinity/v1/deploy_workflow/workflow/create", {
  body: JSON.stringify({
    app_id: ${MIHOYO_APP_ID},
    biz_id: ${MIHOYO_BIZ_ID},
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
    review_stream_id: args.review_stream_id ? Number(args.review_stream_id) : undefined,
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
      {
        name: "review_stream_id",
        type: "string",
        description:
          "Review stream id for prod env deployments. Obtain by calling listAllReviewStreamsMihoyo first and extracting the id from the appropriate review stream.",
        required: false,
      },
    ],
  },

  // =====================
  // LML Functions
  // =====================
  {
    id: "listAppClustersLML",
    name: "List App Clusters For LML",
    description:
      'Fetch the list of app clusters (in testing env with multiple clusters, infer real env via cluster_tag: empty string means test, "uat" means uat)',
    type: "read",
    code: `return fetch("https://api.agw.mihoyo.com/lml-prod-cn/trinity/v1/deploy/list_app_clusters?biz_id=${LML_BIZ_ID}&app_id=${LML_APP_ID}", {
      headers: ${HEADERS},
      method: "GET",
      credentials: "include",
    }).then(response => response.json())
      .then(res => res?.data?.clusters || []);
`,
    parameters: [],
  },
  {
    id: "getDeployGroupsLML",
    name: "Get Deploy Groups For LML",
    description:
      "Fetch application deploy groups information from a specific cluster",
    type: "read",
    code: `const url = new URL("https://api.agw.mihoyo.com/lml-prod-cn/trinity/v1/application/deploy/group");
url.searchParams.set("app_id", ${LML_APP_ID});
url.searchParams.set("biz_id", ${LML_BIZ_ID});
url.searchParams.set("scope_type", "app");
url.searchParams.set("app_group", "${LML_APP_GROUP}");
url.searchParams.set("dc", "global");
url.searchParams.set("env", args.env);
url.searchParams.set("cluster_id", args.cluster_id);
url.searchParams.set("app_name", "${LML_APP_NAME}");
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
    id: "getDeployGroupArchivesLML",
    name: "Get Deploy Group Archives For LML",
    description:
      "Fetch the archive list for a deploy group in the specified env; first fetch the deploy group list, then find the target group, extract its id, and pass it as service_group_id",
    type: "read",
    code: `const url = new URL("https://api.agw.mihoyo.com/lml-prod-cn/trinity/v1/application/deploy/archive/search_with_rule");
url.searchParams.set("env", args.env);
url.searchParams.set("service_group_id", args.service_group_id);
url.searchParams.set("app_name", "${LML_APP_NAME}");
url.searchParams.set("app_group", "${LML_APP_GROUP}");
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
    id: "createClusterLML",
    name: "Create Cluster For LML",
    description: "Create a new cluster",
    type: "write",
    code: `return fetch("https://api.agw.mihoyo.com/lml-prod-cn/trinity/v1/deploy/cluster", {
  body: JSON.stringify({
    app_id: ${LML_APP_ID},
    biz_id: ${LML_BIZ_ID},
    scope_type: "app",
    environment: {},
    cluster_tag: args.cluster_tag || "",
    chinese_name: "",
    env: args.env,
    deploy_app_id: ${LML_DEPLOY_APP_ID}
  }),
  method: "POST",
  mode: "cors",
  credentials: "include",
  headers: ${HEADERS},
}).then(response => response.json()).then(res => {
  const r = res?.data || { id: '' };
  if (r.cluster_id) {
    r.id = r.cluster_id;
  }
  return r;
});
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
    id: "createDeployGroupLML",
    name: "Create Deploy Group For LML",
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

return fetch("https://api.agw.mihoyo.com/lml-prod-cn/trinity/v1/deploy/group/bulk", {
  body: JSON.stringify({
    app_id: ${LML_APP_ID},
    biz_id: ${LML_BIZ_ID},
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
    id: "createDeployWorkOrderLML",
    name: "Create Deploy Work Order For LML",
    description:
      "Create a new deploy work order to deploy an archive to a specific deploy group; first fetch the deploy group list to get group_id, then fetch the archive list to get archive_id",
    type: "write",
    code: `const name = "【" + args.env + "】【${LML_APP_NAME}】" + args.deploy_group_name;
const reason = "申请发布【" + args.env + "】";

return fetch("https://api.agw.mihoyo.com/lml-prod-cn/trinity/v1/deploy_workflow/workflow/create", {
  body: JSON.stringify({
    app_id: ${LML_APP_ID},
    biz_id: ${LML_BIZ_ID},
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
