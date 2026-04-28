---
title: "Bypassing Cloudflare for True Origin Health Checks with Blackbox Exporter and CoreDNS"
description: "When Cloudflare masks origin failures, your health checks lie to you. A CoreDNS sidecar that overrides DNS resolution lets Blackbox Exporter probe origins directly while keeping TLS and Host headers intact."
date: 2026-04-28
tags: [observability, prometheus, cloudflare, dns, infrastructure, monitoring]
draft: false
---

You have 100+ web endpoints behind Cloudflare. You need to know if the origin is healthy. Not the edge. Not the CDN cache. The actual server behind it.

Prometheus Blackbox Exporter is the standard answer for HTTP probing. Point it at a URL, it makes a request, you get `probe_success`, `probe_duration_seconds`, `probe_http_status_code`. Clean, simple, works.

Until you put Cloudflare in front of everything.

## The problem

When Blackbox probes `https://app.example.com`, DNS resolves to Cloudflare's edge. The request hits their network, gets proxied, maybe served from cache. Your probe comes back 200 OK. Meanwhile the origin server is on fire and has been returning 502s for twenty minutes. Cloudflare is masking the failure by serving a stale response or its own error page with a 200-ish status.

Even when it does proxy through to origin, you are measuring Cloudflare-to-origin latency plus edge processing time. Your `probe_duration_seconds` metric is useless for understanding actual server response time.

The health check is lying to you. It is monitoring Cloudflare's availability, not yours.

## Naive approaches that do not work

**"Just use the origin IP directly."**

`https://198.51.100.10` - sure, but now TLS fails. The certificate is issued for `app.example.com`, not for an IP address. You could skip TLS verification (`insecure_skip_verify: true`), but then you are not testing what your users actually experience. And many applications inspect the `Host` header for routing. Hitting a raw IP with no SNI or wrong Host header gets you a 404 or default backend, not a real health check.

**"Use /etc/hosts on the monitoring server."**

Map `app.example.com` to the origin IP in `/etc/hosts`. This works for exactly one server. Then you have 80 endpoints across a fleet of monitoring nodes and you are managing hosts files by hand. You update an origin IP and forget to update the hosts file. You add a new domain and forget to add the entry. It is a maintenance problem disguised as a solution.

Also, depending on your deployment model, you might not even control `/etc/hosts`. And even if you do, the change is system-wide. Every process on that host now bypasses Cloudflare for those domains, which is probably not what you want.

**"Set a custom DNS server in Prometheus."**

Prometheus does not probe endpoints itself. It tells Blackbox Exporter to probe them. Changing DNS settings on the Prometheus host does nothing - Blackbox is the one resolving the domain. You need to control DNS resolution at the Blackbox process level.

**"Curl with --resolve."**

Works great for ad-hoc debugging. Not a thing you can configure in Blackbox Exporter. The prober does not expose a per-target DNS override. It resolves using whatever DNS the process has access to.

## Architecture

```
                         Public DNS (Cloudflare)
                         Returns edge IPs -- NOT what we want
                                  |
                                  X  (bypassed)
                                  |
+----------------------------+    |    +----------------------------+
|      Prometheus            |    |    |      CoreDNS Sidecar       |
|                            |    |    |                            |
|  "probe app.example.com"   |    |    |  hosts.override:           |
|         |                  |    |    |    198.51.100.10            |
|         v                  |    |    |        app.example.com     |
|  +------------------+      |    |    |        api.example.com     |
|  | Blackbox Exporter |------+---------->  203.0.113.50            |
|  |                  |  DNS query |    |        docs.example.org   |
|  |  dns: 172.20.0.53|<----------+    |                            |
|  +------------------+      |    |    |  fallthrough -> 8.8.8.8    |
|         |                  |    |    +----------------------------+
+---------|------------------+    |
          |                       |
          | TLS + SNI: app.example.com
          | Host: app.example.com
          | IP: 198.51.100.10
          |
          v
+----------------------------+
|   Origin Load Balancer     |
|   198.51.100.10:443        |
|                            |
|   Serves real certificate  |
|   Routes by Host header    |
+----------------------------+
          |
          v
+----------------------------+
|   Application Server       |
|   Actual origin response   |
+----------------------------+
```

