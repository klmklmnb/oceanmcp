import {
  FUNCTION_TYPE,
  OPERATION_TYPE,
  PARAMETER_TYPE,
  type CodeFunctionDefinition,
} from "@ocean-mcp/shared";

// ---------------------------------------------------------------------------
// Platform configuration
// ---------------------------------------------------------------------------

interface PlatformConfig {
  /** Suffix used in function IDs and names, e.g. "Mihoyo" | "LML" */
  key: string;
  /** API domain, e.g. "api.agw.mihoyo.com" */
  apiDomain: string;
  /** API path prefix, e.g. "eee-prod-cn" | "lml-prod-cn" */
  apiPrefix: string;
  bizId: string;
  appId: string;
  deployAppId: string;
  appGroup: string;
  appName: string;
}

const PLATFORMS: PlatformConfig[] = [
  {
    key: "Mihoyo",
    apiDomain: "api.agw.mihoyo.com",
    apiPrefix: "eee-prod-cn",
    bizId: "73",
    appId: "5836",
    deployAppId: "1470",
    appGroup: "neone",
    appName: "dx-test",
  },
  {
    key: "LML",
    apiDomain: "api.agw.mihoyo.com",
    apiPrefix: "lml-prod-cn",
    bizId: "103",
    appId: "6024",
    deployAppId: "1658",
    appGroup: "apaas",
    appName: "dx-test",
  },
  // {
  //   key: "Hoyoverse",
  //   apiDomain: "api.agw.hoyoverse.com",
  //   apiPrefix: "eee-prod-os",
  //   bizId: "98",
  //   appId: "5445",
  //   deployAppId: "1079",
  //   appGroup: "apaas",
  //   appName: "dx-test",
  // },
  // {
  //   key: "Anu",
  //   apiDomain: "api.agw.hoyoverse.com",
  //   apiPrefix: "anu-prod-os",
  //   bizId: "103",
  //   appId: "5912",
  //   deployAppId: "1547",
  //   appGroup: "apaas",
  //   appName: "dx-test",
  // },
];

// ---------------------------------------------------------------------------
// Shared constants
// ---------------------------------------------------------------------------

const HEADERS = `{
"accept": "application/json",
"accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
  "cache-control": "no-cache",
  "x-mi-clientid": "6639999cb81c0cc1",
  "x-version": "2.21.0"
}`;
const CLUSTER_ENV_DESC =
  "Cluster env for dest dir (testing/pre/prod). Map user intent: test/testing/uat -> testing; pp/pre/pre-release -> pre; prod/production -> prod";
const CLUSTER_ENV_ENUM_MAP = {
  testing: "测试集群",
  pre: "预发集群",
  prod: "生产集群",
};
const CLUSTER_ID_DESC =
  "Target cluster ID. Determine by listing clusters and matching the env derived from user input.";
const CLUSTER_TAG_DESC =
  "Cluster tag: only set to 'uat' for the uat env; otherwise leave empty and **do not prompt user**.";

/** Helper – builds the base URL for a platform's trinity API. */
const apiBase = (p: PlatformConfig) =>
  `https://${p.apiDomain}/${p.apiPrefix}/trinity/v1`;

// ---------------------------------------------------------------------------
// Factory functions – one per operation
// ---------------------------------------------------------------------------

function makeListAppClusters(p: PlatformConfig): CodeFunctionDefinition {
  return {
    id: `listAppClusters${p.key}`,
    name: `List App Clusters For ${p.key}`,
    description:
      'Fetch the list of app clusters (in testing env with multiple clusters, infer real env via cluster_tag: empty string means test, "uat" means uat)',
    type: FUNCTION_TYPE.CODE,
    operationType: OPERATION_TYPE.READ,
    code: `return fetch("${apiBase(p)}/deploy/list_app_clusters?biz_id=${p.bizId}&app_id=${p.appId}", {
      headers: ${HEADERS},
      method: "GET",
      credentials: "include",
    }).then(response => response.json())
      .then(res => res?.data?.clusters || []);
`,
    parameters: [],
  };
}

