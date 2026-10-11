# Custom Function examples

Paste the respective CommonJS function body into a Tdarr Custom Function node. These files are examples, not a complete exported flow. See [flow placement](../../docs/TDARR-INTEGRATION.md).

Edit the constants in **both** functions:

| Code value | Replace with |
| --- | --- |
| `/media/movies/` | Source root as seen by the Tdarr server; mapped-node translation must correspond |
| `/pilot-review/PROD-Movies/` | Final result directory as seen by a Linux node |
| `//UNRAID/tdarr-review-output/PROD-Movies/` | Final SMB result directory as seen by a Windows node |
| `http://YOUR_UNRAID_IP:8266` | Tdarr API origin reachable by both nodes |
| `YOUR_TDARR_LIBRARY_ID` | Actual production library ID |
| `['','media','movies',''].join('/')` | Components of the server database root, with leading/trailing empty components |

The root built from components is deliberately distinct from translatable path literals. Change its components if your server root differs. Configure Tdarr path translators consistently and test both platforms before enabling production work.

Guard output **1** continues to your encoder flow. Output **2** ends processing because an unchanged matching successful result is already waiting in Review. Other cases throw visible errors; do not route errors to an overwrite branch.

Receipt has one normal output. Place it after the result has arrived at the final Review directory and before the successful flow ends. It writes only the accompanying identity receipt. The actual encoder/health-check/output-copy steps remain your responsibility.
