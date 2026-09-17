# Explicit retained launch inputs

This is the preparation half of actual captured launch, following [durable admission](2026-09-16-captured-admission.md). A non-null recipe is not a running instance and does not lift the retained-helper launch refusal.

Public `prepareCapturedComposition` accepts optional `launch` and `helperLaunches`:

```js
{
  deployment, source,
  launch: {
    runtime: "claude",
    executable: {capability: "example.runtime", command: "native"},
    args: [],
    env: {NATIVE_PROFILE: {fromEnv: "EXPLICIT_PROFILE"}},
    model: "explicit-native-model-id",
    yolo: false
  },
  helperLaunches: {
    "example.provider:worker": {/* independent complete request of the same shape */}
  }
}
```

All six request fields are required when a request is present. Model is literal nonempty text, not an alias resolved against current configuration. There is no runtime/model/yolo defaulting, package discovery, PATH lookup or enrollment during this compilation. Environment values follow the existing launch-config validator; additionally all captured OATS/instance aliases are reserved. Credentials must remain references, not literal values or arguments.

The original executable subset was a command already exported by an exact selected capability. The [native start candidate](2026-09-17-captured-native-start.md) additionally accepts an explicit normalized absolute external host-tool path, without inventing a mandatory runtime capability or pretending to pin every host binary. No new package resolver is introduced, and a host-tool path is explicit host authority, not a retained OATS artifact. A selected capability can export a native runtime entrypoint; executable validity, required dependency roots and runtime-specific loading still need qualification before actual start. This is not a general native-runtime installer or a replacement for runtime package acquisition.

Compilation reuses existing command resources and the existing LaunchRecipe codec. The stored recipe uses `executable:"captured-resource"`, `executableResource` referencing the exact file, and `entrypoint:{capability,command}`. It carries explicit args/env/model/yolo plus pending hook contributions and the TASK.md prompt convention. A future start must resolve the resource from the verified record and match the declared entrypoint, never pass the sentinel to a shell or look for an ambient executable. A resource pointer must match its selected capability and canonical command resource key.

Helpers use only their exact own helper-map request; they never inherit the primary instance's launch selection. An omitted request stays `launch:null`. Unknown helper keys refuse. All primary/helper requests compile before any helper record publication, preventing a partially usable graph when another request is unsupported.

When selected manifest requirements apply to the requested runtime, compilation currently refuses `needs-configuration`: those required runtime package roots must first be retained and loaded by a qualified adapter. It never falls back to globally installed plugins/packages. Unsupported work modes still refuse at materialization/start. Existing helper-authored policy refusals are unchanged.

## Next execution boundary

Actual native start must consume these inputs under the same durable incarnation and admitted intent as other actions. The implementation sequence is:

1. Verify declared entrypoint, exact approval, executable permissions, runtime dependencies and environment references; validate supported native arguments. No provider/backend observation or stop before these checks.
2. Reuse existing native-history, independent session receipt and pending-start primitives. A captured home must bypass legacy `planLaunch`/current config entirely, including starts reached through the older public home API.
3. Admit the entrypoint action before backend effects; bind explicit backend placement and task input to the request. Use the admitted execution ID in pending/start evidence instead of generating an unrelated logical request ID. Retain unknown targets and receipts on failed acknowledgment or metadata writes.
4. Test actual inert native entrypoint execution for fresh primary/helper homes, source/config deletion, retries and preflight-before-stop. Only then expose real captured start/restart/helper launch; no `--no-launch` proxy.
5. Add exact managed runtime roots/loader support. Pi-specific changes require complete installed documentation reads before implementation; legacy ambient Pi extension behavior is not silently reused or changed by this generic request compiler.
