// Small shared helpers: JSON responses and ids.

export const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });

/** `code` is stable and translated by the client; `error` is English for a log or curl. */
export const fail = (code, status, error) => json({ code, error }, status);

export async function readJson(request) {
  if (!request.headers.get('content-type')?.includes('application/json')) return {};
  try { return await request.json(); } catch { return {}; }
}

export const uuid = () => crypto.randomUUID();

export const randomToken = (bytes = 24) =>
  btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(bytes))))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
