---
title: "DNS as Code: Managing Cloudflare Records with DNSControl"
description: "Manual DNS edits in dashboards leave no audit trail and no review process. DNSControl turns your Cloudflare zone into a Git-backed, PR-reviewed, CI-deployed system - here is a working POC you can fork."
date: 2026-05-17
tags: [dns, cloudflare, infrastructure, devops, automation, github-actions]
draft: false
---

Every DNS change I have made through a dashboard felt wrong. Click the right zone, add the right record, hope you did not fat-finger the value. No diff. No review. No way to know what the zone looked like six months ago without digging through provider audit logs that may or may not exist.

DNS controls traffic. It determines where your mail goes, which servers handle your HTTPS, which CAs are allowed to issue certificates for your domain. It deserves the same discipline as application code: version control, peer review, automated deployment.

[DNSControl](https://dnscontrol.org) is how you get there. It is an open-source tool from Stack Exchange that treats your DNS zone as code. You define records in a config file, run a preview to see what would change, and push to apply. It supports Cloudflare, Route53, and about 30 other providers.

This post walks through my working POC at [amaanx86/cloudflare-dnscontrol](https://github.com/amaanx86/cloudflare-dnscontrol), built on `runonaws.dev` on Cloudflare DNS. Everything here is forkable.

## The model

The repo has a simple structure:

```
dnsconfig.js           # Main DNSControl config
domains/               # One JSON file per subdomain
  @.json               # Apex / root records
  amaan.json           # amaan.runonaws.dev
  stg.json             # stg.runonaws.dev
  ...
utils/
  reserved.json        # Subdomain names that are protected
  internal.json        # Subdomains fully ignored by DNSControl
.github/workflows/
  preview-records.yml  # PR: dnscontrol preview → PR comment
  publish-records.yml  # Push to main: dnscontrol push → live
```

`dnsconfig.js` is the single source of truth for the zone. `domains/` is where contributors make changes. `utils/` holds policy that applies zone-wide. Adding a subdomain means dropping a JSON file in `domains/` and opening a PR. Nothing else.

## Declaring a subdomain

Each subdomain is a JSON file in `domains/`. The filename is the subdomain label, so `amaan.json` becomes `amaan.runonaws.dev`:

```json
{
    "owner": {
        "username": "amaanx86",
        "email": "[email protected]"
    },
    "records": {
        "CNAME": "amaanx86.github.io",
        "TXT": "google-site-verification=aXFvR-FIaRAyOQDhDkfHac3qIX56pg9TwSaJpnq-S3A"
    },
    "proxied": true
}
```

The `owner` field is not interpreted by DNSControl. It is accountability metadata that answers the question every ops team eventually asks: whose record is this and who do you contact when it breaks? In a shared zone it is the difference between a record you can quietly delete and one that needs a conversation first.

`proxied: true` enables Cloudflare's orange-cloud proxy. `false` is DNS-only. Every subdomain declares this explicitly so there is no zone-wide default to accidentally inherit. NS delegations, mail servers, and internal services should not be proxied, and an explicit field per record makes that impossible to get wrong silently.

The `records` object supports A, AAAA, CAA, CNAME, DS, MX, NS, SRV, TLSA, and TXT. Multiple values per type where the record type allows it.

## What to ignore

DNSControl's default behavior is to reconcile your zone to exactly match the code. That is dangerous at the apex. Root-domain records like NS and DNSKEY are auto-managed by Cloudflare. If DNSControl deletes them because they are not in your code, you lose DNS for the entire domain.

The `IGNORE` directive tells DNSControl to leave certain records alone:

```javascript
IGNORE("@", "NS"),
IGNORE("@", "DNSKEY"),
IGNORE("@", "MX"),
IGNORE("@", "TXT"),
IGNORE("*._domainkey", "TXT"),
IGNORE("_acme-challenge", "TXT"),
IGNORE("_dmarc", "TXT"),
```

In this setup, CAA records are the only root-domain records managed as code. CAA controls which certificate authorities can issue certs for your domain, so having it in version control with a review process is worth the overhead. Everything else at the apex is either auto-managed by Cloudflare or changes rarely enough that the dashboard is fine.

The `_acme-challenge` and `*._domainkey` ignores keep ACME certificate issuance and DKIM from getting blown away by a push. `utils/internal.json` holds subdomains that DNSControl should not touch at all, useful for anything managed by a separate system.

## Reserving subdomains

If anyone can add a subdomain via PR, nothing stops someone from claiming `admin`, `api`, `billing`, or `auth` before the platform team does.

Reserved subdomains solve this by pre-populating those names with placeholder A records pointing to `203.0.113.0`. That address is from TEST-NET-3 ([RFC 5737](https://www.rfc-editor.org/rfc/rfc5737.html)), a documentation-reserved block that will never route anywhere real. The subdomain exists in DNS, Cloudflare proxies it, requests to it return a Cloudflare error. Claiming it requires removing the placeholder, which requires a PR, which requires approval.

`utils/reserved.json` covers about 80 names: `admin`, `api`, `app`, `auth`, `billing`, `blog`, `cdn`, `mail`, and the rest of the usual candidates.

## The zone timestamp

Every push writes a TXT record at `_zone-updated` with the current Unix timestamp. You can check it any time:

```bash
dig TXT _zone-updated.runonaws.dev +short
```

Two uses: confirming a push actually landed, and spotting records that look stale. If the timestamp predates your last push, something went wrong in the pipeline.

## The CI/CD pipeline

Two GitHub Actions workflows handle the deployment lifecycle.

On pull request, the preview workflow runs `dnscontrol preview` against Cloudflare and posts the output as a PR comment. Reviewers see exactly which records will be added, modified, or deleted before anything merges. The comment updates on force-push so it always reflects the current branch state. No dashboard access needed to understand what a change does.

On push to main, the publish workflow runs `dnscontrol push` and the changes go live.

Both workflows only fire on changes to `domains/*`, `dnsconfig.js`, `utils/reserved.json`, or the workflow files themselves. Unrelated repo commits do not trigger a DNS push.

The Cloudflare API token needs Zone.DNS write permission scoped to the specific zone, not the whole account.

## What the workflow looks like in practice

Someone needs to add `staging.runonaws.dev` pointing to an ALB. They:

1. Create a branch: `dns/add-staging`
2. Add `domains/staging.json`:

```json
{
    "owner": {
        "username": "amaanx86",
        "email": "[email protected]"
    },
    "records": {
        "CNAME": "my-alb-1234567890.us-east-1.elb.amazonaws.com"
    },
    "proxied": false
}
```

3. Open a PR
4. Preview workflow posts the diff as a comment: one CNAME being added
5. Reviewer confirms the target and approves
6. Merge to main, Cloudflare updates within seconds

The contributor never opened the Cloudflare dashboard. The reviewer saw the exact change before it applied. The commit history shows who added the record, when, and why.

## The sync catches what the dashboard quietly added

Here is where the reconciliation model earns its keep. This is the actual preview comment the GitHub Actions bot posted on [PR #10](https://github.com/amaanx86/cloudflare-dnscontrol/pull/10):


```
******************** Domain: runonaws.dev
4 corrections (cloudflare)

± MODIFY _zone-updated.runonaws.dev TXT ("1758268077330" ttl=300) -> ("1779036943050" ttl=300)
- DELETE argo.runonaws.dev A 192.168.1.57 proxy=false ttl=1
- DELETE test.runonaws.dev CNAME e73da4f6-a287-41eb-bfe9-563f73037d68.cfargotunnel.com. proxy=true ttl=1
+ CREATE test.runonaws.dev A 203.0.113.0 proxy=true ttl=1
```

`argo.runonaws.dev` and `test.runonaws.dev` were added directly in the Cloudflare dashboard, outside of the repo. DNSControl has no knowledge of them. From its perspective, those records do not belong in the zone and will be deleted on the next push. The preview comment is the warning before that happens.

`test.runonaws.dev` shows up as both a DELETE and a CREATE. The CNAME pointing to a Cloudflare Tunnel was manually added; the replacement A record pointing to `203.0.113.0` comes from `reserved.json`. So the sync removes the manual record and installs the reserved placeholder in its place.

This is exactly the behavior you want, but it means any record added through the dashboard will eventually get wiped. Before merging a PR, check the preview output for unexpected DELETEs. If a record that should stay is listed for deletion, port it into a `domains/` JSON file first. Once it is in the repo, it is safe.

The alternative is to merge and let the sync clean up the manual additions. Either way, the zone ends up matching the code.

## Provider portability

DNSControl abstracts the provider. Switching from Cloudflare to Route53 is a one-line change in `dnsconfig.js`. The domain JSON files, reserved and internal lists, and CI pipelines stay the same. Zone definitions are not coupled to the DNS provider.

The POC uses Cloudflare because that is where `runonaws.dev` lives, but the same setup runs against any of the 30+ supported providers.

## Getting started

The repo is at [amaanx86/cloudflare-dnscontrol](https://github.com/amaanx86/cloudflare-dnscontrol). Fork it, swap in your domain name and Cloudflare API token, and populate `domains/` with your existing records.

The hardest part is the initial import. DNSControl's `get-zones` command can export an existing zone to its DSL format, giving you a starting point for the JSON conversion. Do it once to get in sync, and every change after that is a PR.

---

DNS is infrastructure. Treat it like infrastructure.

---

Also published on [Hashnode](https://amaanx86.hashnode.dev/dns-as-code-managing-cloudflare-records-with-dnscontrol), [DEV.to](https://dev.to/amaanx86/dns-as-code-managing-cloudflare-records-with-dnscontrol-4c0j), and [AWS Builder Center](https://builder.aws.com/content/3E84BWcXBpy4ymEFgJxvsY8Icw7/dns-as-code-managing-cloudflare-records-with-dnscontrol).
