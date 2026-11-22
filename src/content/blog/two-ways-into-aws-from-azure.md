---
title: "Two Ways into AWS from Azure: Entra ID Federation and IAM Roles Anywhere"
description: "An Azure workload that needs S3 or SQS usually ends up with an AWS access key in Key Vault. There are two ways to get rid of that key, and only one of them also works for your data centre, Oracle Cloud, and anywhere else that has no identity provider AWS can trust."
date: 2026-11-23
tags: ["aws", "security", "iam", "azure", "identity"]
draft: false
---

If you run a hybrid setup, you have seen this. An app in Azure needs to read from S3, push to SQS, or pull from ECR. Someone creates an IAM user, generates an access key, and puts it in Key Vault. Ticket closed. Secure, because it is in Key Vault.

It is not. It is a static key in a nicer box.

It never expires. It works from any machine on the internet. Rotation is a calendar reminder nobody owns, and the day it leaks, Key Vault does nothing for you. Key Vault protects where the key is stored, not what the key can do.

There are two ways to get rid of it. Both work. Only one also works outside Azure, and in a hybrid setup, plenty of workloads are outside Azure.

---

## The setup

![Two paths from Azure into AWS. Path 1: a managed identity's Entra ID token is exchanged at AWS STS through an IAM OIDC provider. Path 2: a certificate from Key Vault signs a Roles Anywhere session. Both assume one least-privilege IAM role whose short-lived credentials reach only the services it allows: S3, DynamoDB, SQS, SNS, and ECR](./images/azure-to-aws-two-paths.png)

Both paths end at the same place: an IAM role and temporary STS credentials that expire on their own. That is where least privilege lives. One role per workload, scoped to what it does. `s3:GetObject` on one prefix. `sqs:SendMessage` on one queue. `ecr:BatchGetImage` and `ecr:GetDownloadUrlForLayer` on one repository, plus `ecr:GetAuthorizationToken`, which only accepts `"Resource": "*"`.

What changes is how the workload proves who it is.

---

## Option 1: Federate Entra ID

An Azure VM, App Service, or Function with a managed identity can already get a token from Entra ID. AWS can trust Entra ID as an OIDC provider. Put the two together and the workload trades an Entra token for AWS credentials. No stored secret.

On a VM (App Service and Functions use `IDENTITY_ENDPOINT` with an `X-IDENTITY-HEADER` header instead of 169.254.169.254):

1. Create an app registration in Entra ID with an application ID URI, say `api://aws-federation`. That is the resource the workload asks for a token for.
2. Get a token from the local identity endpoint:

   ```bash
   curl -s -H "Metadata: true" \
     "http://169.254.169.254/metadata/identity/oauth2/token?api-version=2018-02-01&resource=api://aws-federation"
   ```

3. In AWS, create an IAM OIDC provider for your tenant's Entra issuer, with the token's `aud` as the audience. For v1 tokens that is the application ID URI. For v2 it is always the app registration's client ID, whatever URI you asked for.
4. On the role, allow `sts:AssumeRoleWithWebIdentity` from that provider, with conditions on audience and subject. For a managed identity, the subject is its object (principal) ID, not its client ID.

The SDKs handle the exchange. Set `AWS_ROLE_ARN` and point `AWS_WEB_IDENTITY_TOKEN_FILE` at a file holding the token. The SDK re-reads the file on every refresh, but nothing writes it for you. A systemd timer or sidecar that rewrites it every few minutes is enough. Skip it and you find out on day two.

Two things will bite you.

**The issuer has to match exactly.** v1 tokens use `https://sts.windows.net/<tenant-id>/`, v2 use `https://login.microsoftonline.com/<tenant-id>/v2.0`. The IAM provider URL has to match `iss` character for character, and the version changes `aud` too. Tokens are v1 unless the manifest sets version 2 (`accessTokenAcceptedVersion` in the classic manifest, `requestedAccessTokenVersion` in the Graph format). Decode a real token first. It saves you an afternoon.

**Pin the subject, not just the audience.** The audience only proves the token was minted for your app registration. The subject ties the role to one managed identity. Skip it and you trusted the app registration, not the workload. On the Entra side, set `appRoleAssignmentRequired` on the enterprise application and assign an app role to the managed identity, so nothing else in the tenant can get a token for that audience.

The honest part: the VM is the trust boundary. Any code on the VM can request a token for any identity attached to it. Federation removes the stored secret. It does not stop a compromised box from minting tokens as the workload.

---

## Option 2: IAM Roles Anywhere

Roles Anywhere flips the model. AWS trusts a certificate authority, not an identity provider. A workload with a certificate from that CA and its private key signs a request and gets temporary credentials back.

Three pieces:

- **Trust anchor.** Your CA's certificate, registered with Roles Anywhere. Use whatever already runs your PKI: AWS Private CA, HashiCorp Vault's PKI engine, or Windows AD CS, with Key Vault holding the issued certificates. Key Vault only auto-renews certificates from its integrated public CAs, so renewal is yours: Key Vault generates the CSR, and something has to get it signed and merged back before expiry. With an external CA, AWS only sees the public certificate.
- **Profile.** Which roles can be assumed, and for how long: 15 minutes to 12 hours, one hour by default. It cannot exceed the role's maximum session duration, which also defaults to one hour. A 12-hour profile on a default role fails every `CreateSession`.
- **Role.** A normal IAM role that trusts `rolesanywhere.amazonaws.com`.

The trust policy is where security actually gets decided. Profiles are not tied to trust anchors, so out of the box any certificate from any anchor in the account can assume the role through any profile that lists it. Do not leave it like that:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": { "Service": "rolesanywhere.amazonaws.com" },
      "Action": ["sts:AssumeRole", "sts:TagSession", "sts:SetSourceIdentity"],
      "Condition": {
        "ArnEquals": {
          "aws:SourceArn": "arn:aws:rolesanywhere:us-east-1:123456789012:trust-anchor/TRUST_ANCHOR_ID"
        },
        "StringEquals": {
          "aws:PrincipalTag/x509Subject/CN": "orders-api"
        }
      }
    }
  ]
}
```

`aws:SourceArn` pins the role to one trust anchor, so a CA someone adds next year cannot be used against it. Use the canonical ARN with the trust anchor ID, not an alias. Roles Anywhere always sets `aws:SourceArn` to the canonical form, so a condition on the alias never matches. The CN condition pins the role to one workload's certificate, so one stolen certificate does not open every role in the account.

On the workload, AWS's credential helper does the signing. Wire it in as a `credential_process` and every SDK and the CLI pick it up:

```ini
[profile orders-api]
credential_process = aws_signing_helper credential-process --certificate /etc/pki/orders-api.pem --private-key /etc/pki/orders-api.key --trust-anchor-arn arn:aws:rolesanywhere:us-east-1:123456789012:trust-anchor/TRUST_ANCHOR_ID --profile-arn arn:aws:rolesanywhere:us-east-1:123456789012:profile/PROFILE_ID --role-arn arn:aws:iam::123456789012:role/orders-api
```

Keep it on one line. The AWS config file has no line continuation.

On an Azure VM, the easy setup reads the certificate and key from Key Vault at boot with the managed identity. That is the "read certificate" step in the diagram. Know what it buys you: the managed identity is still the root of trust, since anything that can reach the identity endpoint can read the same secret, and now there is a key file on disk too. It is the convenience option, not the hardened one.

The helper also has `serve`, which emulates the metadata endpoint on localhost, and `update`, which writes to `~/.aws/credentials`. Both expose credentials to more than the one process that needs them. Stick with `credential-process` unless a tool forces you.

And this is the part I like most. The helper can sign with a key in a TPM, a PKCS#11 HSM, the Windows certificate store, or the macOS Keychain, without the key ever leaving it. Federation cannot do that. Any process on the VM can request a token. A key sealed in a TPM only works on that machine. On Azure, that means a Trusted Launch VM: generate the key in the vTPM, send a CSR to your CA, and keep Key Vault out of it.

---

## Revocation is the weak spot

Plan this before you need it.

Roles Anywhere does not support OCSP. You can import a CRL through the API, but AWS ignores its `nextUpdate` and keeps using whatever you imported last. If you go this way, automate the re-import.

The newer option lets Roles Anywhere fetch CRLs from the distribution points in the certificate. It is off by default and set per trust anchor. It honours `nextUpdate` and fails closed when it has no valid CRL. It can take up to 30 minutes to pick up a CRL after your CA publishes it, so real latency is your CA's publishing interval plus up to 30 minutes. On many internal CAs that interval is hours. Keep it short.

Read the requirements first. Only HTTP and HTTPS distribution points count, LDAP is ignored, redirects are not followed, and every URL must resolve to a public IP. Most internal CAs publish their CRL on a private host. Turn this on against one of those and every `CreateSession` fails.

For anything urgent, disable the profile or trust anchor to stop new sessions, then hit "Revoke active sessions" on the role. That adds a deny on `aws:TokenIssueTime`, so credentials already issued stop working now instead of at expiry. Short sessions still matter, because they limit the damage before anyone notices.

For audit, every session shows up in CloudTrail as `CreateSession`, with the certificate's serial number in hex as the role session name. Every API call traces back to the exact certificate.

---

## So why bother with Roles Anywhere?

For a workload in Azure with a managed identity, start with federation. No CA to run, nothing to revoke.

But federation only works where the platform gives the workload a token AWS can trust. In a hybrid setup, plenty of workloads do not have one.

**Your own data centre.** The clearest case. A physical server or on-prem VM has no metadata endpoint and no token to federate. Roles Anywhere was built for exactly this. Most enterprises already run an internal CA, and with TPMs the key lives in hardware. Without Roles Anywhere, you are back to the static key this post started with.

Azure Arc is the exception. An Arc-enabled server gets a managed identity and can use Option 1. The cost is an agent on every server, onboarding into an Azure subscription, and an Azure dependency for on-prem access to AWS. Reading the Arc token also needs elevated rights: root or the `himds` group on Linux, Administrators or the Hybrid agent extension applications group on Windows. If you already run Arc, use it. If not, a certificate is the lighter dependency.

**Oracle Cloud.** Close behind. OCI instance principals are a solid identity inside OCI, but AWS STS does not accept their tokens. The documented OIDC route goes through an OCI identity domain, and [Oracle's own walkthrough](https://www.ateam-oracle.com/using-oci-identity-domain-as-an-oidc-provider-for-aws-sts) gets the token with a client ID and client secret. That is a stored secret again, one hop removed from the key you set out to remove. AWS STS added an OCI resource principal condition key this year, so a keyless route may be coming, but I have not seen one documented end to end for a VM. A certificate from your own CA works today, with nothing to exchange in the middle.

**Google Cloud.** Careful here. A Compute Engine VM can get a Google-signed identity token, and Google is built into AWS as an identity provider, so GCP already has a keyless path. If you take it, `accounts.google.com:aud` maps to the token's `azp` claim when there is one, and `accounts.google.com:oaud` maps to `aud`. Decode a token before writing the policy. Roles Anywhere on GCP is a consistency choice, not a necessity.

**Azure itself.** It earns its place when the security team wants machine identity owned through PKI, or the credential bound to hardware rather than to whatever can reach the identity endpoint. That only holds with the vTPM setup. A certificate read from Key Vault inherits the managed identity's trust boundary.

That is the real case for it. Federation is the right answer per platform, where the platform supports it. Roles Anywhere is the one answer that works across all of them, including places with no identity provider at all. With a data centre and two or three clouds, one trust anchor and one revocation story is far easier to audit, and to explain to your security team, than a federation setup per platform.

The catch: you are running a CA for real now. Protecting its key, issuing short-lived certificates, keeping revocation working. If nobody owns that today, federate where you can and bring in Roles Anywhere where federation cannot reach.

---

The rule underneath both is simple. Nothing long-lived crosses the cloud boundary. CI uses OIDC, people use IAM Identity Center, and workloads use a federated token or a certificate.

The access key in Key Vault was never a security control. It was a key with better storage.
