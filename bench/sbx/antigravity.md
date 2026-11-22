# Antigravity ACP in Docker Sandboxes

This offline preflight exercises Google's Linux ARM64 client on a new profile. It sends ACP `initialize` followed by `session/new`. Both calls precede a model turn. The client has no credentials, API key, host account directory, MCP servers or terminal supplied by the ACP client. SBX denies egress. The guest sets the Antigravity upstream to the closed loopback endpoint `http://127.0.0.1:1` and disables telemetry and default customizations.

## Reproduce

Use a registered scratch directory on the development volume for the archive. On 22 November 2026 the installer linked by Google selected the following glibc release for Linux ARM64. The publisher supplies the archive SHA-512 over HTTPS. The executable SHA-256 below was measured independently by reading its single regular tar member. [Google installer](https://antigravity.google/cli/install.sh) · [Google's release manifest](https://antigravity-cli-auto-updater-974169037036.us-central1.run.app/manifests/linux_arm64.json) · [Google Storage release](https://storage.googleapis.com/antigravity-public/antigravity-cli/1.5.14-5302690847260672/linux-arm/cli_linux_arm64.tar.gz)

| Item               | Pinned value                                                                                                                       |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| Client             | `1.5.14`, `linux_arm64`                                                                                                            |
| Archive bytes      | 92,116,379                                                                                                                         |
| Archive SHA-512    | `c9b29bba475f63a1a80161ae93ba72b221c7a586d9851e4d0061546704bab66d6b2760b25d716d191724fc7564f3246456ee151e28aa37af48dbcd72bdc6c463` |
| Executable         | `antigravity`, 256,070,320 bytes                                                                                                   |
| Executable SHA-256 | `702b888abddc7d482ee30592fa153cda5785afae3188179d38b511b6ec360286`                                                                 |

```sh
curl --fail --location --proto '=https' --proto-redir '=https' \
  --output "$SCRATCH/cli_linux_arm64.tar.gz" \
  https://storage.googleapis.com/antigravity-public/antigravity-cli/1.5.14-5302690847260672/linux-arm/cli_linux_arm64.tar.gz
./aos -- node bench/sbx/agy.mjs "$SCRATCH/cli_linux_arm64.tar.gz" 180000
```

The timeout in milliseconds bounds this local experiment. The runner verifies the publisher's archive digest before creating a VM and again inside the guest before extraction. The guest runs the verified executable at UID 65534 with an empty home, a private temporary directory and a disposable working directory. Authentication methods advertised by ACP describe what a client can negotiate. Google documents that the authenticated path reuses a native sign-in. Proving the personal subscription, served model or token usage requires a separate authorized exchange. [Antigravity ACP](https://antigravity.google/docs/cli/acp) · [ACP initialization](https://agentclientprotocol.com/protocol/v1/initialization)

## Verification on 22 November 2026

The admitted Linux ARM64 client returned ACP protocol version 1 and identified itself as Antigravity ACP Server 1.5.14, running as UID 65534. It advertised personal OAuth, business OAuth, an API key and the agent platform. The subsequent unauthenticated `session/new` returned error `-32000`. The host wrote the receipt, disposed of the VM and returned exit **1** for the refused session. The probe sent no model prompt. A host-mediated subscription turn still requires evidence of a supported authorization path.
