# Vercel preview control investigation (read-only)

PR #36 remains on `arena/bb6d6c73-tflash-pro`. Its prior push at `ef68b1d`
produced a Vercel preview; there is no evidence that the next push is safe from
an automatic preview. The current repository `vercel.json` has no
`git.deploymentEnabled` setting. A read-only project metadata response showed
no configured ignored-build command, but was truncated; it is not a complete
inventory of Git or environment settings. No settings or files were changed for
this investigation, and no push or deployment was initiated.

[Vercel's Git configuration documentation](https://vercel.com/docs/project-configuration/git-configuration)
describes a branch-specific auto-deployment filter. A *possible* narrowly
scoped repository configuration is:

```json
"git": {
  "deploymentEnabled": {
    "arena/bb6d6c73-tflash-pro": false
  }
}
```

Unspecified branches default to enabled; if multiple matching rules exist and
any is true, Vercel deploys. This is a proposed snippet, **not applied**. The
setting lives in `vercel.json`, so it would be part of the PR and could be
merged into production configuration if not removed. It is not established
whether Vercel will read a new branch-only setting before deciding whether to
start the **first push containing it**. Do not present it as a guaranteed
zero-preview first push, or push to test it without explicit approval.

A second option is an **Ignored Build Step** under Vercel project Settings →
Build and Deployment that matches the exact preview environment and branch and
returns 0 only for that combination, 1 for every other case. Vercel says this
runs after a deployment enters BUILDING and canceled builds still consume a
deployment quota/build slot; it is a shared project setting and a mistake could
change production behavior. It is not a guarantee of zero deployment events or
zero charges. Do not change it without explicit approval and review of current
settings. See [Vercel project settings](https://vercel.com/docs/project-configuration/project-settings).

Other GitHub actions, deploy hooks, or Supabase preview integrations could also
run independently. Their behavior has not been fully established by these
read-only checks. To keep the user's no-deploy instruction, changes remain local
until the user explicitly approves the risk and exact preview-control approach.