The trick is one line in the Blackbox Exporter config: point its DNS at the CoreDNS sidecar instead of the system resolver. CoreDNS returns origin IPs for overridden domains, falls through to public DNS for everything else. Blackbox never knows the difference - it just resolves and probes like normal.

## The actual solution: a DNS sidecar

The insight is simple once you see it: if you control what DNS server Blackbox Exporter uses, you control where its probes land. You do not need to touch Blackbox's config at all. You do not need to modify how Prometheus scrapes. You just need a DNS resolver that lies about specific domains - returns your origin load balancer IP instead of Cloudflare's edge IP.

CoreDNS is perfect for this. It is a lightweight, pluggable DNS server. The relevant config is about six lines:

```
. {
    hosts /etc/coredns/hosts.override {
        fallthrough
    }

    forward . 8.8.8.8

    log
    errors
}
```

That is it. CoreDNS loads a hosts file for overridden domains. Anything not in the file falls through to `8.8.8.8` for normal resolution.

The hosts override file is a plain hosts-format file. Nothing exotic:

```
# Origin LB for production
198.51.100.10  app.example.com
198.51.100.10  api.example.com
198.51.100.10  cdn.example.com

# Origin LB for staging
198.51.100.20  staging.example.com
198.51.100.20  staging-api.example.com

# Origin LB for partner sites
203.0.113.50   docs.example.org
203.0.113.50   status.example.org

203.0.113.71   shop.example.net
203.0.113.72   blog.example.net
```

Each line maps a domain to the public IP of the actual load balancer in front of the origin servers. Multiple domains can point to the same LB. Commented lines for decommissioned endpoints. Straightforward.

Then you point Blackbox Exporter's DNS resolution at this CoreDNS instance. If CoreDNS is running at `172.20.0.53`, you set Blackbox's DNS to that address. The mechanism depends on your runtime - a `dns` directive, a `resolv.conf` mount, whatever your environment supports. The point is that Blackbox resolves domains through CoreDNS, not through the system default.

## What happens at probe time

The flow:

1. Prometheus tells Blackbox: probe `https://app.example.com`
2. Blackbox resolves `app.example.com` via CoreDNS at `172.20.0.53`
3. CoreDNS checks its hosts override file, finds the entry, returns `198.51.100.10`
4. Blackbox connects to `198.51.100.10:443`, sends TLS ClientHello with SNI `app.example.com`
5. The load balancer presents its certificate for `app.example.com`, TLS completes normally
6. Blackbox sends the HTTP request with `Host: app.example.com`
7. The application responds directly - no Cloudflare in the path

TLS works because the domain name is preserved. The origin LB has the real certificate. SNI and Host header are correct because Blackbox thinks it is talking to `app.example.com` - it just happens to have resolved to a different IP than Cloudflare's.

This is the key: you are not changing what Blackbox probes, you are changing where the name resolves to. Everything else - TLS negotiation, Host header, path, response validation - stays exactly the same.

## The Prometheus side

Nothing changes in how you write your scrape config. Blackbox probing uses the standard multi-target pattern:

```yaml
- job_name: blackbox_https_prod
  metrics_path: /probe
  scrape_interval: 60s
  scrape_timeout: 15s
  params:
    module: [http_2xx]
  static_configs:
    - targets:
        - app.example.com
        - api.example.com
        - shop.example.net
        - blog.example.net
        - docs.example.org
  relabel_configs:
    - source_labels: [__address__]
      target_label: __param_target
      replacement: https://$1
    - source_labels: [__address__]
      target_label: instance
    - target_label: __address__
      replacement: <blackbox-host>:9115
```

Targets are just domain names. The relabel chain rewrites them into probe parameters and sets the `instance` label to the human-readable domain. Nothing here is aware of Cloudflare or DNS overrides. That is all handled one layer down.

This separation matters. The person adding a new endpoint to monitoring does not need to know about the DNS plumbing. They add the domain to the target list. If the domain needs a DNS override, someone adds it to the hosts file. Two different concerns, two different files.

## Alerting on actual origin health

With Cloudflare out of the path, your alerts are honest. A `probe_success == 0` means the origin is actually down, not that Cloudflare is having a bad day.

