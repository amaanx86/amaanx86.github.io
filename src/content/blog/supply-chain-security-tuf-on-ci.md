---
title: "End-to-End Supply Chain Security for a Go Project: TUF on CI, cosign, and SLSA L3"
description: "How I wired together tuf-on-ci, Sigstore, SLSA L3 provenance, and GitHub Pages to build a fully verifiable release pipeline for oci-prometheus-sd-proxy with no long-lived signing keys anywhere."
date: 2026-04-11
tags: [security, supply-chain, tuf, sigstore, slsa, go, openssf]
---

Adding `cosign sign` to a CI pipeline and calling it "signed releases" is a bit like putting a lock on a glass door. The lock works. The glass does not. Signing the image proves a specific digest was signed by a specific identity at a specific time. It says nothing about whether the source commit matches what was built, whether the build environment was clean, or whether someone replaced the release asset after the fact.

I wanted to actually solve this for [oci-prometheus-sd-proxy](https://github.com/amaanx86/oci-prometheus-sd-proxy) as part of working toward the OpenSSF Best Practices Metal badge. What I ended up building: cosign keyless image signing, release-metadata attestations, SLSA L3 build provenance, and TUF metadata distribution via [tuf-on-ci](https://github.com/amaanx86/oci-prometheus-sd-proxy-tuf-on-ci) published to GitHub Pages. No long-lived keys anywhere in the pipeline.

## Why each layer exists

HTTPS protects against network-level tampering. It does not protect against a compromised GitHub account pushing a backdoored release, or a build that was modified after it completed, or an asset quietly swapped post-publication.

cosign on a container image proves that a specific digest was signed by a specific OIDC identity with the event recorded in Rekor's transparency log. That is useful but it only covers the image. It does not prove anything about the source ref, the build environment, or the workflow that produced it.

SLSA L3 provenance fills that gap. The provenance is generated in a separate, isolated signing job with its own OIDC identity, then attached to the image as an attestation. An attacker who controls the main build job cannot forge L3 provenance because they do not control the signing job's OIDC token. The provenance attests to the exact source ref, the exact workflow, and the exact runner environment.

TUF does something different from all of the above. It adds a role-based metadata layer where clients can verify that a release target was authorised by the project's key holders, that the metadata has not been rolled back to a previous version, and that the metadata is actually fresh. TUF is designed to survive key compromise in a way that a single cosign keypair is not. If my cosign key got leaked tomorrow, every past signature would be suspect. With TUF, key rotation is a defined process and the damage is bounded.

The point of having all four is that verification is fully independent. Verifying the image signature, the build provenance, and the TUF metadata chain are three separate operations against different data sources. Compromising any one of them is not enough.

## Two repos, one trust boundary

The implementation lives across two repositories:

- **[amaanx86/oci-prometheus-sd-proxy](https://github.com/amaanx86/oci-prometheus-sd-proxy)** - the application, the build pipeline, the release workflow
- **[amaanx86/oci-prometheus-sd-proxy-tuf-on-ci](https://github.com/amaanx86/oci-prometheus-sd-proxy-tuf-on-ci)** - TUF metadata, managed by tuf-on-ci, published to GitHub Pages

Keeping them separate is not just organisational. The app CI can push a signing branch to the TUF repo, but it cannot merge that branch or sign `targets.json`. That step requires my OIDC identity, not the CI system's. An attacker who steals the app repo's CI tokens hits a wall at the TUF signing step.

```
App repo CI
  └── builds image
  └── pushes to GHCR
  └── cosign sign (OIDC -> Fulcio cert -> Rekor)
  └── cosign attest release-metadata.json
  └── slsa-github-generator -> SLSA L3 provenance
  └── pushes sign/release-* branch -> TUF repo

TUF repo (tuf-on-ci)
  └── signing-event.yml detects branch push -> opens signing PR
  └── Maintainer: tuf-on-ci-sign (browser OIDC -> @amaanx86 identity)
  └── PR merged -> online-sign.yml refreshes snapshot + timestamp
  └── publish.yml -> GitHub Pages
  └── test.yml -> smoke-tests TUF client (scheduled)

Users / Policy Engines
  └── cosign verify - checks image signature against Rekor
  └── cosign verify-attestation - checks release-metadata attestation
  └── slsa-verifier verify-image - checks SLSA L3 provenance
  └── TUF client - fetches metadata from GitHub Pages, verifies chain
```

## The build pipeline

The workflow (`docker-build-push.yml`) triggers on release publication. After pushing the image to GHCR it does four more things.

### cosign signing

```bash
cosign sign \
  --yes \
  ghcr.io/amaanx86/oci-prometheus-sd-proxy@${DIGEST}
```

No `--key` flag. cosign uses the GitHub Actions OIDC token to get an ephemeral certificate from Fulcio, signs the digest, and records the operation in Rekor. The private key is generated in memory and never stored. The Rekor entry pins the workflow identity (`https://github.com/amaanx86/oci-prometheus-sd-proxy/.github/workflows/docker-build-push.yml@refs/tags/v1.2.3`) to the specific digest at a specific timestamp.

No secret to rotate. No key to leak.

### Release-metadata attestation

The workflow generates a `release-metadata.json` with the image digest, source commit, release tag, and build timestamp, then attaches it as an attestation:

```bash
cosign attest \
  --yes \
  --type custom \
  --predicate release-metadata.json \
  ghcr.io/amaanx86/oci-prometheus-sd-proxy@${DIGEST}
```

This lands in GHCR as an OCI artifact next to the image, signed with the same ephemeral certificate. `cosign verify-attestation` retrieves and verifies it.

### SLSA L3 provenance

```yaml
uses: slsa-framework/slsa-github-generator/.github/workflows/generator_container_slsa3.yml@v2
with:
  image: ghcr.io/amaanx86/oci-prometheus-sd-proxy
  digest: ${{ steps.build.outputs.digest }}
```

`slsa-github-generator` runs as a reusable workflow with its own isolated OIDC identity. The provenance attestation is generated and signed there, not in the main build job. L3 specifically requires this isolation. Verifying it:

```bash
slsa-verifier verify-image \
  ghcr.io/amaanx86/oci-prometheus-sd-proxy:v1.2.3 \
  --source-uri github.com/amaanx86/oci-prometheus-sd-proxy \
  --source-tag v1.2.3
```

### Triggering the TUF signing event

Last step: clone the TUF repo and push a `sign/release-vX.Y.Z` branch with a new file at `targets/releases/vX.Y.Z.json` containing the image digest and verification commands. This branch push is what kicks off the TUF side of the pipeline.

## tuf-on-ci

[tuf-on-ci](https://github.com/theupdateframework/tuf-on-ci) manages the TUF metadata lifecycle entirely within a GitHub repository. All online signing uses GitHub Actions OIDC. All offline signing uses Sigstore OIDC (browser-based). No key files anywhere.

The TUF repo has four workflows. `signing-event.yml` fires on any `sign/**` branch push, opens a PR, and annotates it with what needs signing. `online-sign.yml` runs after a signing PR is merged and refreshes `snapshot.json` and `timestamp.json` using the Actions OIDC token. `publish.yml` deploys everything to GitHub Pages. `test.yml` runs on a schedule and verifies the full metadata chain with a real TUF client to catch expiry or breakage before any user does.

### Signing a release

When `signing-event.yml` opens the PR I run:

```bash
tuf-on-ci-sign sign/release-v1.2.3
```

This opens a browser window for Sigstore OIDC. I authenticate as `@amaanx86` via GitHub. Fulcio issues an ephemeral certificate tied to that identity, the tool signs `targets.json`, and pushes the signature to the branch. Rekor gets an entry proving the person at `@amaanx86` authorised this specific targets update at this specific time.

Worth being clear on what "offline" means here: it requires a human with a verified identity, not a CI token. It does not require an air-gapped machine. The private key is still ephemeral.

After merge, `online-sign.yml` takes over and refreshes snapshot and timestamp automatically using the Actions OIDC token. No human needed for that part.

### What gets published

GitHub Pages at `amaanx86.github.io/oci-prometheus-sd-proxy-tuf-on-ci/metadata/` serves:

- `root.json` - signed by `@amaanx86` via Sigstore OIDC; defines trusted key holders for all roles
- `targets.json` - signed by `@amaanx86`; lists all authorised release targets with digests
- `snapshot.json` - signed by GitHub Actions OIDC; prevents any metadata file from being swapped with an older version
- `timestamp.json` - signed by GitHub Actions OIDC; has a short validity window to prevent freeze attacks

Each release gets a target file at `targets/releases/vX.Y.Z.json` with the digest and the exact verification commands for that version.

## Verifying a release

**Image signature:**
```bash
cosign verify \
  --certificate-identity-regexp="https://github.com/amaanx86/oci-prometheus-sd-proxy/" \
  --certificate-oidc-issuer="https://token.actions.githubusercontent.com" \
  ghcr.io/amaanx86/oci-prometheus-sd-proxy:v1.2.3
```

**Release-metadata attestation:**
```bash
cosign verify-attestation \
  --type custom \
  --certificate-identity-regexp="https://github.com/amaanx86/oci-prometheus-sd-proxy/" \
  --certificate-oidc-issuer="https://token.actions.githubusercontent.com" \
  ghcr.io/amaanx86/oci-prometheus-sd-proxy:v1.2.3
```

**SLSA L3 provenance:**
```bash
slsa-verifier verify-image \
  ghcr.io/amaanx86/oci-prometheus-sd-proxy:v1.2.3 \
  --source-uri github.com/amaanx86/oci-prometheus-sd-proxy \
  --source-tag v1.2.3
```

**TUF metadata chain:**
```bash
tuf-client init \
  https://amaanx86.github.io/oci-prometheus-sd-proxy-tuf-on-ci/metadata/ \
  root.json

tuf-client get targets/releases/v1.2.3.json
```

The TUF client walks the full chain: root trust, targets delegation, snapshot consistency, timestamp freshness. If anything is wrong - invalid signature, expired metadata, or a newer version being withheld - it stops and refuses to proceed.

## What this does not fix

This covers the release artifact and its provenance chain. It does not cover the Go module dependency tree (that is `go.sum` plus `govulncheck`), runtime integrity after deployment (that is where Kyverno or OPA consuming the cosign attestations comes in), or the cost of rotating the root key if the `@amaanx86` GitHub account itself was compromised. TUF supports root key rotation but it requires a careful sequence and propagation to existing clients.

The full implementation and release docs are at [oci-prometheus-sd-proxy.readthedocs.io](https://oci-prometheus-sd-proxy.readthedocs.io/en/latest/releasing.html).
