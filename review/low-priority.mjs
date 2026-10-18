// Background work runs at the lowest best-effort I/O priority (7) and CPU niceness 19, so reviewing stays responsive.
/** @type {readonly string[]} */
export const LOW_PRIORITY=Object.freeze(['/usr/bin/ionice','-c','2','-n','7','/usr/bin/nice','-n','19']);

/**
 * The command and arguments that run exe, lowered when requested.
 * @param {string} exe @param {string[]} args @param {boolean} lower
 * @returns {[string,string[]]}
 */
export function lowPriorityCommand(exe,args,lower){return lower?[LOW_PRIORITY[0],[...LOW_PRIORITY.slice(1),exe,...args]]:[exe,args];}
