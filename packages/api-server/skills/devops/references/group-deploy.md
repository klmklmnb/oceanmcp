# Group Deploy Reference

Complete reference for deploying frontend-static deploy groups via the Trinity API.

## Key Concepts

| Concept | Description |
|---------|-------------|
| **Platform** | A deployment target configuration (e.g. Mihoyo, LML) with its own `biz_id`, `app_id`, `deploy_app_id`, API prefix. |
| **Cluster** | An infrastructure grouping bound to an environment. Each env (testing/pre/prod) has one or more clusters. The `cluster_tag` field distinguishes sub-environments (e.g. `"uat"` within testing). |
| **Deploy Group** | A named frontend-static resource group within a cluster. Holds OSS bucket config, domain, public_path, cache settings, and optional dynamic_render_html. |
| **Archive** | A versioned build artifact (bundle) that can be deployed to a group. |
| **Work Order (Workflow)** | A deploy request entity that goes through pre-check, creation, execution, and completion. |
| **Review Stream** | An approval flow required for production deployments. Must be resolved before creating a prod work order. |

## Environment Mapping

When the user describes a target environment, map their intent as follows:

| User says | `env` value | Notes |
|-----------|-------------|-------|
| test, testing, uat | `testing` | For UAT, also set `cluster_tag = "uat"` |
| pp, pre, pre-release | `pre` | |
| prod, production, online | `prod` | Requires review stream |

## Standard Deploy Flow

Follow these steps **in order**. Each step corresponds to a registered function.

### Step 1 — List App Clusters

**Function:** `listAppClusters{Platform}`

Fetch all available clusters for the app. From the result, identify the cluster matching the user's target environment by checking the `env` field. Within the `testing` env, differentiate test vs. uat clusters using the `cluster_tag` field (empty string = test, `"uat"` = uat).

Extract `cluster_id` for use in subsequent steps.

### Step 2 — Get Deploy Groups

**Function:** `getDeployGroups{Platform}`
**Params:** `env`, `cluster_id`

Fetch all deploy groups in the target cluster. Find the group matching the user's intent (by name or other criteria). Extract:
- `group_id` (the `id` field of the matching group)
- `group_name`

If no matching group exists, see [Creating a New Deploy Group](#creating-a-new-deploy-group) below.

### Step 3 — Get Deploy Group Archives

**Function:** `getDeployGroupArchives{Platform}`
**Params:** `env`, `service_group_id` (= the group's `id`)

Fetch the list of available archives for the deploy group. Present the archive options to the user if they haven't specified a version, or match the archive by version string. Extract `archive_id`.

### Step 4 — Deploy Group Pre-Check

**Function:** `deployGroupPreCheck{Platform}`
**Params:** `group_id`

**MUST** be called before creating a work order. This checks whether the group already has an active deploy work order.

- If `passed` is `true` -> proceed to create a new work order (Step 5).
- If `passed` is `false` and `exist_workflow.id` exists -> an active work order already exists. **Do NOT create a new one.** Use `exist_workflow.id` as the `workflow_id` and skip directly to Step 6 (Execute) or Step 7 (Poll), depending on the existing workflow's status.

### Step 5 — Create Deploy Work Order

> **Production only:** Before this step, call `listAllReviewStreams{Platform}` with `env = "prod"` to obtain the `review_stream_id`. Pass it when creating the work order.

**Function:** `createDeployWorkOrder{Platform}`
**Params:** `env`, `cluster_id`, `group_id`, `archive_id`, `deploy_group_name`, `review_stream_id` (prod only)

Creates the deploy work order. The response contains the `id` field — this is the `workflow_id` used in subsequent steps.

**Only call this when the pre-check in Step 4 returned `passed = true`.**

### Step 6 — Execute Deploy Work Order

**Function:** `executeDeployWorkOrder{Platform}`
**Params:** `workflow_id`

Triggers the actual deployment pipeline. The `workflow_id` comes from either:
- The `id` in the `createDeployWorkOrder` response (Step 5), OR
- The `exist_workflow.id` from the pre-check (Step 4) if reusing an existing work order.

### Step 7 — Wait for Completion

**Function:** `waitForWorkOrderStatusChange{Platform}`
**Params:** `workflow_id`

Polls the work order detail every 3 seconds (up to 100 attempts / ~5 minutes) until the status is no longer `"pending"` or `"running"`. Returns the final work order state.

Report the final status to the user:
- `"success"` -> Deployment completed successfully.
- `"failed"` -> Deployment failed; inspect the response for error details.
- Other statuses -> Report as-is and suggest the user check the platform UI.

## Optional / Conditional Operations

### Creating a New Deploy Group

**Function:** `createDeployGroup{Platform}`

Only create a new group if **no group with the same name exists** in the target env (verified via Step 2). Required parameters from the user:
- `domain` — The domain for the static resources.
- `public_path` — Must start with `/`.
- `bucket_tag` — `"intranet"` (default) or `"external_network"`.
- `group_name` — Naming priority: 1) user-specified, 2) cluster_tag, 3) cluster_env.

