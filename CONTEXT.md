# Tdarr Review

Tdarr Review lets a person inspect and explicitly approve Tdarr transcodes before the original film files in a media library are replaced, and optionally repairs corrupted originals.

## Language

**Review**:
The product a user installs, and its web application where a person compares a Tdarr result with its original and decides about it.
_Avoid_: Review container (once Recovery ships inside it)

**Recovery**:
The optional, opt-in part of Review that automatically repairs a confirmed corrupted original through Radarr (verification, Tdarr hold, quarantine, re-download).
_Avoid_: recovery worker container, tdarr-recovery (as a separate product), repair

**Recovery mode**:
One of three explicitly chosen states of Recovery: **Off** (does not run; the default), **Verify** (confirms corrupted originals but changes nothing outside itself) or **Repair** (may act on a confirmed corruption).
_Avoid_: enabled/disabled, dry run

**Transaction recovery**:
Completing or rolling back an interrupted replacement after a restart, from its durable journal. A different concept from Recovery; never shorten it to "recovery".
_Avoid_: recovery
