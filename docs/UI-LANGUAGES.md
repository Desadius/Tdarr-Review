# Review interface languages

The **1.10.2** source includes English and Czech. Choose **English** or **Čeština** in the header. The choice is saved in this browser. You can also open `http://YOUR_SERVER:8270/?lang=en` or `?lang=cs`; an explicit URL choice takes precedence over the saved preference. Czech remains the initial default.

Navigation, dialogs, confirmations, recovery status, comparison controls, warnings and known server messages use the selected language. The five-step review, inline checkboxes, start/middle/end saves, external player/device fields, HDR confirmation and saved/deferred status are included. Numbers and dates use the corresponding locale.

Switching language reloads the page. Server-saved review progress remains bound to the same file snapshot and review revision. The browser can restore its current-tab unsaved draft when that server revision still matches; it does not turn a draft into approved evidence. An unfinished rejection or replacement reason also survives a language switch within the same browser tab. Use **Save draft review** before leaving the tab if you want durable progress.

Movie titles, release names, paths, IDs, configured installation names, user-entered notes/reasons/devices and unknown technical logs retain their original text. The interface language does not change Radarr's Czech/English audio preference, checklist requirements, snapshot/revision checks or file operations. Changing the actual review method or device has its normal confirmation-reset effect; changing language does not.

The release source has been prepared and tested, including reopening saved review progress in the UI. Registry image publication uses the repository's separate release workflow; an older installed image does not acquire the English interface or new review workspace merely by opening `?lang=en`.
