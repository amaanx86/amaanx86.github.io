---
title: "Built My Own Prometheus Service Discovery for Oracle Cloud Because a 3-Year-Old PR Never Got Merged"
description: "When the upstream OCI service discovery PR sat open for three years, I built the other end of the HTTP SD interface myself. This is running in production across 10+ OCI tenancies."
date: 2026-04-12
tags: [observability, prometheus, oracle-cloud, go, infrastructure, open-source]
draft: false
---

There is a specific kind of frustration reserved for when you know a problem is solved, you can see the solution, and you still cannot use it. That is how this project started.

## The Context: Setting Up Observability From Scratch

I was building out observability from scratch across Oracle Cloud Infrastructure - multiple tenancies, multiple regions, a decent number of compute instances spread across compartments. The goal was full coverage: every VM enrolled in monitoring, no gaps, no guesswork.

When you are starting from zero, one of the first things you ask is how Prometheus is going to discover what it needs to scrape. For AWS you have EC2 service discovery built right in. Same for GCP, Azure, Hetzner, DigitalOcean. You configure credentials, set some filters, and Prometheus takes care of the rest.

OCI is not on that list.

I searched. I found a pull request in the Prometheus repository opened by an engineer at Oracle. It was exactly what I needed. It was also three years old and had never been merged. Comments, reviews, back and forth, and then silence. The PR is still open today. If you have gone looking for OCI service discovery in Prometheus you have probably landed on that same page, felt a brief moment of hope, and then noticed the date.

So I built it myself.

## What I Actually Needed

The requirement was simple: new VM comes up, Prometheus finds it and starts scraping. No manual steps in that loop. Not because I was fixing a broken process - there was no process yet. I was designing this from scratch and I was not going to design it with a gap where a human has to remember to update a config file.

The concern was blind spots. Infrastructure grows, VMs get provisioned, things change. If enrollment is manual, coverage is only as good as the last person who remembered to do it. I wanted observability that was structurally complete, not best-effort.

The workflow I landed on:

**Tag the VM in OCI.** When provisioning a new instance, add a tag - something like `prometheus:scrape = true`. That is the only enrollment step.

**Open the Prometheus port on the network security group.** Allow the Prometheus server IP to reach port 9100. One rule, specific source, no broad exposure.

**Run the node exporter playbook.** An Ansible playbook installs and starts node exporter. Done.

That is the full enrollment flow. The VM is in monitoring. No touching the Prometheus config. No reloading Prometheus. No rollout restart of a Kubernetes deployment. No SSH back into the server to verify anything.

The proxy polls OCI, finds every instance with the right tag across all configured tenancies and compartments, and hands the target list to Prometheus via the HTTP service discovery API. Prometheus picks it up on its next refresh cycle. The whole thing is automatic by design, not patched in after the fact.

## What I Built

`oci-prometheus-sd-proxy` is a lightweight Go service that implements the [Prometheus HTTP Service Discovery](https://prometheus.io/docs/prometheus/latest/http_sd/) API for OCI.

![SD Proxy Architecture](https://dev-to-uploads.s3.amazonaws.com/uploads/articles/mkzq34x8dgpt2eubp6fh.png)

You point Prometheus at it like this:

```yaml
scrape_configs:
  - job_name: oci_instances
    http_sd_configs:
      - url: 'http://oci-sd-proxy:8080/v1/targets'
        authorization:
          type: Bearer
          credentials: 'YOUR_TOKEN'
        refresh_interval: 60s
    scrape_interval: 30s
    scrape_timeout: 10s
    metrics_path: /metrics
    relabel_configs:
      - source_labels: [__meta_oci_instance_name]
        target_label: instance
      - source_labels: [__meta_oci_tenancy_name]
        target_label: tenancy
      - source_labels: [__meta_oci_compartment_name]
        target_label: compartment
      - source_labels: [__meta_oci_region]
        target_label: region
      - source_labels: [__meta_oci_availability_domain]
        target_label: availability_domain
      - source_labels: [__meta_oci_instance_shape]
        target_label: shape
```

The proxy handles the rest. It scans OCI, filters by tag, and returns targets with rich metadata: tenancy, compartment, region, availability domain, shape, fault domain, private IP, and all your custom OCI tags as Prometheus labels. Use them for relabeling, alerting rules, dashboards - whatever you need.

A few things I cared about when building it:

**Multi-tenancy from day one.** The proxy handles all tenancies in parallel from a single config file. One deployment, full coverage.

**Rate limiting.** OCI's API will return 429s if you push it too hard. The proxy uses a token bucket proactively and a retry policy reactively. Discovery does not silently fail under load.

**Security.** Bearer token auth, distroless container, read-only config mounts. In an HA setup it sits on the local network, only reachable by Prometheus. It does not need to be internet-facing and it should not be.

**Caching.** Discovery results are cached so Prometheus always gets a response, even if the OCI API is momentarily slow or rate limiting.

## Battle Tested

This is running in production across 10+ Oracle Cloud tenancies - different regions, different compartments, different team setups. It has handled OCI API slowness, tenancy permission edge cases, and the general entropy that comes with real infrastructure at scale.

The thing that still satisfies me is watching a new VM appear in Grafana within a minute of it booting, with nobody doing anything to make that happen. That is what good observability infrastructure should feel like. You build it right once and it stays right.

## Why This Did Not Exist Already

OCI is a smaller player compared to AWS or GCP and Prometheus contributors naturally prioritize the platforms most of their users are on. Oracle engineers clearly wanted to solve this - that PR is evidence of that - but getting a first-party integration merged upstream is a long road with no guarantees.

The HTTP SD API that Prometheus exposes is actually the right answer for this situation. It lets any platform plug in without touching the Prometheus codebase. I just had to build the other end of that interface.

## Try It

- **Repository**: [github.com/amaanx86/oci-prometheus-sd-proxy](https://github.com/amaanx86/oci-prometheus-sd-proxy)
- **Documentation**: [oci-prometheus-sd-proxy.readthedocs.io](https://oci-prometheus-sd-proxy.readthedocs.io/)

The docs cover installation, the full configuration reference, OCI IAM permissions, and Docker Compose deployment examples. If you are building observability on OCI and want automatic enrollment from day one, this is what I use.

And if you were one of the people who commented on that PR hoping it would eventually land - same. This is what I built instead.

---

## References

- [Oracle Forums - Prometheus Service Discovery for OCI via HTTP SD](https://forums.oracle.com/ords/apexds/post/prometheus-service-discovery-for-oci-via-http-sd-production-5441)
- [LinkedIn post](https://www.linkedin.com/posts/amaanulhaqsiddiqui_devops-prometheus-oraclecloud-activity-7437797204855087104-3F0q?utm_source=share&utm_medium=member_desktop&rcm=ACoAAEWbcAcBZTdKHcYrh82gRuQUI9J1PqDtYXA)

Also published on [DEV.to](https://dev.to/amaanx86/built-my-own-prometheus-service-discovery-for-oracle-cloud-because-a-3-year-old-pr-never-got-merged-2fme).
