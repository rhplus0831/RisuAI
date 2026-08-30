# Phase 5: Broad Settings And Shell Ownership

Status: dependency-blocked.

Depends on: all narrower settings/resource owner paths and matching Workstream
1/2 releases.

## Objective

Migrate remaining broad settings, app shell, startup, plugin/runtime observers,
and diagnostic consumers without recreating aggregate observation.

## Required Work

- Replace broad settings reads with explicit groups or dedicated owners.
- Replace facade/any-resource epoch consumers with exact resource sets or a
  documented diagnostic-only subscription.
- Migrate app shell, CSS/theme, routing, plugins/modules, hotkeys, notifications,
  generation readiness, and background observers by explicit dependencies.
- Preserve shell allowlists, route-resource manifests, observer-mode behavior,
  startup readiness, cache, and lazy route hydration.
- Retire the settings bridge last, after every owner-specific setting path and
  side effect has moved.

## Safety Contract

Shell/bootstrap and route payloads may not expand silently. Startup capabilities,
writer promotion/loss, command/outbox behavior, CSS/application side effects,
and authoritative recovery remain explicit.

## Exit Criteria

- Shell/settings/runtime code has no aggregate database read or any-resource
  mutation/observation dependency.
- Settings bridge, broad epoch, and related lifecycle consumers reach zero.
- Startup, route application, plugin readiness, settings mutation, and observer
  smoke pass within recorded budgets.

## Validation

Settings/shell/startup/resource-manifest tests, plugin/runtime owner tests,
affected frontend/server lanes, startup/recovery browser smoke, payload/reactive/
bundle measurements, typechecks, formatting, and diff checks.
