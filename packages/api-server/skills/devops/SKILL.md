---
name: devops
description: Frontend DevOps operations for the Trinity platform. Handles deploy group management, archive deployment, work order lifecycle, cluster operations, and dynamic render HTML updates. Use when the user wants to deploy, release, publish, or manage frontend static resources across testing, pre, and prod environments.
---

# DevOps Skill

Assists with frontend-static deployment operations on the Trinity platform (Mihoyo, LML, and other configured platforms).

## Capabilities

- **Deploy a group** — Full lifecycle from cluster resolution through work order execution and status polling.
- **Create deploy groups** — Provision new frontend-static groups with correct OSS bucket mapping.
- **Create clusters** — Provision new clusters for an environment (rare).
- **Update dynamic render HTML** — Patch version strings in fecdn URLs within a group's configuration.
- **Check deployment status** — Query or poll work order state.

## Quick Reference: Deploy Flow

```
listAppClusters -> resolve cluster_id
       |
getDeployGroups -> resolve group_id
       |
getDeployGroupArchives -> resolve archive_id
       |
deployGroupPreCheck
  |-- passed=true  -> createDeployWorkOrder -> workflow_id
  |-- passed=false -> reuse exist_workflow.id
       |
(prod only) listAllReviewStreams -> review_stream_id
       |
executeDeployWorkOrder(workflow_id)
       |
waitForWorkOrderStatusChange(workflow_id) -> report result
```

## Environment Mapping

| User intent | `env` value | `cluster_tag` |
|-------------|-------------|---------------|
| test, testing | `testing` | `""` |
| uat | `testing` | `"uat"` |
| pp, pre, pre-release | `pre` | `""` |
| prod, production, online | `prod` | `""` |

## Critical Rules

1. **Always call `deployGroupPreCheck`** before creating a work order. Duplicate work orders will fail.
2. **Always call `listAllReviewStreams`** before creating a prod work order to obtain `review_stream_id`.
3. **Never prompt the user for IDs** derivable from API responses (`cluster_id`, `group_id`, `archive_id`, `service_group_id`). Resolve them programmatically.
4. **Never create a deploy group** if one with the same name already exists in the target env.
5. **`cluster_tag`** is only `"uat"` for UAT environments. For all others, leave as empty string — do not ask the user.
6. **Use the correct platform suffix** on all function names (e.g. `listAppClustersMihoyo`, `getDeployGroupsLML`).

## Detailed References

For complete step-by-step instructions, parameters, OSS bucket mappings, and edge cases:

- [Group Deploy Reference](references/group-deploy.md) — Full deploy group lifecycle, including group creation, archive resolution, work order management, and dynamic render HTML updates.
