---
title: "Forward Deployed Engineer is an old job with a new name, plus an agent"
description: "Shipping systems into environments you don't own, getting them through security review, and handing them to a team that has to run them is not new work. Agents add a real layer on top. Here's what carried over when I started building agents on AWS, and what I had to learn."
date: 2026-10-31
tags: ["fde", "ai", "agents", "aws", "career", "platform-engineering"]
draft: false
---

You've been asked to build an agent for a customer. It runs in their AWS account, on their data, behind their identity provider, and their security team hasn't approved Bedrock yet. Somebody on their side will have to keep it running after you're gone.

Congratulations, you're a Forward Deployed Engineer now. That's the title AWS and Anthropic are hiring for, and recruiters have started putting it on anything that involves a customer and an LLM.

I've been doing the non-AI version of this job for quite some time. Build inside the customer's account, get it past their security review, hand it to their team. Lately more and more of that work has had an agent sitting in the middle of it: AgentCore runtimes, Strands agents, tools behind a gateway, a worker pulling off a queue. And the honest surprise was how little of the work was the agent itself.

So this is what carried over from infrastructure work, and what I actually had to learn.

---

## What they're actually hiring for

Read a couple of these job posts and they're describing the same person. Someone who embeds with a customer, builds on the customer's data, owns the thing in production, and comes away with patterns the next engagement can reuse. There's one line in Anthropic's post that I think gets it exactly right:

> You don't need to have shipped agents to production. You do need deep experience building and operating production systems, hands-on time with agents, and the judgment to lead architecture and advisory work with enterprise customers.

Prompting is the easy part. What's hard to find is someone who can get a system through a messy enterprise (legacy systems, SSO nobody owns, compliance, procurement) and leave it in a state the customer can actually run.

---

## The stuff I already knew how to do

Discovery hasn't changed. Nobody walks in saying "we need an agent with three tools and a memory store." They say "my team spends half the day on this" or "the auditors are on our back." You still have to find the real constraint before you draw anything, and it's almost never the model. It's data residency, or a network team that needs three weeks to open egress, or a change board that meets every other Thursday. Find that in week one and you design around it. Find it in week six and you're rebuilding.

Then there's the security review, which is where these projects actually stall. Not the code. Someone wants a data-flow diagram. Someone wants to know which principal calls the model, where prompts get logged, and for how long. Procurement has never approved Bedrock before and wants to know what it is. If you've spent years filling in security questionnaires for normal infrastructure, you'll notice the answers are mostly the same ones you've always given. Which IAM role, what CloudTrail records, who can read the logs. Raise those questions yourself early and the agent ships. Wait for the customer's security team to raise them and it stays a demo.

Handover is the part I care about most, because it's the real test of the work. Infrastructure as code their engineers can read. A CI pipeline they own, using OIDC, with no access keys sitting in a variables page. A runbook written for their on-call engineer, not for me. With an agent the runbook gets longer, because there are new things to explain: how to roll back a prompt, how to fail over to the backup model, what to do when the dead-letter queue starts filling up at 2am.

And if you maintain Terraform modules or CI templates, you already have the habit of turning repeat work into something reusable. With agents the reusable pieces are different (a tool contract, an eval harness, a gateway setup) but it's the same muscle.

---

## The agent is the smallest box on the diagram

The first time I drew a production agent system end to end, the agent runtime was one box. Everything around it was the stuff we've always built.

Inbound events don't call the agent directly. They land in a queue, and a worker picks them up and invokes the agent, because nobody should be sitting on a synchronous request to a model that might take thirty seconds to answer. If a message keeps failing, it goes to a dead-letter queue after a few attempts, and a CloudWatch alarm pages a human. An agent that fails quietly is the worst kind.

There's always a path back to a person. If the system can't finish something within a reasonable window, it hands off. I'd design that path before anything else, honestly, because it's the thing everyone forgets until the first bad day.

The agent doesn't call your APIs directly either. Tools sit behind AgentCore Gateway, which exposes Lambda functions as MCP tools with IAM auth, so every tool call is an authenticated, logged request against a role you scoped. Memory is its own component, and it's data like any other data, with the same retention and residency questions. And there's a primary model and a fallback, wired up in the application, so one throttled model doesn't take the whole thing down.

None of that is AI work. It's distributed systems work, and it's most of the job. That's why I think the "forward deployed" part of the title matters more than the "AI" part.

---

## Treat the agent like a privileged principal

This is where infrastructure and security people have a real edge, and where most agent demos quietly fall apart.

Think about what an agent with tools actually is. It's a process that decides at runtime which APIs to call, with arguments partly shaped by whatever text a user or a retrieved document fed it. That's a confused-deputy problem. Prompt injection doesn't have to break the model. It just has to talk the model into using a tool it should never have had in the first place.

So I ask the same things I'd ask about any workload, just more nervously. What can it touch? Each tool gets its own scoped role, not one big role for the whole agent. Whose identity is it acting as, the user's or a service account that can see everyone's data? What's the blast radius if it makes a bad call? Reads by default, writes behind a human. And can I reconstruct what happened afterwards, from CloudTrail or Azure Monitor, without guessing?

