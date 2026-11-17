// API mínima para las propuestas de Marketing (Cloudflare Pages Functions + KV).
// Necesita dos cosas configuradas en el proyecto de Pages:
//   - un KV namespace enlazado con el nombre PROPUESTAS
//   - (opcional) una variable de entorno EDIT_KEY con otra clave del equipo
// Sin eso responde 501 y la página sigue funcionando con los links largos.
const SLUG = /^[a-z0-9][a-z0-9-]{0,79}$/;
const SID = /^[a-z0-9][a-z0-9-]{0,79}:\d{10,16}$/;
const MAX = 60000, MAXT = 900000;
const RID = /^[pq][a-z0-9]{6,40}$/;
// Huella de la clave del equipo (la misma que comprueba la página al ingresar).
const TEAM = '2cd1b03e7960f799d111619341c978ac090e036b65659f7513fec3dbb6bd7f1d';
async function sha(t) { const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t)); return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join(''); }
const num = v => { const n = Number(v); return isFinite(n) ? Math.round(n) : 0; };
function meta(o, extra) {
  const m = o || {};
  return Object.assign({ cliente: cut(m.cliente, 60), evento: cut(m.evento, 80), total: cut(m.total, 30), tn: num(m.tn), gn: num(m.gn), n: num(m.n), ai: (Array.isArray(m.ai) ? m.ai : []).slice(0, 40).map(x => cut(x, 14)) }, extra);
}
const J = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
const cut = (v, n = 120) => String(v == null ? '' : v).slice(0, n);

export async function onRequest({ request, env }) {
  const url = new URL(request.url);
  const seg = url.pathname.replace(/^\/api\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  const m = request.method;
  const kv = env.PROPUESTAS, key = env.EDIT_KEY;
  if (seg[0] === 'status') return J({ ok: true, ready: !!(kv && key), kv: !!kv });
  if (!kv) return J({ error: 'no_configurado' }, 501);
  const hk = request.headers.get('x-edit-key') || '';
  const auth = !!hk && ((!!key && hk === key) || (await sha(hk)) === TEAM);
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
    // --- Propuestas realizadas / pagas (panel de Marketing) y solicitudes de productores
    if (seg[0] === 'props' && m === 'GET') {
      if (!auth) return J({ error: 'clave_incorrecta' }, 401);
      const out = []; let cursor;
      do { const l = await kv.list({ prefix: 'r:', limit: 1000, cursor }); l.keys.forEach(k => out.push(Object.assign({ id: k.name.slice(2) }, k.metadata || {}))); cursor = l.list_complete ? null : l.cursor; } while (cursor);
      return J({ items: out });
    }
    if (seg[0] === 'req' && seg.length === 2 && m === 'POST') {
      const id = seg[1];
      if (!/^q[a-z0-9]{6,40}$/.test(id)) return J({ error: 'nombre_invalido' }, 400);
      const body = await request.text();
      if (body.length > MAX) return J({ error: 'muy_grande' }, 413);
      let o; try { o = JSON.parse(body); } catch (e) { return J({ error: 'json_invalido' }, 400); }
      const c = o.contact || {}, at = Date.now();
      const contact = { name: cut(c.name, 60), phone: cut(c.phone, 30), email: cut(c.email, 80) };
      await kv.put('r:' + id, JSON.stringify({ st: o.st || {}, contact, at }), { metadata: meta(o.meta, { at, paid: true, paidAt: at, src: 'prod', via: cut(o.via, 12), cn: contact.name, cp: contact.phone, ce: contact.email }) });
      return J({ ok: true });
    }
    if (seg[0] === 'r' && seg.length >= 2) {
      if (!auth) return J({ error: 'clave_incorrecta' }, 401);
      const id = seg[1];
      if (!RID.test(id)) return J({ error: 'nombre_invalido' }, 400);
      if (seg.length === 3 && seg[2] === 'paid' && m === 'POST') {
        const cur = await kv.getWithMetadata('r:' + id);
        if (!cur.value) return J({ error: 'no_encontrada' }, 404);
        let o = {}; try { o = JSON.parse(await request.text()); } catch (e) {}
        const md = Object.assign({}, cur.metadata || {}, { paid: !!o.paid, paidAt: o.paid ? Date.now() : 0 });
        await kv.put('r:' + id, cur.value, { metadata: md });
        return J({ ok: true });
      }
      if (seg.length === 2 && m === 'GET') {
        const v = await kv.get('r:' + id);
        return v ? new Response(v, { headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } }) : J({ error: 'no_encontrada' }, 404);
      }
      if (seg.length === 2 && m === 'PUT') {
        const body = await request.text();
        if (body.length > MAXT) return J({ error: 'muy_grande' }, 413);
        let o; try { o = JSON.parse(body); } catch (e) { return J({ error: 'json_invalido' }, 400); }
        const cur = await kv.getWithMetadata('r:' + id), pm = cur.metadata || {}, at = Date.now();
        await kv.put('r:' + id, JSON.stringify({ st: o.st || {}, at }), { metadata: meta(o.meta, { at, paid: !!pm.paid, paidAt: pm.paidAt || 0, src: pm.src || 'mkt' }) });
        return J({ ok: true });
      }
      if (seg.length === 2 && m === 'DELETE') { await kv.delete('r:' + id); return J({ ok: true }); }
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
