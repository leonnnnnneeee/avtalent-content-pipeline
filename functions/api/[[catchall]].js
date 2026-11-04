export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  // Default backend target URL (fallback to live Railway instance)
  const backendTarget = env.BACKEND_API_URL || 'https://avtalent-content-pipeline-production.up.railway.app';
  const targetUrl = new URL(url.pathname + url.search, backendTarget);

  const forwardHeaders = new Headers(request.headers);
  forwardHeaders.set('host', targetUrl.host);

  const clientIp = request.headers.get('cf-connecting-ip');
  if (clientIp) {
    forwardHeaders.set('x-forwarded-for', clientIp);
  }

  try {
    const isBodyAllowed = request.method !== 'GET' && request.method !== 'HEAD';
    const init = {
      method: request.method,
      headers: forwardHeaders,
      body: isBodyAllowed ? request.body : undefined,
      redirect: 'manual'
    };

    const backendResponse = await fetch(targetUrl.toString(), init);

    const responseHeaders = new Headers(backendResponse.headers);
    responseHeaders.set('Access-Control-Allow-Origin', '*');
    responseHeaders.set('Access-Control-Allow-Headers', 'content-type, authorization');
    responseHeaders.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: responseHeaders, status: 204 });
    }

    return new Response(backendResponse.body, {
      status: backendResponse.status,
      statusText: backendResponse.statusText,
      headers: responseHeaders
    });
  } catch (error) {
    return new Response(JSON.stringify({
      ok: false,
      error: 'Gateway error connecting to backend: ' + error.message,
      target: targetUrl.toString()
    }), {
      status: 502,
      headers: {
        'content-type': 'application/json'
      }
    });
  }
}
