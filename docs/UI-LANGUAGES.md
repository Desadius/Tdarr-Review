# Review interface languages

Choose **English** or **Čeština** in the language menu in the header. The choice is saved in this browser. You can also open `http://YOUR_SERVER:8270/?lang=en` or `?lang=cs`; an explicit URL choice takes precedence over the saved preference. Czech remains the initial default.

Navigation, dialogs, confirmations, recovery status, comparison controls, warnings and known server messages use the selected language. Numbers and dates use the corresponding locale. An unfinished rejection or replacement reason survives a language switch within the same browser tab.

Movie titles, release names, paths, IDs, configured installation names, user-entered reasons and unknown technical logs retain their original text. The interface language does not change Radarr's Czech/English audio preference, approval rules, snapshot checks or file operations.

The English interface is included in the 1.10.2 source. Publishing a registry image uses the repository's separate manual release workflow.