The OSS bucket is auto-determined based on `cluster_env`, `cluster_tag`, and `bucket_tag`:

| env | cluster_tag | bucket_tag | oss_upload_bucket |
|-----|-------------|------------|-------------------|
| testing | (empty) | intranet | ee-infra-seed-ydy-test |
| testing | (empty) | external_network | ee-infra-seed-test |
| testing | uat | intranet | ee-infra-seed-ydy-uat |
| testing | uat | external_network | ee-infra-seed-uat |
| pre | — | intranet | ee-infra-seed-ydy-pp |
| pre | — | external_network | ee-infra-seed-pp |
| prod | — | intranet | ee-infra-seed-ydy-prod |
| prod | — | external_network | ee-infra-seed-prod |

The `oss_upload_dest_dir` is computed as `{domain}{public_path}-{cluster_env}`.

### Creating a New Cluster

**Function:** `createCluster{Platform}`
**Params:** `env`, `cluster_tag` (optional)

Only needed if no cluster exists for the target environment. This is rare — most environments already have clusters provisioned.

### Updating Dynamic Render HTML

**Function:** `updateDynamicRenderHtml{Platform}`
**Params:** `current_frontend_static_group`, `cluster_id`, `group_name`, `targetVersion`, `group_id`

Used to update version strings in `//fecdn` URLs within the group's `dynamic_render_html`. Flow:
1. Call `getDeployGroupDetail{Platform}` to get the current `frontend_static_group`.
2. Call `updateDynamicRenderHtml{Platform}` with the current config and the new target version.

The function performs a regex replacement on all `//fecdn.../{version}/` patterns, then PUTs the updated group configuration back. Certain read-only fields (`cdn_preheat_type`, `cdn_refresh_type`, `cloud_vendor`, `redirection_address`, `render_config`, `service_group_id`, `url`) are automatically stripped before submission.

### Checking Work Order Status

**Function:** `getWorkOrderDetail{Platform}`
**Params:** `workflow_id`

Fetches the current detail/status of a work order at a single point in time. Use this for one-off status checks instead of the polling function.

## Critical Rules

1. **Always pre-check before creating a work order.** Never skip `deployGroupPreCheck`. Creating a duplicate work order will fail.
2. **Always resolve review streams for prod.** Call `listAllReviewStreams` before creating any production work order.
3. **Never prompt the user for IDs** that can be derived from API responses (cluster_id, group_id, archive_id, service_group_id). Always resolve them programmatically.
4. **Never create a deploy group if one with the same name already exists** in the target env. Always check the group list first.
5. **cluster_tag is only `"uat"` for uat environments.** For all other environments, leave it as an empty string and do not ask the user about it.
6. **Respect the `{Platform}` suffix.** All function names are suffixed with the platform key (e.g. `listAppClustersMihoyo`, `getDeployGroupsLML`). Always use the correct platform variant matching the user's context.
