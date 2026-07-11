/**
 * Cross-browser API shim (Chrome/Edge/Brave + Firefox).
 */
const browserAPI = typeof browser !== 'undefined' ? browser : chrome;
