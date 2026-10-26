'use strict';
const STATUSES = ['success', 'limited', 'failure', 'unknown', 'skipped'];
const EXIT = Object.freeze({ OK: 0, ARGUMENT: 2, FAILED: 3, INTERRUPTED: 130 });
function state(status, code, reason, details = {}) {
  if (!STATUSES.includes(status)) throw new Error(`Invalid status: ${status}`);
  return { ...details, status, code, reason, checked_at: new Date().toISOString() };
}
function websiteState(kind) {
  return kind === 'reachable' ? 'success' : ['partial','login','challenge','captcha','restricted','region','rate-limit','redirect'].includes(kind) ? 'limited'
    : ['network','http-error'].includes(kind) ? 'failure' : 'unknown';
}
module.exports = { STATUSES, EXIT, state, websiteState };