```yaml
- alert: EndpointDown
  expr: probe_success{job=~"blackbox_https_(prod|nonprod)"} == 0
  for: 0m
  labels:
    severity: critical
  annotations:
    summary: "Endpoint DOWN: {{ $labels.instance }}"

- alert: EndpointHighLatency
  expr: probe_duration_seconds{job=~"blackbox_https_(prod|nonprod)"} > 3
  for: 10m
  labels:
    severity: warning
  annotations:
    summary: "High latency: {{ $labels.instance }} ({{ $value | printf \"%.2f\" }}s)"
```

`for: 0m` on the down alert - no waiting. If the origin is unreachable, you want to know immediately. The latency alert uses `for: 10m` because transient spikes happen and you do not want noise. These thresholds are tunable, but the point is that the data feeding them is real. You are measuring origin behavior, not CDN behavior.

## Why not just use /etc/hosts at scale

It is worth expanding on why the hosts-file-on-the-monitoring-host approach breaks down, because it is the first thing most people try.

**Scope creep.** You start with five domains. Then twenty. Then eighty. Each load balancer IP change requires updating the file and restarting the service. Miss one and you are probing the wrong backend for weeks without knowing.

**Blast radius.** System-wide DNS overrides affect everything on the host. Your monitoring stack bypasses Cloudflare - great. But so does every other process. If you are running anything else on that host that legitimately needs to hit the CDN edge, you have broken it.

**Reproducibility.** The hosts file is stateful, manual, and easy to drift. CoreDNS with a hosts file is also just a flat file, but it is scoped to a single process (Blackbox), versioned in your repo, and trivially reproducible. Rebuild the monitoring stack from scratch and the DNS overrides come with it.

**Multiple monitoring replicas.** If you run more than one Prometheus instance for redundancy (and you should), each one has its own Blackbox Exporter. Managing hosts files across multiple hosts is the kind of thing that works until it doesn't. A dedicated DNS sidecar per replica is self-contained.

## Operational considerations

**Adding a new endpoint.** Two steps: add the domain to Prometheus targets, add the domain-to-IP mapping in the CoreDNS hosts file. Reload both. Five-minute task.

**IP changes.** When a load balancer gets a new IP, update one line in the hosts file, restart CoreDNS. Blackbox automatically starts resolving to the new address on its next probe.

**Domains not behind Cloudflare.** The `fallthrough` directive in CoreDNS means anything not in the hosts file gets resolved normally via `8.8.8.8`. So you can mix Cloudflare-proxied and direct endpoints in the same Blackbox instance. No special handling needed.

**Debugging.** `dig @172.20.0.53 app.example.com` tells you exactly what Blackbox will resolve. If the probe is failing, check whether CoreDNS returns the right IP. If it does, the problem is downstream. If it does not, your hosts file is wrong. Clean separation of concerns.

## The broader pattern

This is not really about Cloudflare specifically. The same approach works for any situation where public DNS does not resolve to where you want your probes to land:

- Services behind any CDN or reverse proxy (Akamai, Fastly, AWS CloudFront)
- Internal services with split-horizon DNS where monitoring runs in a different network zone
- Migration scenarios where you want to probe the new backend before cutting DNS over
- Canary deployments where you want to health-check a new origin before adding it to the pool

The pattern is always the same: run a lightweight DNS resolver as a sidecar, override the specific records you need, let everything else pass through. Your probing tool does not need to know about any of this. It just resolves names and makes requests, which is exactly what it should do.

---

The setup is simple. CoreDNS is maybe 30MB of memory. The hosts file is trivially maintainable. And the result is that when your pager goes off at 3am, you know it is because the origin is actually down - not because Cloudflare rotated an edge node.

That is the kind of signal worth waking up for.

Also published on [DEV.to](https://dev.to/amaanx86/bypassing-cloudflare-for-true-origin-health-checks-with-blackbox-exporter-and-coredns-4fhg), [AWS Builder ID](https://builder.aws.com/content/3Czz3pnlo6MHI2CmsxGuQh959CS/bypassing-cloudflare-for-true-origin-health-checks-with-blackbox-exporter-and-coredns), and [Hashnode](https://amaanx86.hashnode.dev/bypassing-cloudflare-for-true-origin-health-checks-with-blackbox-exporter-and-coredns).
