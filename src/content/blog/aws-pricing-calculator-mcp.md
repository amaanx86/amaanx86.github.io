---
title: "I Stopped Clicking Through the AWS Pricing Calculator. Now I Just Describe the Architecture."
description: "The AWS Pricing Calculator MCP lets Claude build a real estimate from a sentence and hand back a shareable calculator.aws URL. No credentials, no clicking. For presales engineers this is the difference between a same-day quote and 'let me get back to you next week.'"
date: 2026-06-27
tags: ["aws", "mcp", "claude", "presales", "cost-optimization", "tools"]
draft: false
---

If you have built an estimate in the AWS Pricing Calculator by hand, you know the drill. Open calculator.aws, search a service, click in, stare at twenty fields half of which you do not need, guess at the ones the form does not explain, pick a region, repeat for every service. Then redo the whole thing next week when the customer asks what it looks like in Frankfurt.

For presales that is not a small annoyance. It is the gap between giving a number on the call and saying "let me get back to you." I wired the [AWS Pricing Calculator MCP](https://github.com/aws-samples/sample-aws-pricing-calculator-mcp) into Claude, and the first real estimate I built took one sentence.

## What it is

An MCP server - an AWS Samples project - that exposes the Pricing Calculator as tools an agent can call. You describe the workload, the agent assembles the estimate, the server saves it to the real calculator, and you get a shareable `calculator.aws` URL back. Same link you would have built by hand, minus the form.

Three things make it usable in front of a customer:

- **No AWS credentials.** It hits the public, unauthenticated `calculator.aws` endpoints. You are not pointing it at an account or assuming a role. There is no blast radius.
- **Live definitions.** It pulls the calculator manifest at runtime - about 436 services - so it is current, not a snapshot from six months ago.
- **Real, editable estimates.** The URL it returns opens in the actual calculator. Tweak it, send it, whatever. The agent just did the boring part.

It runs over `stdio` for local clients like Claude Desktop, Kiro, and Cursor, or over HTTP (`MCP_TRANSPORT=http`) if you want it hosted. It also handles the `aws-iso` and `aws-eusc` partitions, which matters for sovereign and regulated work.

## Context is the whole job

The honest part: it is amazing *when you feed it the right context*. Ask for "an estimate for a web app" and you get back a web app someone else imagined. The calculator never knew your traffic - you did. The MCP does not change that.

What it changes is the translation. Once you know the shape - two m5.large instances, an ALB, 500 GB of S3, daily backups - turning that into a saved, priced, shareable estimate is instant instead of twenty minutes of clicking. You bring the requirements, the agent does the assembly. That split is the right one.

## A real estimate, start to finish

Here is one I just built. I asked for a small web tier in `us-east-1`: two `m5.large` instances on demand with gp3 storage, one Application Load Balancer, 500 GB of S3 Standard, and AWS Backup holding 30 days of daily EBS recovery points. I named it "Presales Demo."

The agent searched the services, pulled the fields, filled them, ran a preflight check, and saved it:

```json
{
  "name": "EC2 + ALB + S3 + Backup - Presales Demo",
  "sharable_url": "https://calculator.aws/#/estimate?id=59b31cbdf4a0a628b10748930fe53c8c023fd080",
  "services": [
    { "success": true, "service": "ec2Enhancement",         "group": "Prod" },
    { "success": true, "service": "applicationLoadBalancer", "group": "Prod" },
    { "success": true, "service": "amazonS3Standard",        "group": "Prod" },
    { "success": true, "service": "ebsBackup",               "group": "Prod" }
  ]
}
```

That [link is live](https://calculator.aws/#/estimate?id=59b31cbdf4a0a628b10748930fe53c8c023fd080) - it opens in the calculator with all four services priced and grouped under "Prod," ready to edit or hand off. I never opened a browser to make it.

The preflight is the part I lean on. Some calculator fields are optional to the save API but required by the pricing engine - leave one out and the estimate saves at $0. On my first pass it caught that EC2 needed `tenancy` set and flagged it instead of saving a wrong number. A confidently wrong estimate is worse than no estimate, so a tool that refuses to ship one is doing me a favor.

## Import, swap region, re-export

The other half of presales is reworking last quarter's estimate, not starting fresh. The MCP imports any estimate by URL or ID - as JSON to edit (swap the region, bump the counts, re-export) or as Markdown to hand an LLM for analysis. The region-swap loop drops from "rebuild it in the UI" to import, change one field, export.

## Why it matters for presales

The old loop: gather requirements, spend twenty minutes clicking them in, fat-finger a field, redo it, reply by end of week. The estimate was the bottleneck.

The new loop: describe the architecture while the customer is still on the call, get a shareable URL before it ends. "Actually it is closer to 80 million requests" - fine, update it, the link is still warm. The estimate moves to where the requirements live, which is the conversation. That is the real change, more than the speed.

## Running it

It is an AWS Samples repo, so install follows the README: clone it, install deps, register it as an MCP server in your client. After that you do not call tools by name - you describe the architecture and let the agent reach for them in order. Source, the verified configs, and setup are in the [repo on GitHub](https://github.com/aws-samples/sample-aws-pricing-calculator-mcp).

The summary is simple. It does not know AWS pricing for you and it does not invent your requirements. It deletes the twenty minutes between knowing what the customer needs and having a link to send. For anyone building these all day, that twenty minutes was the job.

---

Also published on [Hashnode](https://amaanx86.hashnode.dev/i-stopped-clicking-through-the-aws-pricing-calculator-now-i-just-describe-the-architecture), [DEV.to](https://dev.to/amaanx86/i-stopped-clicking-through-the-aws-pricing-calculator-now-i-just-describe-the-architecture-2leg), and [AWS Builder Center](https://builder.aws.com/content/3FlCdo3esEVEOIDf0FvYp0rVTjJ/i-stopped-clicking-through-the-aws-pricing-calculator-now-i-just-describe-the-architecture).