function makeGetDeployGroups(p: PlatformConfig): CodeFunctionDefinition {
  return {
    id: `getDeployGroups${p.key}`,
    name: `Get Deploy Groups For ${p.key}`,
    description:
      "Fetch application deploy groups information from a specific cluster",
    type: FUNCTION_TYPE.CODE,
    operationType: OPERATION_TYPE.READ,
    code: `const url = new URL("${apiBase(p)}/application/deploy/group");
url.searchParams.set("app_id", ${p.appId});
url.searchParams.set("biz_id", ${p.bizId});
url.searchParams.set("scope_type", "app");
url.searchParams.set("app_group", "${p.appGroup}");
url.searchParams.set("dc", "global");
url.searchParams.set("env", args.env);
url.searchParams.set("cluster_id", args.cluster_id);
url.searchParams.set("app_name", "${p.appName}");
return fetch(url.toString(), {
  headers: ${HEADERS},
  method: "GET",
  credentials: "include",
}).then(response => response.json()).then(res => res?.data?.groups || []);
`,
    parameters: [
      {
        name: "env",
        type: PARAMETER_TYPE.STRING,
        description: CLUSTER_ENV_DESC,
        required: true,
      },
      {
        name: "cluster_id",
        type: PARAMETER_TYPE.STRING,
        description: CLUSTER_ID_DESC,
        required: true,
      },
    ],
  };
}

function makeGetDeployGroupDetail(p: PlatformConfig): CodeFunctionDefinition {
  return {
    id: `getDeployGroupDetail${p.key}`,
    name: `Get Deploy Group Detail For ${p.key}`,
    description:
      "Fetch the detail of a specific deploy group by group_id. Use this to get full configuration of a deploy group.",
    type: FUNCTION_TYPE.CODE,
    operationType: OPERATION_TYPE.READ,
    code: `const url = new URL("${apiBase(p)}/application/deploy/group");
url.searchParams.set("group_id", args.group_id);
url.searchParams.set("app_id", "${p.appId}");
url.searchParams.set("biz_id", "${p.bizId}");
return fetch(url.toString(), {
  method: "GET",
  mode: "cors",
  credentials: "include",
  headers: ${HEADERS},
}).then(response => response.json()).then(res => res?.data?.groups?.[0] || null);
`,
    parameters: [
      {
        name: "group_id",
        type: PARAMETER_TYPE.STRING,
        description:
          "Deploy group id (extract from the target item in the deploy group list).",
        required: true,
      },
    ],
  };
}

function makeGetDeployGroupArchives(p: PlatformConfig): CodeFunctionDefinition {
  return {
    id: `getDeployGroupArchives${p.key}`,
    name: `Get Deploy Group Archives For ${p.key}`,
    description:
      "Fetch the archive list for a deploy group in the specified env; first fetch the deploy group list, then find the target group, extract its id, and pass it as service_group_id",
    type: FUNCTION_TYPE.CODE,
    operationType: OPERATION_TYPE.READ,
    code: `const url = new URL("${apiBase(p)}/application/deploy/archive/search_with_rule");
url.searchParams.set("env", args.env);
url.searchParams.set("service_group_id", args.service_group_id);
url.searchParams.set("app_name", "${p.appName}");
url.searchParams.set("app_group", "${p.appGroup}");
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
        type: PARAMETER_TYPE.STRING,
        description: CLUSTER_ENV_DESC,
        required: true,
      },
      {
        name: "service_group_id",
        type: PARAMETER_TYPE.STRING,
        description:
          "Deploy group id (never prompt the user; always extract the id from the target item in the deploy group list for the same env).",
        required: true,
      },
    ],
  };
}

function makeListAllReviewStreams(p: PlatformConfig): CodeFunctionDefinition {
  return {
    id: `listAllReviewStreams${p.key}`,
    name: `List All Review Streams For ${p.key}`,
    description:
      "Fetch all review streams for the app. MUST be called before creating a deploy work order in prod env to check review requirements.",
    type: FUNCTION_TYPE.CODE,
    operationType: OPERATION_TYPE.READ,
    code: `const url = new URL("${apiBase(p)}/custom_review/list_all_review_stream");
url.searchParams.set("app_id", "${p.appId}");
url.searchParams.set("biz_id", "${p.bizId}");
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
        type: PARAMETER_TYPE.STRING,
        description:
          "Environment to query review streams for (typically 'prod' for production deployments).",
        required: true,
      },
    ],
  };
}

