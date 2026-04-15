---
title: "End-to-End Supply Chain Security for a Go Project: TUF on CI, cosign, and SLSA L3"
description: "How I wired together tuf-on-ci, Sigstore, SLSA L3 provenance, and GitHub Pages to build a fully verifiable release pipeline for oci-prometheus-sd-proxy with no long-lived signing keys anywhere."
date: 2026-04-11
tags: [security, supply-chain, tuf, sigstore, slsa, go, openssf]
---

Adding `cosign sign` to a CI pipeline and calling it "signed releases" is a bit like putting a lock on a glass door. The lock works. The glass does not. Signing the image proves a specific digest was signed by a specific identity at a specific time. It says nothing about whether the source commit matches what was built, whether the build environment was clean, or whether someone replaced the release asset after the fact.

I had been going deep on supply chain security for a while - reading through TUF specs, the Sigstore design docs, how Fulcio issues short-lived certificates, how Rekor works as an append-only transparency log. At some point I came across the OpenSSF Best Practices requirements and saw the full picture laid out as a checklist. I could have just signed the image and moved on. Instead I used [oci-prometheus-sd-proxy](https://github.com/amaanx86/oci-prometheus-sd-proxy) - a project that does OCI Prometheus service discovery - as the thing to actually build it on. I wanted to understand each layer well enough to explain it, not just wire it up. What I ended up with: cosign keyless signing, a CycloneDX SBOM attestation, SLSA L3 build provenance, and TUF metadata distribution via [tuf-on-ci](https://github.com/amaanx86/oci-prometheus-sd-proxy-tuf-on-ci) published to GitHub Pages. No long-lived keys anywhere in the pipeline.


## Why each layer exists

This is the question worth answering properly, because you can absolutely ship just cosign and be in a better position than 95% of projects. So why go further?

HTTPS protects against network-level tampering. It does not protect against a compromised GitHub account pushing a backdoored release, or a build that was modified after it completed, or an asset quietly swapped post-publication.

cosign on a container image proves that a specific digest was signed by a specific OIDC identity with the event recorded in Rekor's transparency log. That is genuinely useful - but it only covers the image. It says nothing about the source ref, the build environment, or the workflow that produced it. Someone could sign a backdoored binary and the cosign verification would pass.

SLSA L3 provenance fills that gap, and it is the layer I found most interesting to wire up. The provenance is generated in a separate, isolated signing job with its own OIDC identity, not in the main build job. That isolation is what makes L3 meaningful: an attacker who compromises the main build job cannot forge L3 provenance because they do not control the signing job's OIDC token. The provenance attests to the exact source ref, the exact workflow, and the exact runner environment. You can look at a SLSA L3 attestation and know that the image you are running came from that commit in that repo via that verified builder.

TUF adds something orthogonal to all of the above - it is about *distribution trust*, not just signing trust. It adds a role-based metadata layer where clients can verify that a release target was authorised by the project's key holders, that the metadata has not been rolled back to a previous version, and that the metadata is actually fresh. The design difference that matters: TUF survives key compromise in a way that a single cosign keypair does not. If my cosign key leaked tomorrow, every past signature would be under a cloud. With TUF, key rotation is a defined protocol. The damage is bounded and recoverable.

The point of having all four is that verification is fully independent. Verifying the image signature, the build provenance, and the TUF metadata chain are three separate operations against different data sources. Compromising any single one of them is not enough to ship a malicious release undetected. You need to compromise all of them simultaneously - and the transparency logs make doing that silently very hard.

## Two repos, one trust boundary

The implementation lives across two repositories:

- **[amaanx86/oci-prometheus-sd-proxy](https://github.com/amaanx86/oci-prometheus-sd-proxy)** - the application, the build pipeline, the release workflow
- **[amaanx86/oci-prometheus-sd-proxy-tuf-on-ci](https://github.com/amaanx86/oci-prometheus-sd-proxy-tuf-on-ci)** - TUF metadata, managed by tuf-on-ci, published to GitHub Pages

Keeping them separate was a deliberate trust boundary decision, not just organisation. The app CI can push a signing branch to the TUF repo, but it cannot merge that branch or sign `targets.json`. That step requires my OIDC identity authenticating via Sigstore in a browser - not the CI system's token. An attacker who steals the app repo's CI tokens hits a hard wall at the TUF signing step. They can push a branch, but they cannot authorise the release. The human is the last gate.

```
App repo CI (run #24290258383)
  └── builds image (linux/amd64, linux/arm64)
  └── pushes to GHCR
  └── cosign attest --type cyclonedx sbom.cyclonedx.json (SBOM)
  └── cosign sign (image signature, OIDC -> Fulcio cert -> Rekor)
  └── cosign attest --type  release-metadata.json
  └── slsa-github-generator -> SLSA L3 provenance (isolated job)
  └── pushes sign/release-1-4-2-rc-24290258383 branch -> TUF repo

TUF repo (tuf-on-ci) [PR #8]
  └── signing-event.yml detects branch push -> opens signing PR
  └── Maintainer: tuf-on-ci-sign (browser OIDC -> @amaanx86 identity)
  └── PR merged -> online-sign.yml refreshes snapshot + timestamp
  └── publish.yml -> GitHub Pages
  └── test.yml -> smoke-tests TUF client (scheduled)

Users / Policy Engines
  └── cosign verify - checks image signature against Rekor
  └── cosign verify-attestation --type cyclonedx - checks SBOM
  └── cosign verify-attestation --type  - checks release-metadata
  └── slsa-verifier verify-image - checks SLSA L3 provenance
  └── TUF client (python-tuf ngclient) - fetches metadata from GitHub Pages, verifies chain
```

## The build pipeline

The workflow (`docker-build-push.yml`) triggers on release publication. After pushing the multi-arch image (linux/amd64 and linux/arm64) to GHCR it does five more things.

### SBOM generation and attestation

First, Syft generates a CycloneDX SBOM for the pushed image, which gets attached as a cosign attestation:

```bash
cosign attest \
  --yes \
  --predicate sbom.cyclonedx.json \
  --type cyclonedx \
  ghcr.io/amaanx86/oci-prometheus-sd-proxy@sha256:759e255e607f623e0b1ee4ea9df02b2aefd89e2c9ec979842ee2e6f8b21772fd
```

The SBOM is also uploaded as a release asset (the 80.7 KB `*.cyclonedx.json` artifact visible on the workflow run).

### cosign image signing

```bash
cosign sign \
  --yes \
  ghcr.io/amaanx86/oci-prometheus-sd-proxy@sha256:759e255e607f623e0b1ee4ea9df02b2aefd89e2c9ec979842ee2e6f8b21772fd
```

No `--key` flag. cosign uses the GitHub Actions OIDC token to get an ephemeral certificate from Fulcio, signs the digest, and records the operation in Rekor. The private key is generated in memory and never stored. The Rekor entry pins the workflow identity to the specific digest at a specific timestamp.

Note the image is signed by digest, not by tag. Tags are mutable; the digest is what the signature actually covers.

No secret to rotate. No key to leak.

### Release-metadata attestation

The workflow generates a `release-metadata.json` with the image digest, source commit, release tag, and build timestamp, then attaches it as an attestation under a custom predicate type:

```bash
cosign attest \
  --yes \
  --predicate release-metadata.json \
  --type https://github.com/amaanx86/oci-prometheus-sd-proxy/release-metadata \
  ghcr.io/amaanx86/oci-prometheus-sd-proxy@sha256:759e255e607f623e0b1ee4ea9df02b2aefd89e2c9ec979842ee2e6f8b21772fd
```

Using a project-specific type URI keeps the attestation namespaced and lets `cosign verify-attestation --type <uri>` fetch exactly this attestation rather than every in-toto statement on the image.

### SLSA L3 provenance

```yaml
uses: slsa-framework/slsa-github-generator/.github/workflows/generator_container_slsa3.yml@v2.0.0
with:
  image: ghcr.io/amaanx86/oci-prometheus-sd-proxy
  digest: ${{ needs.build-and-push.outputs.digest }}
```

slsa-github-generator runs as a reusable workflow with its own isolated OIDC identity. The provenance attestation is generated and signed there, not in the main build job. L3 specifically requires this isolation - the verified builder identity in the provenance is `https://github.com/slsa-framework/slsa-github-generator/.github/workflows/generator_container_slsa3.yml@refs/tags/v2.0.0`, distinct from the app workflow's identity.

### Triggering the TUF signing event

Last step: clone the TUF repo and push a signing branch with a new target file at `targets/oci-prometheus-sd-proxy/releases/v1.4.2-rc.json`. The branch name embeds the run ID to avoid collisions: `sign/release-1-4-2-rc-24290258383` (dots in the version become hyphens, run ID appended). This branch push is what kicks off the TUF side of the pipeline.

The Python tuf library (v5+) is used inline to update `metadata/targets.json` with the new target entry before committing - the targets metadata version is incremented and signatures cleared, ready for the human signing step.

## tuf-on-ci

tuf-on-ci manages the TUF metadata lifecycle entirely within a GitHub repository. All online signing uses GitHub Actions OIDC. All offline signing uses Sigstore OIDC (browser-based). No key files anywhere.

The TUF repo has four workflows. `signing-event.yml` fires on any `sign/**` branch push, opens a PR, and annotates it with what needs signing. `online-sign.yml` runs after a signing PR is merged and refreshes `snapshot.json` and `timestamp.json` using the Actions OIDC token. `publish.yml` deploys everything to GitHub Pages. `test.yml` runs on a schedule and verifies the full metadata chain with a real TUF client to catch expiry or breakage before any user does.

### Signing a release

When `signing-event.yml` opens PR #8 with title "Signing event: sign/release-1-4-2-rc-24290258383", I run:

```bash
tuf-on-ci-sign sign/release-1-4-2-rc-24290258383
```

This opens a browser window for Sigstore OIDC. I authenticate as @amaanx86 via GitHub. Fulcio issues an ephemeral certificate tied to that identity, the tool signs `targets.json`, and pushes the signature to the branch. Rekor gets an entry proving the person at @amaanx86 authorised this specific targets update at this specific time.

Worth being clear on what "offline" means here: it requires a human with a verified identity, not a CI token. It does not require an air-gapped machine. The private key is still ephemeral.

After merge, `online-sign.yml` takes over and refreshes snapshot and timestamp automatically using the Actions OIDC token. No human needed for that part.

### What gets published

GitHub Pages at `amaanx86.github.io/oci-prometheus-sd-proxy-tuf-on-ci/metadata/` serves:

- `root.json` - signed by @amaanx86 via Sigstore OIDC; defines trusted key holders for all roles
- `targets.json` - signed by @amaanx86; lists all authorised release targets with digests
- `snapshot.json` - signed by GitHub Actions OIDC; prevents any metadata file from being swapped with an older version
- `timestamp.json` - signed by GitHub Actions OIDC; has a short validity window to prevent freeze attacks

Each release gets a target file at `targets/oci-prometheus-sd-proxy/releases/v1.4.2-rc.json`. The TUF metadata key (used inside `targets.json`) is `oci-prometheus-sd-proxy/releases/v1.4.2-rc.json` - the path is relative to the targets directory, not the repo root.

## Verifying v1.4.2-rc

All verification uses the digest, not the tag, since the tag is a mutable pointer.

Image signature:

```bash
cosign verify \
  --certificate-identity="https://github.com/amaanx86/oci-prometheus-sd-proxy/.github/workflows/docker-build-push.yml@refs/tags/v1.4.2-rc" \
  --certificate-oidc-issuer="https://token.actions.githubusercontent.com" \
  ghcr.io/amaanx86/oci-prometheus-sd-proxy@sha256:759e255e607f623e0b1ee4ea9df02b2aefd89e2c9ec979842ee2e6f8b21772fd
```

SBOM attestation:

```bash
cosign verify-attestation \
  --certificate-identity="https://github.com/amaanx86/oci-prometheus-sd-proxy/.github/workflows/docker-build-push.yml@refs/tags/v1.4.2-rc" \
  --certificate-oidc-issuer="https://token.actions.githubusercontent.com" \
  --type cyclonedx \
  ghcr.io/amaanx86/oci-prometheus-sd-proxy@sha256:759e255e607f623e0b1ee4ea9df02b2aefd89e2c9ec979842ee2e6f8b21772fd
```

Release-metadata attestation:

```bash
cosign verify-attestation \
  --certificate-identity="https://github.com/amaanx86/oci-prometheus-sd-proxy/.github/workflows/docker-build-push.yml@refs/tags/v1.4.2-rc" \
  --certificate-oidc-issuer="https://token.actions.githubusercontent.com" \
  --type "https://github.com/amaanx86/oci-prometheus-sd-proxy/release-metadata" \
  ghcr.io/amaanx86/oci-prometheus-sd-proxy@sha256:759e255e607f623e0b1ee4ea9df02b2aefd89e2c9ec979842ee2e6f8b21772fd
```

SLSA L3 provenance (requires digest reference - slsa-verifier rejects mutable tags):

```bash
slsa-verifier verify-image \
  "ghcr.io/amaanx86/oci-prometheus-sd-proxy@sha256:759e255e607f623e0b1ee4ea9df02b2aefd89e2c9ec979842ee2e6f8b21772fd" \
  --source-uri "github.com/amaanx86/oci-prometheus-sd-proxy" \
  --source-tag "v1.4.2-rc"
# Verified build using builder "...generator_container_slsa3.yml@refs/tags/v2.0.0"
# at commit a68d4cd5d29cc6b865c6804fe63adff14ac74b27
# PASSED: SLSA verification passed
```

TUF metadata chain verification is documented in detail - including the full client walkthrough and what each step validates - in the [release verification docs](https://oci-prometheus-sd-proxy.readthedocs.io/en/latest/releasing.html). The short version: a compliant TUF client walks root trust, snapshot consistency, and timestamp freshness before fetching the target. If the metadata is expired, rolled back, or the signature chain is invalid, the client raises before returning anything. That freshness check is what separates TUF from static signature verification.

## What this covers and where the gaps are

This pipeline secures the release artifact and its provenance chain. An operator fetching the image can independently verify who built it, from what source, in what environment, and that the release was authorised by a human identity. That is a lot more than most projects ship with.

But supply chain security has layers, and the release artifact is only one of them. A few honest gaps:

**Go module dependencies.** The SBOM shows what modules are in the binary, and `go.sum` pins their hashes. But `govulncheck` and a periodic dependency audit are what actually catch known-vulnerable transitive dependencies. The attestation proves the SBOM is authentic; it does not tell you the SBOM is safe.

**Runtime enforcement.** Signing and provenance only matter if someone checks them at deploy time. Right now verification is a manual step. The more interesting place this is going is integrating the cosign attestations and SLSA provenance into a Kyverno or OPA/Gatekeeper policy engine that enforces admission control in Kubernetes. Policy engines like Kyverno can query Sigstore and reject any image that lacks a valid SLSA L3 attestation from the correct workflow identity - automatically, at admission time, not as a manual verification step. That closes the loop between what we proved at build time and what is allowed to run in production.

**TUF root key compromise.** If the @amaanx86 GitHub account itself was compromised, an attacker could rotate the root TUF key in a way that would pass client verification. TUF supports threshold signatures across multiple root key holders to mitigate this, which becomes relevant as the project scales to multiple maintainers.

**The dependency of your dependencies.** None of this solves a compromised `slsa-github-generator` or a backdoored Syft release. That is a solved problem in theory (pin action hashes, verify the tools themselves) but it is worth naming.

## What I am building toward

The next step that interests me most is closing the loop at runtime.

The next meaningful investment is runtime enforcement. Kyverno ClusterPolicies that require verified SLSA provenance before admission, OPA rules that check SBOM attestations against a known-safe package policy, and Sigstore-aware image admission are all achievable with what the pipeline already produces. The attestations are already there. The policy layer that consumes them is the missing piece.

After that, expanding to multi-maintainer TUF with hardware-backed root keys and threshold signatures would make the trust model genuinely robust at scale.

---

Full implementation details and the verification workflow are documented at [oci-prometheus-sd-proxy.readthedocs.io/en/latest/releasing.html](https://oci-prometheus-sd-proxy.readthedocs.io/en/latest/releasing.html).

---

Also published on [DEV.to](https://dev.to/amaanx86/end-to-end-supply-chain-security-for-a-go-project-tuf-on-ci-cosign-and-slsa-l3-1575), [AWS Builder ID](https://builder.aws.com/content/3CEE0bcWsPBxnBBvV3nbjMf0Pwi/end-to-end-supply-chain-security-for-a-go-project-tuf-on-ci-cosign-and-slsa-l3), and [Hashnode](https://amaanx86.hashnode.dev/end-to-end-supply-chain-security-for-a-go-project-tuf-on-ci-cosign-and-slsa-l3).
