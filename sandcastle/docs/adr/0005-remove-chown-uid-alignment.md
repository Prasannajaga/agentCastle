# Remove runtime chown, align UIDs via namespace mapping and build-time convention

Both sandbox providers used `chown -R /home/agent` at container startup to fix ownership mismatches between bind-mounted files (host UID) and image-built files (UID 1000). This was slow, produced log spam from walking into bind mounts, and hit permission errors on read-only mounts (VirtioFS `.git/objects`, custom read-only mounts). We removed it entirely.

**Podman** now uses `--userns=keep-id:uid=N,gid=N` (Podman 4.1+), which maps the host user to a fixed UID inside the container at the namespace level. Both bind-mounted and image-built files appear owned by the same UID with no file mutation. The `containerUid`/`containerGid` options (default 1000) must match the Containerfile's agent user UID.

**Docker** drops the chown and keeps only `--user ${hostUid}:${hostGid}`. This relies on the host UID matching the image UID (common on Linux where both are 1000) or on Docker Desktop's VirtioFS layer handling permission translation (macOS/Windows). If image-file permission errors resurface, the planned fix is a build-time UID injection via `build-image` (passing `--build-arg AGENT_UID=$(id -u)`) rather than runtime chown.

## Considered options

- **Targeted non-recursive chown** (chown specific dirs, skip bind mounts) — still requires knowing which paths are mounts vs image-local, still has startup cost, still produces warnings on read-only mounts.
- **Build-time UID injection** (pass host UID as build-arg, create agent user with that UID) — eliminates chown but requires Dockerfile changes for existing users. Reserved as a future escape hatch for Docker if `--user` alone proves insufficient.
- **fixuid / entrypoint script** (runtime `/etc/passwd` mutation + chown) — industry-standard approach (used by devcontainers, fixuid) but still chowns at startup. Solves the identity problem but not the performance/log-spam problem.
- **User namespace remapping** (Docker daemon-level `--userns-remap`) — not per-container, requires daemon config changes. Not practical.

## Consequences

- Requires Podman 4.1+ (for `--userns=keep-id:uid=N,gid=N` syntax).
- If a user's Containerfile creates the agent user at a UID other than 1000, they must pass `containerUid`/`containerGid` to `podman()` — otherwise ownership breaks silently.
- Docker users on Linux with a non-1000 host UID may hit image-file permission errors. This is a rare edge case; if it surfaces, the build-time UID injection fix can be added without changing the runtime path.