function makeCreateCluster(p: PlatformConfig): CodeFunctionDefinition {
  return {
    id: `createCluster${p.key}`,
    name: `Create Cluster For ${p.key}`,
    description: "Create a new cluster",
    type: FUNCTION_TYPE.CODE,
    operationType: OPERATION_TYPE.WRITE,
    code: `return fetch("${apiBase(p)}/deploy/cluster", {
  body: JSON.stringify({
    app_id: ${p.appId},
    biz_id: ${p.bizId},
    scope_type: "app",
    environment: {},
    cluster_tag: args.cluster_tag || "",
    chinese_name: "",
    env: args.env,
    deploy_app_id: ${p.deployAppId}
  }),
  method: "POST",
  mode: "cors",
  credentials: "include",
  headers: ${HEADERS},
}).then(response => response.json()).then(res => {
  if (res.retcode !== 0) {
    throw new Error(res.message);
  }
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
        type: PARAMETER_TYPE.STRING,
        description: CLUSTER_ENV_DESC,
        enumMap: CLUSTER_ENV_ENUM_MAP,
        required: true,
      },
      {
        name: "cluster_tag",
        type: PARAMETER_TYPE.STRING,
        description: CLUSTER_TAG_DESC,
        required: false,
      },
    ],
  };
}

function makeCreateDeployGroup(p: PlatformConfig): CodeFunctionDefinition {
  return {
    id: `createDeployGroup${p.key}`,
    name: `Create Deploy Group For ${p.key}`,
    description: `Create a deploy group (check the group list first, if a group with the same name exists in the same env, do not call this function)`,
    type: FUNCTION_TYPE.CODE,
    operationType: OPERATION_TYPE.WRITE,
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

return fetch("${apiBase(p)}/deploy/group/bulk", {
  body: JSON.stringify({
    app_id: ${p.appId},
    biz_id: ${p.bizId},
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
        type: PARAMETER_TYPE.STRING,
        description:
          "Domain for frontend static group, should be specified by the user",
        required: true,
        showName: "域名",
      },
      {
        name: "public_path",
        type: PARAMETER_TYPE.STRING,
        description:
          "Public path starting with '/', should be specified by the user",
        required: true,
        showName: "一级路径",
      },
      {
        name: "bucket_tag",
        type: PARAMETER_TYPE.STRING,
        description:
          'Bucket tag: "intranet" or "external_network", defaults to "intranet" if not specified',
        required: true,
        showName: "网络环境",
        enumMap: {
          intranet: "🏠 内网",
          external_network: "🌐 外网",
        },
      },
      {
        name: "cluster_env",
        type: PARAMETER_TYPE.STRING,
        description: CLUSTER_ENV_DESC,
        required: true,
        showName: "环境",
      },
      {
        name: "cluster_id",
        type: PARAMETER_TYPE.STRING,
        description: CLUSTER_ID_DESC,
        required: true,
        showName: "集群ID",
      },
      {
        name: "cluster_tag",
        type: PARAMETER_TYPE.STRING,
        description: CLUSTER_TAG_DESC,
        required: false,
      },
      {
        name: "group_name",
        type: PARAMETER_TYPE.STRING,
        description:
          "Deploy group name. The AI should try: 1) user-specified value, 2) cluster_tag, 3) cluster_env.",
        required: true,
        showName: "分组名称",
      },
    ],
  };
}

function makeCreateDeployWorkOrder(p: PlatformConfig): CodeFunctionDefinition {
  return {
    id: `createDeployWorkOrder${p.key}`,
    name: `Create Deploy Work Order For ${p.key}`,
    description: `Create a new deploy work order to deploy an archive to a specific deploy group; first fetch the deploy group list to get group_id, then fetch the archive list to get archive_id. For prod env, MUST call listAllReviewStreams${p.key} first to get review_stream_id before creating the work order.`,
    type: FUNCTION_TYPE.CODE,
    operationType: OPERATION_TYPE.WRITE,
    code: `const name = "【" + args.env + "】【${p.appName}】" + args.deploy_group_name;
const reason = "申请发布【" + args.env + "】";

return fetch("${apiBase(p)}/deploy_workflow/workflow/create", {
  body: JSON.stringify({
    app_id: ${p.appId},
    biz_id: ${p.bizId},
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
}).then(response => response.json()).then(res => {
    if (res.retcode !== 0) {
        throw new Error(res.message);
    }
    return res.data;
});
`,
    parameters: [
      {
        name: "env",
        type: PARAMETER_TYPE.STRING,
        description: CLUSTER_ENV_DESC,
        required: true,
      },
      {
        name: "cluster_id",
        type: PARAMETER_TYPE.STRING,
        description: CLUSTER_ID_DESC,
        required: true,
      },
      {
        name: "group_id",
        type: PARAMETER_TYPE.STRING,
        description:
          "Deploy group id (extract from the target item in the deploy group list for the same env).",
        required: true,
      },
      {
        name: "archive_id",
        type: PARAMETER_TYPE.STRING,
        description:
          "Archive id (the id field from the archive list item to deploy).",
        required: true,
      },
      {
        name: "deploy_group_name",
        type: PARAMETER_TYPE.STRING,
        description:
          "Deploy group name (used for generating the work order name).",
        required: true,
      },
      {
        name: "review_stream_id",
        type: PARAMETER_TYPE.STRING,
        description: `Review stream id for prod env deployments. Obtain by calling listAllReviewStreams${p.key} first and extracting the id from the appropriate review stream.`,
        required: false,
      },
    ],
  };
}

function makeUpdateDynamicRenderHtml(
  p: PlatformConfig,
): CodeFunctionDefinition {
  return {
    id: `updateDynamicRenderHtml${p.key}`,
    name: `Update Dynamic Render HTML For ${p.key}`,
    description: `Update the dynamic_render_html of a deploy group by replacing version strings in fecdn URLs. First call getDeployGroupDetail${p.key} to get the current frontend_static_group.`,
    type: FUNCTION_TYPE.CODE,
    operationType: OPERATION_TYPE.WRITE,
    code: `const frontendStaticGroup = typeof args.current_frontend_static_group === 'string'
  ? JSON.parse(args.current_frontend_static_group)
  : args.current_frontend_static_group;

const dynamicRenderHtml = frontendStaticGroup.dynamic_render_html || "";

// Replace version in URLs starting with //fecdn
const updatedHtml = dynamicRenderHtml.replace(
  /(\\/\\/fecdn[^"'\\s]*?)\\/(\\d+\\.\\d+\\.\\d+)\\//g,
  (match, prefix, oldVersion) => prefix + "/" + args.targetVersion + "/"
);

const updatedFrontendStaticGroup = {
  ...frontendStaticGroup,
  dynamic_render_html: updatedHtml,
};

// Remove fields that should not be submitted
delete updatedFrontendStaticGroup.cdn_preheat_type;
delete updatedFrontendStaticGroup.cdn_refresh_type;
delete updatedFrontendStaticGroup.cloud_vendor;
delete updatedFrontendStaticGroup.redirection_address;
delete updatedFrontendStaticGroup.render_config;
delete updatedFrontendStaticGroup.service_group_id;
delete updatedFrontendStaticGroup.url;

return fetch("${apiBase(p)}/deploy/group/" + args.group_id, {
  body: JSON.stringify({
    app_id: ${p.appId},
    biz_id: ${p.bizId},
    archive_tag: "",
    cluster_id: Number(args.cluster_id),
    description: "",
    environment: {},
    frontend_static_group: updatedFrontendStaticGroup,
    group_chinese_name: "",
    group_name: args.group_name,
    group_type: "frontend-static",
    service_type: "frontend-static",
    zest_tag: "",
  }),
  method: "PUT",
  mode: "cors",
  credentials: "include",
  headers: ${HEADERS},
}).then(response => response.json());
`,
    parameters: [
      {
        name: "current_frontend_static_group",
        type: PARAMETER_TYPE.STRING,
        description: `The frontend_static_group field from getDeployGroupDetail${p.key} response (as JSON string or object).`,
        required: true,
      },
      {
        name: "cluster_id",
        type: PARAMETER_TYPE.STRING,
        description: CLUSTER_ID_DESC,
        required: true,
      },
      {
        name: "group_name",
        type: PARAMETER_TYPE.STRING,
        description: "Deploy group name.",
        required: true,
      },
      {
        name: "targetVersion",
        type: PARAMETER_TYPE.STRING,
        description:
          "The new version to replace existing versions with (e.g., '1.48.0').",
        required: true,
      },
      {
        name: "group_id",
        type: PARAMETER_TYPE.STRING,
        description:
          "Deploy group id (extract from the target item in the deploy group list).",
        required: true,
      },
    ],
  };
}

function makeDeployGroupPreCheck(p: PlatformConfig): CodeFunctionDefinition {
  return {
    id: `deployGroupPreCheck${p.key}`,
    name: `Deploy Group Pre Check For ${p.key}`,
    description: `Check whether a deploy group already has an existing deploy work order. MUST be called before createDeployWorkOrder${p.key}. If response field "passed" is false and "exist_workflow.id" exists, a work order already exists — do NOT create a new one, instead use exist_workflow.id directly for subsequent flows (e.g. executeDeployWorkOrder${p.key}). Only create a new work order when "passed" is true.`,
    type: FUNCTION_TYPE.CODE,
    operationType: OPERATION_TYPE.READ,
    code: `const url = new URL("${apiBase(p)}/deploy_workflow/workflow/deploy_group_pre_check");
url.searchParams.set("app_id", "${p.appId}");
url.searchParams.set("biz_id", "${p.bizId}");
url.searchParams.set("scope_type", "app");
url.searchParams.set("group_id", args.group_id);
return fetch(url.toString(), {
  body: null,
  method: "GET",
  mode: "cors",
  credentials: "include",
  headers: ${HEADERS},
}).then(response => response.json()).then(res => {
    if (res.retcode !== 0) {
        throw new Error(res.message);
    }
    return res.data;
});
`,
    parameters: [
      {
        name: "group_id",
        type: PARAMETER_TYPE.STRING,
        description:
          "Deploy group id (extract from the target item in the deploy group list).",
        required: true,
      },
    ],
  };
}

function makeExecuteDeployWorkOrder(p: PlatformConfig): CodeFunctionDefinition {
  return {
    id: `executeDeployWorkOrder${p.key}`,
    name: `Execute Deploy Workflow For ${p.key}`,
    description: `Execute a deploy workflow (start the actual deployment). Call this after createDeployWorkOrder${p.key} succeeds, using the id field from its response as workflow_id.`,
    type: FUNCTION_TYPE.CODE,
    operationType: OPERATION_TYPE.WRITE,
    code: `return fetch("${apiBase(p)}/deploy_workflow/workflow/control", {
  body: JSON.stringify({
    workflow_id: Number(args.workflow_id),
    process: "deploy_pipeline",
    action: "execute",
  }),
  method: "POST",
  mode: "cors",
  credentials: "include",
  headers: ${HEADERS},
}).then(response => response.json()).then(res => {
  if (res.retcode !== 0) {
    throw new Error(res.message);
  }
  return res.data;
});
`,
    parameters: [
      {
        name: "workflow_id",
        type: PARAMETER_TYPE.STRING,
        description:
          "Workflow id (the id field from the createDeployWorkOrder response).",
        required: true,
      },
    ],
  };
}

function makeGetWorkOrderDetail(p: PlatformConfig): CodeFunctionDefinition {
  return {
    id: `getWorkOrderDetail${p.key}`,
    name: `Get Work Order Detail For ${p.key}`,
    description: `Fetch the current detail/status of a deploy work order by workflow_id.`,
    type: FUNCTION_TYPE.CODE,
    operationType: OPERATION_TYPE.READ,
    code: `const url = new URL("${apiBase(p)}/deploy_workflow/workflow/detail/" + args.workflow_id);
url.searchParams.set("app_id", "${p.appId}");
url.searchParams.set("biz_id", "${p.bizId}");
return fetch(url.toString(), {
  body: null,
  method: "GET",
  mode: "cors",
  credentials: "include",
  headers: ${HEADERS},
}).then(response => response.json()).then(res => {
  if (res.retcode !== 0) {
    throw new Error(res.message);
  }
  return res.data;
});
`,
    parameters: [
      {
        name: "workflow_id",
        type: PARAMETER_TYPE.STRING,
        description:
          "Workflow id (the id field from createDeployWorkOrder response or exist_workflow.id from deployGroupPreCheck).",
        required: true,
      },
    ],
  };
}

function makeWaitForWorkOrderStatusChange(
  p: PlatformConfig,
): CodeFunctionDefinition {
  return {
    id: `waitForWorkOrderStatusChange${p.key}`,
    name: `Wait For Work Order Status Change For ${p.key}`,
    description: `Poll the work order detail until its status is no longer "pending" or "running", then return the final result. Use this after executeDeployWorkOrder${p.key} to wait for the deployment to finish.`,
    type: FUNCTION_TYPE.CODE,
    operationType: OPERATION_TYPE.READ,
    code: `const pollInterval = 3000;
const maxAttempts = 100;

async function poll() {
  for (let i = 0; i < maxAttempts; i++) {
    const url = new URL("${apiBase(p)}/deploy_workflow/workflow/detail/" + args.workflow_id);
    url.searchParams.set("app_id", "${p.appId}");
    url.searchParams.set("biz_id", "${p.bizId}");
    const res = await fetch(url.toString(), {
      body: null,
      method: "GET",
      mode: "cors",
      credentials: "include",
      headers: ${HEADERS},
    }).then(r => r.json());

    if (res.retcode !== 0) {
      throw new Error(res.message);
    }

    const status = res.data?.status;
    if (status !== "pending" && status !== "running") {
      return res.data;
    }

    await new Promise(resolve => setTimeout(resolve, pollInterval));
  }
  throw new Error("Timed out waiting for work order status change after " + maxAttempts + " attempts");
}

return poll();
`,
    parameters: [
      {
        name: "workflow_id",
        type: PARAMETER_TYPE.STRING,
        description:
          "Workflow id to poll (the id field from createDeployWorkOrder response or exist_workflow.id from deployGroupPreCheck).",
        required: true,
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Generate all hoyocloud functions from platform configs
// ---------------------------------------------------------------------------

const hoyocloudFunctions: CodeFunctionDefinition[] = PLATFORMS.flatMap((p) => [
  makeListAppClusters(p),
  makeGetDeployGroups(p),
  makeGetDeployGroupDetail(p),
  makeGetDeployGroupArchives(p),
  makeListAllReviewStreams(p),
  makeDeployGroupPreCheck(p),
  makeCreateCluster(p),
  makeCreateDeployGroup(p),
  makeCreateDeployWorkOrder(p),
  makeExecuteDeployWorkOrder(p),
  makeGetWorkOrderDetail(p),
  makeWaitForWorkOrderStatusChange(p),
  makeUpdateDynamicRenderHtml(p),
]);

// ---------------------------------------------------------------------------
// Exported mock functions
// ---------------------------------------------------------------------------

/**
 * Pre-registered mock functions for testing.
 * These are bundled with the SDK and available immediately.
 */
export const mockFunctions: CodeFunctionDefinition[] = [
  ...hoyocloudFunctions,
  {
    id: "getCurrentPageInfo",
    name: "Get Current Page Info",
    description:
      "Returns information about the current page (URL, title, meta)",
    type: FUNCTION_TYPE.CODE,
    operationType: OPERATION_TYPE.READ,
    code: `return {
      url: window.location.href,
      title: document.title,
      pathname: window.location.pathname,
      search: window.location.search,
      referrer: document.referrer,
      userAgent: navigator.userAgent,
    }`,
    parameters: [],
  },
  {
    id: "getPageContent",
    name: "Get Page Content",
    description:
      "Returns the text content of the page or a specific CSS selector",
    type: FUNCTION_TYPE.CODE,
    operationType: OPERATION_TYPE.READ,
    code: `const selector = args.selector || 'body';
    const el = document.querySelector(selector);
    if (!el) return { error: 'Element not found: ' + selector };
    return {
      text: el.textContent?.trim().substring(0, 5000),
      html: el.innerHTML.substring(0, 5000),
      tagName: el.tagName,
    }`,
    parameters: [
      {
        name: "selector",
        type: PARAMETER_TYPE.STRING,
        description: "CSS selector to query (defaults to 'body')",
        required: false,
      },
    ],
  },
  {
    id: "clickElement",
    name: "Click Element",
    description: "Clicks an element matching the given CSS selector",
    type: FUNCTION_TYPE.CODE,
    operationType: OPERATION_TYPE.WRITE,
    code: `const el = document.querySelector(args.selector);
    if (!el) return { error: 'Element not found: ' + args.selector };
    el.click();
    return { success: true, selector: args.selector }`,
    parameters: [
      {
        name: "selector",
        type: PARAMETER_TYPE.STRING,
        description: "CSS selector of the element to click",
        required: true,
      },
    ],
  },
  {
    id: "fillInput",
    name: "Fill Input",
    description: "Sets the value of an input element",
    type: FUNCTION_TYPE.CODE,
    operationType: OPERATION_TYPE.WRITE,
    code: `const el = document.querySelector(args.selector);
    if (!el) return { error: 'Element not found: ' + args.selector };
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
    if (nativeInputValueSetter) {
      nativeInputValueSetter.call(el, args.value);
    } else {
      el.value = args.value;
    }
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return { success: true, selector: args.selector, value: args.value }`,
    parameters: [
      {
        name: "selector",
        type: PARAMETER_TYPE.STRING,
        description: "CSS selector of the input",
        required: true,
      },
      {
        name: "value",
        type: PARAMETER_TYPE.STRING,
        description: "Value to set",
        required: true,
      },
    ],
  },
];
