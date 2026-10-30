# Tflash-Pro isolated Supabase validation: cost and approval plan

Prepared 2026-10-30. This is a proposal, not authorization to create a
project, change billing, apply hosted migrations, deploy, or use production data.
Prices are public USD list prices, not an account-specific quote; recheck the
Supabase dashboard and taxes before asking for final approval.

## Plans and costs

| Plan | Base subscription | Relevant compute and limits |
| --- | --- | --- |
| Free | $0/month | Nano $0/hour; 500 MB database/project, 1 GB storage and 5 GB uncached + 5 GB cached egress in the included quota. Limits may restrict service instead of incurring overages. Free projects may pause after one week of low activity. |
| Pro | $25/month per organization | Micro $0.01344/hour (about $10/month); $10/month compute credit per organization, shared across its projects. Additional compute can be billed even if idle. |
| Team | $599/month per organization | Paid compute and usage, with larger collaboration/support features; not proposed. |
| Enterprise | Custom quotation | Contract-specific; not proposed. |

For paid plans, Micro is billed for each started hour (including partial
hours); an additional Micro project for 24 billed hours is $0.32256 gross,
about $0.33 before remaining compute credits, tax and other charges. If its
wall-clock interval reaches a 25th billed hour, gross compute is $0.336. A new
Pro subscription also has the $25/month base charge; an already-paid
organization has its existing subscription and may have already consumed its
$10 shared credit. Do not assume the test project is covered by that credit.
Prices for larger compute, branches, replicas, and add-ons differ.

Paid plans include 8 GB general-purpose database disk per project, then
$0.125/GB-month (hourly prorated); 100 GB object storage per organization,
then $0.0213/GB-month; 250 GB uncached and 250 GB cached egress, then $0.09/GB
and $0.03/GB respectively; 2 million Edge Function invocations, then $2 per
million (billed in million-invocation packages); and 100,000 monthly active
users, then $0.00325/user. Branches are paid compute, listed from
$0.01344/hour. Taxes, third-party AI/provider, sandbox, Vercel and other services
may add charges independently. These costs are illustrative, **not approved**.

Supabase's Pro Spend Cap restricts some quota overages, but it is not a
configurable dollar budget and does not cover compute, branch/replica compute,
IPv4, certain disk performance add-ons, PITR or other opted-in items. It cannot
by itself enforce a strict dollar ceiling. Do not use paid compute, branch,
replica, PITR, custom domain, IPv4, log drain or any other paid add-on for this
proposal.

Sources: [pricing](https://supabase.com/pricing),
[compute and billing hours](https://supabase.com/docs/guides/platform/manage-your-usage/compute),
[organization billing and Free project limits](https://supabase.com/docs/guides/platform/billing-on-supabase),
[spend-cap exclusions](https://supabase.com/docs/guides/platform/cost-control),
[egress](https://supabase.com/docs/guides/platform/manage-your-usage/egress),
[disk](https://supabase.com/docs/guides/platform/manage-your-usage/disk-size), and
[Edge Functions](https://supabase.com/docs/guides/platform/manage-your-usage/edge-function-invocations).

## Proposed configuration and $0 limit

- Strict additional budget: **$0 total**, not $0 per hour. One disposable
  `tflash-pro-validation` project on a verified **Free-plan** organization,
  Nano compute, region `eu-west-1`, synthetic users and fixtures only.
- No deployment, paid plan, paid service, external provider, Supabase branch,
  replica, add-on or automatic upgrade. Run test clients locally. A hosted
  database alone does not test deployed Eve, workflow storage or sandbox.
- The connector lists two active projects, Tflash and Babelish, in the `lp`
  organization. It does not show the organization's plan, operator's role,
  available Free-project slots, billing or credit balance. Supabase counts at
  most two active Free projects across organizations where the user is an owner
  or administrator. If both listed projects consume those slots, this proposal
  cannot be created as-is. Do not pause, transfer, delete or otherwise affect
  either existing project. Do not assume another organization bypasses the
  account-wide slot limit. Ask the owner how to proceed instead.
- Before any create call, independently verify the **exact organization ID**,
  Free plan, actual slot availability, Nano configuration, region and current
  provider quote in the billing dashboard, then obtain explicit approval of
  that exact $0 configuration. The connector cannot verify all of these today.
  If the platform requires a paid plan, payment, or any nonzero charge, stop
  and request a new explicit decision; do not substitute a paid project.
- Free-plan quota restrictions and shared organization usage can impact other
  projects. Use a genuinely separate Free organization if available and
  authorized, but shared account-level project limits still apply. Monitor quota
  without load testing; never configure production to point at the test project.
  A $0 Free-plan configuration is not a provider-enforced programmable dollar
  cap for other services; stop if the price or configuration is uncertain.

## Shutdown and test procedure, after separate authorization

1. Before creation, agree a start and stop time (proposed maximum 24 hours),
   an operator responsible for checking the deadline, and explicit authority
   to **pause this test project only** at the deadline. This agent has no
   demonstrated unattended timer or background shutdown guarantee; the owner
   must provide the operational backstop. Do not create if that cannot be met.
2. Record the new test project reference, check it against an explicit allowlist
   before every write, and verify it cannot be confused with either existing
   project. Keep service keys only in local process secrets, never in chat,
   browser code, repository, logs, or production configuration.
3. Hosted migration application is a separate approval decision. If granted,
   verify project reference and migration history, apply migrations only to the
   test project, and test RPC/RLS, conflict, grant/expiry/revocation and real
   PostgreSQL transaction races using synthetic data. Reconcile external effects;
   never automatically replay an uncertain action. Do not create provider
   accounts or test live effects without additional authorization.
4. Stop testing immediately on any unexpected billing prompt, paid setting,
   quota issue, wrong-project identity, or deadline. Manually pause the approved
   Free test project; confirm paused status. Pausing stops compute, not
   necessarily every possible fee on paid plans. Only Free projects can currently
   be paused according to Supabase's [deletion guide](https://supabase.com/docs/guides/platform/delete-project).
   If pausing fails, stop and notify the owner; do not silently transfer plans.
5. Review usage and clean local secrets. Deletion is irreversible and requires
   separate explicit approval; it stops new project usage but cannot erase prior
   billed usage. Never delete or pause production or unrelated projects.