![Agent trust boundary on AWS: untrusted user input and retrieved documents reach an agent runtime on Bedrock AgentCore, which calls the foundation model through Bedrock Guardrails. A policy check in the tool layer sends reads straight to an order lookup Lambda whose role allows only GetItem and Query on a DynamoDB table, and holds writes for human approval before a refund Lambda with a capped write role calls the payments API. CloudTrail and CloudWatch record every model and tool call](./images/fde-agent-trust-boundary.png)

On AWS, least privilege for a lookup tool is just boring IAM. Which is the point:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ReadOrdersForLookupToolOnly",
      "Effect": "Allow",
      "Action": ["dynamodb:GetItem", "dynamodb:Query"],
      "Resource": "arn:aws:dynamodb:us-east-1:123456789012:table/orders"
    },
    {
      "Sid": "ApplyTheOneGuardrailThisAgentUses",
      "Effect": "Allow",
      "Action": "bedrock:ApplyGuardrail",
      "Resource": "arn:aws:bedrock:us-east-1:123456789012:guardrail/abcd1234efgh"
    }
  ]
}
```

No `dynamodb:*`, no `Resource: "*"`, nothing that writes. On Azure you'd do the same thing with a managed identity per tool and a tight role assignment in Entra ID.

The best thing you can put in an agent design doc is a short list of things the system will never do. Pick the actions that stay with a human, write them down, and then check that no tool role can do them. I've found that one decision does more for the blast radius than any amount of guardrail tuning.

Lots of people can get an agent to call a tool. Not many can sit in front of a customer's security team, explain why that agent can't be talked into deleting a table, and show them the policy and the audit trail that prove it.

---

## What I had to learn

I'm still learning most of this, so take it as notes rather than answers.

**Evals.** In normal software a test passes or fails, and the same input gets you the same output. Agents don't work like that. They're non-deterministic, they're usually wrong in subtle ways rather than obvious ones, and a prompt or model change can make things worse on inputs nobody thought to test. The instinct to gate deploys carries over fine. What doesn't carry over is knowing what to measure. You end up building a golden dataset with the customer's domain experts, picking between exact-match checks, rubric scoring and LLM-as-judge, and arguing about a pass threshold the business will actually sign off on. That's product and data work. It's also never finished, because the cases that matter most are the ones production shows you later.

![Eval loop: a pull request that changes a prompt, tool, or model triggers a CI job that assumes an AWS role through OIDC for one hour, runs the eval suite against the golden set, and blocks the merge if the pass rate is below threshold. Passing changes deploy to the production agent, live traffic is sampled and scored, and new failure cases are added back to the golden dataset in S3](./images/fde-eval-loop.png)

The CI side is the easy bit, and it looks like any other gate:

```yaml
name: agent-evals

on:
  pull_request:
    paths: ["agent/**", "prompts/**", "evals/**"]

permissions:
  id-token: write   # OIDC to AWS, no stored keys
  contents: read

jobs:
  evals:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: arn:aws:iam::123456789012:role/agent-evals-ci
          aws-region: us-east-1
          role-duration-seconds: 3600

      # Fails the job if the pass rate on the golden set drops below threshold
      - run: uv run python evals/run.py --dataset evals/golden.jsonl --min-pass-rate 0.92
```

Twenty lines of YAML. The `golden.jsonl` it points at takes weeks of sitting with people who know what a right answer looks like.

**Retrieval.** Turning on Bedrock Knowledge Bases or Azure AI Search takes an afternoon. Getting answers people trust is a different story: chunking, metadata, stale documents, access control on the source files, and that one PDF that's actually a scanned fax. I understood the plumbing on day one. Tuning recall on a messy corpus took a lot longer.

**Guardrails.** Bedrock Guardrails and Azure AI Content Safety handle content filters, denied topics and PII redaction, and you should turn them on. But they won't decide whether the agent is allowed to issue a refund over a certain amount, or whether a tool call needs a human to approve it. That logic lives in your application and your tool design.

**On-call.** You already know how distributed systems break. The model brings its own failures on top. The provider updates something and behaviour shifts. A prompt change regresses. A tool returns garbage and the agent confidently acts on it. A conversation loops and quietly burns through tokens. So the dashboards change. You end up watching per-session traces, tool-call success rates, eval scores on sampled live traffic, and cost per completed task, alongside the usual latency and 5xx graphs.

---

## If you're coming from infrastructure

Build one agent end to end and run it for a month. Not in a notebook. Deploy it properly, with IaC, OIDC-based CI, scoped tool roles, a DLQ with an alarm, tracing, and a budget alert. Write a handful of evals before you write the prompts, even twenty hand-labelled examples. It changes how you design, because you stop asking "does it work?" and start asking "how often does it fail, and on what?"

Draw the whole system, not just the agent. If your diagram has one box labelled "agent" and nothing around it, that's a demo.

And lean into the security side. It's the gap most agent builders have, and it's the thing enterprise buyers worry about most. You're not competing with ML specialists there. You're the person they need on the team.

---

The FDE title will probably get stretched until it doesn't mean much, same as "DevOps engineer" did. The job underneath is real, though. Sit with the customer, ship into their production environment, own it when it breaks, and leave behind something their team can run. If you've been doing infrastructure delivery for a while, you already do most of it. The agent part you can learn, the same way we learned everything else: by running it in production and finding out where it breaks.
