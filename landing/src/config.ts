/**
 * Where the landing page hands off to the live twin.
 *
 * Not hardcoded: the twin runs on a different origin to this page (its own static
 * server, see ../tools/serve.py), so a literal localhost URL would break the moment
 * this site is built for anywhere but a developer's own machine. Set VITE_TWIN_URL
 * per environment; the default matches the twin's local dev port.
 */
export const TWIN_URL = import.meta.env.VITE_TWIN_URL ?? 'http://localhost:8000'

export const GITHUB_URL = 'https://github.com/shreyascoder2006/72_UI'
