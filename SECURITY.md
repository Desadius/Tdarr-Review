# Security

Keep the application on a trusted network. The current authentication/origin checks are intended for the documented LAN installation; the project has not undergone an independent security audit for public exposure.

Never commit `/data`, access keys, Radarr API keys, SSH material, movie files, private repair approvals or transaction journals. Configuration samples use placeholders. Docker examples do not mount the Docker socket and give only the required application/media paths.

The application can replace/delete media after approval and manage recorded quarantine. Review access is therefore privileged access to those mapped files. Limit access to the UI and host data directory, keep backups, and retain incomplete transaction evidence.

For a suspected vulnerability, contact the repository owner privately through a channel they publish. Do not post working credentials or exploit details involving a live personal installation in public issues. No private reporting channel has been configured by this initial publication.
