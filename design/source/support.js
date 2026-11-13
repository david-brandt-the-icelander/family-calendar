// Minimal stand-in for the Design canvas runtime, enough to render these mockups in a plain browser.
(function () {
  class DCLogic { constructor(props) { this.props = props || {}; this.state = {}; }
    setState(p) { Object.assign(this.state, typeof p === 'function' ? p(this.state) : p); window.__dcRender(); } forceUpdate() { window.__dcRender(); } }
  window.DCLogic = DCLogic;
  const get = (scope, path) => path.trim().split('.').reduce((o, k) => (o == null ? undefined : o[k]), scope);
  const lit = (p, scope) => { p = p.trim(); if (p === 'true') return true; if (p === 'false') return false; return get(scope, p); };
  const whole = /^\{\{([^}]+)\}\}$/;
  const interp = (s, scope) => s.replace(/\{\{([^}]+)\}\}/g, (_, p) => { const v = lit(p, scope); return v == null ? '' : String(v); });
  function render(node, scope, out) {
    if (node.nodeType === 3) { out.appendChild(document.createTextNode(interp(node.nodeValue, scope))); return; }
    if (node.nodeType !== 1) return;
    const tag = node.tagName.toLowerCase();
    if (tag === 'sc-for') {
      const list = lit(node.getAttribute('list').match(whole)[1], scope) || []; const as = node.getAttribute('as');
      list.forEach((item, i) => node.childNodes.forEach((c) => render(c, { ...scope, [as]: item, $index: i }, out))); return;
    }
    if (tag === 'sc-if') { if (lit(node.getAttribute('value').match(whole)[1], scope)) node.childNodes.forEach((c) => render(c, scope, out)); return; }
    const el = document.createElementNS(node.namespaceURI, node.tagName.toLowerCase() === node.tagName ? node.tagName : tag);
    for (const a of node.attributes) {
      if (a.name.startsWith('hint-')) continue;
      const m = a.value.match(whole);
      if (m && a.name.startsWith('on')) { const fn = lit(m[1], scope); if (fn) el.addEventListener(a.name.slice(2).toLowerCase(), fn); continue; }
      const v = m ? lit(m[1], scope) : interp(a.value, scope);
      if (v === false || v == null || ((a.name === 'checked' || a.name === 'disabled') && (v === 'false'))) continue;
      el.setAttribute(a.name, v === true ? '' : v);
    }
    const kids = node.content ? node.content.childNodes : node.childNodes;
    kids.forEach((c) => render(c, scope, el));
    if (tag === 'input' && node.hasAttribute('value')) el.value = el.getAttribute('value');
    out.appendChild(el);
  }
  document.addEventListener('DOMContentLoaded', () => {
    const x = document.querySelector('x-dc'); const helmet = x.querySelector('helmet');
    if (helmet) { [...helmet.children].forEach((c) => document.head.appendChild(c)); helmet.remove(); }
    const tpl = x.cloneNode(true); x.remove();
    const src = document.querySelector('script[data-dc-script]').textContent;
    const Component = new Function('DCLogic', src + '\nreturn Component;')(DCLogic);
    const inst = new Component({}); const host = document.createElement('div'); document.body.prepend(host);
    window.__dcRender = () => { const frag = document.createDocumentFragment(); tpl.childNodes.forEach((c) => render(c, inst.renderVals(), frag)); host.replaceChildren(frag); };
    window.__dcRender();
  });
})();
