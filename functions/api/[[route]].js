// API mínima para las propuestas de Marketing (Cloudflare Pages Functions + KV).
// Necesita dos cosas configuradas en el proyecto de Pages:
//   - un KV namespace enlazado con el nombre PROPUESTAS
//   - una variable de entorno EDIT_KEY con la clave del equipo
// Sin eso responde 501 y la página sigue funcionando con los links largos.
const SLUG = /^[a-z0-9][a-z0-9-]{0,79}$/;
const SID = /^[a-z0-9][a-z0-9-]{0,79}:\d{10,16}$/;
const MAX = 60000;
const J = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
const cut = (v, n = 120) => String(v == null ? '' : v).slice(0, n);

export async function onRequest({ request, env }) {
  const url = new URL(request.url);
  const seg = url.pathname.replace(/^\/api\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  const m = request.method;
  const kv = env.PROPUESTAS, key = env.EDIT_KEY;
  if (seg[0] === 'status') return J({ ok: true, ready: !!(kv && key) });
  if (!kv || !key) return J({ error: 'no_configurado' }, 501);
  const auth = request.headers.get('x-edit-key') === key;
  try {
    if (seg[0] === 'p' && seg.length === 2) {
      const slug = seg[1];
      if (!SLUG.test(slug)) return J({ error: 'nombre_invalido' }, 400);
      if (m === 'GET') {
        const v = await kv.get('p:' + slug);
        return v ? new Response(v, { headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } }) : J({ error: 'no_encontrada' }, 404);
      }
      if (m === 'PUT') {
        if (!auth) return J({ error: 'clave_incorrecta' }, 401);
        const body = await request.text();
        if (body.length > MAX) return J({ error: 'muy_grande' }, 413);
        let o; try { o = JSON.parse(body); } catch (e) { return J({ error: 'json_invalido' }, 400); }
        await kv.put('p:' + slug, body, { metadata: { evento: cut(o.evento), cliente: cut(o.cliente), total: cut(o._total, 60), at: Date.now() } });
        return J({ ok: true, slug });
      }
      if (m === 'DELETE') {
        if (!auth) return J({ error: 'clave_incorrecta' }, 401);
        await kv.delete('p:' + slug);
        return J({ ok: true });
      }
    }
    if (seg[0] === 's' && seg.length === 2) {
      if (m === 'POST') {
        const slug = seg[1];
        if (!SLUG.test(slug)) return J({ error: 'nombre_invalido' }, 400);
        if (!(await kv.get('p:' + slug))) return J({ error: 'no_encontrada' }, 404);
        const body = await request.text();
        if (body.length > MAX) return J({ error: 'muy_grande' }, 413);
        let o; try { o = JSON.parse(body); } catch (e) { return J({ error: 'json_invalido' }, 400); }
        const c = o.contact || {}, at = Date.now(), id = slug + ':' + at;
        await kv.put('s:' + id, JSON.stringify({ state: o.state || {}, contact: { name: cut(c.name), event: cut(c.event), phone: cut(c.phone, 40), email: cut(c.email) }, via: cut(o.via, 20), total: cut(o.total, 60), at }),
          { metadata: { slug, at, name: cut(c.name, 80), event: cut(c.event, 100), phone: cut(c.phone, 40), email: cut(c.email, 100), via: cut(o.via, 20), total: cut(o.total, 60) } });
        return J({ ok: true });
      }
      if (m === 'GET') {
        if (!auth) return J({ error: 'clave_incorrecta' }, 401);
        if (!SID.test(seg[1])) return J({ error: 'nombre_invalido' }, 400);
        const v = await kv.get('s:' + seg[1]);
        return v ? new Response(v, { headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } }) : J({ error: 'no_encontrada' }, 404);
      }
    }
    if (seg[0] === 'list' && m === 'GET') {
      if (!auth) return J({ error: 'clave_incorrecta' }, 401);
      const p = await kv.list({ prefix: 'p:', limit: 1000 }), s = await kv.list({ prefix: 's:', limit: 1000 });
      return J({
        proposals: p.keys.map(k => Object.assign({ slug: k.name.slice(2) }, k.metadata || {})),
        requests: s.keys.map(k => Object.assign({ id: k.name.slice(2) }, k.metadata || {}))
      });
    }
  } catch (e) {
    return J({ error: 'error_interno' }, 500);
  }
  return J({ error: 'no_encontrado' }, 404);
}
