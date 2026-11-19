// A lane keeps API, assets, windows and WebSockets under one public origin.
export const channel = location.pathname.match(/^\/(main|dev|nightly)(?:\/|$)/)?.[1] || '';
export const basePath = channel ? '/' + channel : '';
export const localUrl = (url: string) => basePath + url;
export const localFetch = (url: string, init?: RequestInit) => fetch(localUrl(url), init);
export const entryUrl = () => new URL(basePath + '/', location.origin);
