# Cloud Desktop

Lightweight browser gateway for this machine’s Debian XFCE session. It is a small stand-in for Apache Guacamole: HTML5 client, encrypted session tokens, and `guacd` talking RDP to local `xrdp`.

```
Browser  --WebSocket-->  Node gateway (guacamole-lite)  --TCP-->  guacd  --RDP-->  xrdp :3389
```

## Start

```bash
./scripts/start.sh
```

Then open:

- `http://127.0.0.1:9080`
- `http://<host-ip>:9080`
- `https://<host-ip>:9443` (self-signed certificate)

Sign in with the same Linux username and password that `xrdp` already accepts.

Stop with `./scripts/stop.sh`. Status and recent logs: `./scripts/status.sh`.

## Configuration

Copy `.env.example` to `.env` (the start script does this). Useful values:

| Variable | Purpose |
| --- | --- |
| `WEB_PORT` | Published HTTP port (default `9080`) |
| `GATE_PASSWORD` | Extra password required before an RDP session is created |
| `RDP_USERNAME` | Prefills the login form |
| `RDP_SECURITY` | `any` (default), `rdp`, or `tls` if the session fails to negotiate |
| `DESKTOP_NAME` | Label shown in the UI |

`TOKEN_KEY` is generated automatically. Do not commit `.env`.

TLS certificates live in `certs/` and are generated on first start. Replace them with a real certificate if you have one (`certs/cert.pem` and `certs/key.pem`).

## Requirements

- Docker with Compose
- Host `xrdp` listening on port 3389 (already enabled on this Debian desktop)
