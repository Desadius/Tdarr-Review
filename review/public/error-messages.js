// Stable API error codes with their Czech and English text, shared by the server
// (which also sends the Czech text as `error` for older clients) and the browser UI.
// Add a code here instead of a new literal message in a route.
export const ERROR_MESSAGES=Object.freeze({
 host_forbidden:Object.freeze({cs:"Nepovolená adresa serveru.",en:"Server address not allowed."}),
 origin_forbidden:Object.freeze({cs:"Nepovolený původ požadavku.",en:"Request origin not allowed."}),
 json_required:Object.freeze({cs:"Vyžadován JSON.",en:"JSON required."}),
 login_rate_limited:Object.freeze({cs:"Zkus přihlášení za minutu.",en:"Try signing in again in a minute."}),
 access_key_invalid:Object.freeze({cs:"Nesprávný přístupový klíč.",en:"Incorrect access key."}),
 login_required:Object.freeze({cs:"Přihlas se přístupovým klíčem.",en:"Sign in with the access key."}),
 not_found:Object.freeze({cs:"Nenalezeno.",en:"Not found."}),
 file_not_found:Object.freeze({cs:"Soubor nenalezen.",en:"File not found."}),
 poster_unavailable:Object.freeze({cs:"Plakát není dostupný.",en:"Poster unavailable."}),
 busy:Object.freeze({cs:"Právě probíhá jiná akce.",en:"Another operation is in progress."}),
 busy_retry:Object.freeze({cs:"Právě probíhá jiná akce. Zkus to za chvíli.",en:"Another operation is in progress. Try again shortly."}),
 busy_action_or_batch:Object.freeze({cs:"Jiná akce nebo dávka právě probíhá.",en:"Another operation or batch is running."}),
 busy_action:Object.freeze({cs:"Jiná akce právě probíhá.",en:"Another operation is in progress."}),
 finish_action_or_recovery:Object.freeze({cs:"Nejprve dokonči probíhající akci nebo obnovu.",en:"Finish the active operation or recovery first."}),
 finish_actions_preview_recovery:Object.freeze({cs:"Nejprve dokonči probíhající akce, náhled nebo obnovu.",en:"Finish active operations, previews or recovery first."}),
 settings_changing:Object.freeze({cs:"Probíhá změna nastavení.",en:"Settings are being changed."}),
 settings_changed:Object.freeze({cs:"Nastavení se mezitím změnilo. Otevři ho znovu.",en:"Settings have changed. Open them again."}),
 item_changed:Object.freeze({cs:"Položka se změnila. Obnov přehled.",en:"The item has changed. Refresh the overview."}),
 files_changed:Object.freeze({cs:"Obnov přehled, soubory se změnily.",en:"Refresh the overview; the files have changed."}),
 recheck_unsafe:Object.freeze({cs:"Tuto změnu nelze bezpečně znovu ověřit. Obnov přehled.",en:"This change cannot be safely rechecked. Refresh the overview."}),
 item_unmapped:Object.freeze({cs:"Soubor nelze bezpečně přiřadit k originálu.",en:"The file cannot be safely matched to the original."}),
 batch_item_changed:Object.freeze({cs:"Některý vybraný film se změnil nebo ho nelze schválit. Obnov přehled.",en:"A selected movie has changed or cannot be approved. Refresh the overview."}),
 batch_size:Object.freeze({cs:"Vyber 1 až 100 filmů.",en:"Select 1 to 100 movies."}),
 batch_duplicate:Object.freeze({cs:"Stejný film je v dávce vícekrát.",en:"The batch contains the same movie more than once."}),
 restore_confirm_required:Object.freeze({cs:"Potvrď obnovení zachovaných kopií.",en:"Confirm restoration of the retained copies."}),
 sample_mode_invalid:Object.freeze({cs:"Neplatný typ ukázky.",en:"Invalid sample type."}),
 sample_profile_invalid:Object.freeze({cs:"Neplatný profil videonáhledu.",en:"Invalid video preview profile."}),
 sample_cache_request_invalid:Object.freeze({cs:"Neplatný požadavek cache.",en:"Invalid cache request."}),
 sample_tracks_invalid:Object.freeze({cs:"Vyber platné zvukové stopy.",en:"Select valid audio tracks."}),
 frame_time_out_of_range:Object.freeze({cs:"Čas je mimo délku filmu.",en:"The time is outside the movie duration."}),
 sample_time_out_of_range:Object.freeze({cs:"Vyber úsek alespoň 12 sekund před koncem filmu.",en:"Choose a segment starting at least 12 seconds before the movie ends."}),
});

// Text for an error code in the given language, or null for an unknown code.
// {name} placeholders are filled from params.
export function errorText(code,params={},language='cs'){
 const message=Object.hasOwn(ERROR_MESSAGES,code)?ERROR_MESSAGES[code]:null;
 if(!message)return null;
 return (message[language]||message.cs).replace(/\{(\w+)\}/g,(_,name)=>String(params?.[name]??''));
}
