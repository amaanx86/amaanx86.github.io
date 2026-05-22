---
title: "I Got Tired of Passing --profile on Every OCI CLI Command"
description: "ocswitch is a small shell script that manages multiple OCI profiles and persists the active one across all terminal sessions. No more --profile flags, no more editing config files."
date: 2026-05-22
tags: ["oracle-cloud", "shell", "cli", "infrastructure", "tools"]
draft: false
---

This is a problem you only run into if you work for Oracle directly or you work at a Cloud/DevOps MSP managing OCI for multiple clients. Most people will never touch it. If you are reading this, you are probably not most people.

The OCI CLI already demands a `--compartment-id` on almost every command. Compartment IDs are long, they are not memorable, and you need a different one depending on what you are looking at. That was already a nightmare before you add multiple tenancies to the picture. Once you are juggling prod, staging, dev, and a handful of client accounts, passing `--profile` on top of `--compartment-id` on every single command becomes the kind of friction that breaks you.

So I wrote `ocswitch`.

## What the OCI CLI Actually Gives You

The OCI CLI reads config from `~/.oci/config` by default. You can point it at a different file with `OCI_CONFIG_FILE`, and select a named profile within that file with `OCI_CLI_PROFILE`. That is the full surface area you have to work with.

The multi-profile story in the official tooling is basically: put multiple `[PROFILE_NAME]` sections in one config file and pass `--profile PROFILE_NAME` every time. If you forget the flag, you hit whichever profile is in `[DEFAULT]`. This works but it is tedious, and it is session-scoped - export the env var in one terminal, open another, you are back to default.

`ocswitch` fixes the persistence problem by writing the active profile to `~/.oci/active_profile` and restoring it at shell startup.

## How It Works

Profiles are separate config files in `~/.oci/`:

```
~/.oci/config_prod
~/.oci/config_staging
~/.oci/config_dev
```

One file per tenancy, named `config_<profile>`. When you switch:

```bash
ocswitch prod
```

Two things happen: `~/.oci/active_profile` gets written with the string `prod`, and `OCI_CONFIG_FILE` plus `OCI_CLI_PROFILE` are exported in the current shell. Every `oci` command you run after that hits the prod tenancy.

The persistence part lives at the top of the script, outside the function, so it runs every time the shell sources the file:

```bash
_oci_state="${HOME}/.oci/active_profile"
if [[ -f "$_oci_state" ]]; then
  _oci_profile=$(cat "$_oci_state")
  _oci_cfg="${HOME}/.oci/config_${_oci_profile}"
  if [[ -f "$_oci_cfg" ]]; then
    export OCI_CONFIG_FILE="$_oci_cfg"
    export OCI_CLI_PROFILE="config_${_oci_profile}"
  fi
fi
```

Open a new terminal, source kicks in, reads the state file, exports the right vars. The active profile follows you across sessions without any extra steps.

## What It Looks Like

![ocswitch terminal output](https://gist.github.com/user-attachments/assets/fb92f9b5-f513-43a5-b4d8-8f172ce6b457)

`ocswitch list` shows all detected profiles (anything matching `~/.oci/config_*`) with the active one highlighted in Oracle red. `ocswitch clear` removes the state file and unsets both env vars.

Tab completion is included for both bash and zsh. Hit tab after `ocswitch` and you get `list`, `clear`, and all your profile names.

## The ocid Bonus

There is a second function in the script: `ocid`. It reads the active config, pulls the tenancy OCID and user OCID out of it, and calls the OCI IAM API to resolve the human-readable names:

```
Tenant Name: mycompany-production
Tenant ID:   ocid1.tenancy.oc1..aaaa...
User Email:  user@example.com
```

Useful when you have switched between a few profiles and want to confirm exactly which tenancy you are currently pointing at before running something destructive.

## Install

**zsh**
```zsh
curl -fsSL https://gist.githubusercontent.com/amaanx86/2621a181e2f4b572a1904d65748d66bd/raw/ocswitch.zsh \
  -o ~/.oci/ocswitch.zsh
echo 'source ~/.oci/ocswitch.zsh' >> ~/.zshrc
source ~/.zshrc
```

**bash**
```sh
curl -fsSL https://gist.githubusercontent.com/amaanx86/2621a181e2f4b572a1904d65748d66bd/raw/ocswitch.bash \
  -o ~/.oci/ocswitch.bash
echo 'source ~/.oci/ocswitch.bash' >> ~/.bashrc
source ~/.bashrc
```

## Usage

```
ocswitch               # show help + logo
ocswitch list          # list profiles (active highlighted)
ocswitch <profile>     # switch profile (persists across all terminals)
ocswitch clear         # clear active profile
```

## Profile Setup

Each profile is a standard OCI config file at `~/.oci/config_<profile>`. The section header inside the file uses the same name as the file itself, not `[DEFAULT]`:

```ini
[config_prod]
user=ocid1.user.oc1..aaaa...
fingerprint=xx:xx:xx:...
tenancy=ocid1.tenancy.oc1..aaaa...
region=us-ashburn-1
key_file=~/.oci/oci_api_key.pem
```

So `~/.oci/config_staging` has `[config_staging]` inside, `~/.oci/config_dev` has `[config_dev]`, and so on.

---

The full source is in [this gist](https://gist.github.com/amaanx86/2621a181e2f4b572a1904d65748d66bd). Two files, one for bash and one for zsh, no external dependencies beyond the OCI CLI itself.
