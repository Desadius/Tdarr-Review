# Recovery runs as a process inside the Review container

Users install only Review; Recovery ships in the same image and runs as a supervised child process, Off by default and enabled through an explicit Recovery mode. We rejected letting Review pull and start a separate Recovery container, because that needs the Docker socket, which is effectively root over the whole host and contradicts the read-only, `cap_drop ALL` isolation an application that replaces original media must keep. The separate `tdarr-recovery` image is discontinued in the release that consolidates them, with a migration guide.

## Consequences

- Recovery shares the container's lifecycle: stopping or updating Review interrupts an in-progress original decode. This is safe because an interrupted or timed-out decode is never treated as proof of corruption, and the case is retried; Review warns in the UI while Recovery is mid-case.
- A Recovery crash must not stop Review; the supervisor restarts it with backoff. A Review crash stops the container and Recovery receives SIGTERM.
- The `RECOVERY_MODE` environment variable (`off`, `verify`, `repair`; default `off`) is the only source of truth for the Recovery mode, visible in the Unraid template. A conflicting `enabled` left in Recovery's `config.json` refuses start (fail closed). Only the supervisor applies the default: with `off` it never starts the worker, and the worker itself refuses a missing mode instead of assuming one.
- Recovery problems never make the container unhealthy; they are reported as health attention and in the UI, so an auto-restart policy cannot interrupt Review because of an optional part.
- Container resource limits now cover both processes (2 CPUs, 2 GB, 256 PIDs).
- Both processes run as the same UID, so the former container boundary (Recovery's read-only `/review`, separate `/data`) is gone and cannot be restored without capabilities. We accept this; a regression test instead pins the paths Recovery may write (`/data/recovery/`, the media status file, quarantine and library operations it already performs).
- Migration copies the old Recovery data into `/data/recovery/` and removes the old Recovery container, so two Recovery instances never act on one library; the old data directory is deleted only after the new version is verified. The change is released as 2.0.0 because Compose users lose the `recovery` service and image.
- Existing installations keep their frozen Recovery paths by adding a `/storage` mapping to the same host folder instead of rewriting approval evidence; new installations use `/media`.
