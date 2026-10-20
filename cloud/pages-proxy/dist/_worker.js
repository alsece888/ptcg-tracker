export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (!pathname.startsWith('/api/')) return new Response('Not found', { status: 404 });
    return env.BRIDGE_SERVICE.fetch(request);
  },
};
