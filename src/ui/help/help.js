const knownPages = new Set(['getting-started','workspaces','companies','joining-a-company','security-mfa',
  'cases-and-data','exports','engineering-guides','troubleshooting']);
const node = (tag, text, className) => {
  const value = document.createElement(tag);
  if (text !== undefined) value.textContent = text;
  if (className) value.className = className;
  return value;
};

function appendInline(parent, source) {
  const pattern = /(`[^`]+`|\[[^\]]+\]\([^\s)]+\))/g;
  let at = 0;
  for (const match of source.matchAll(pattern)) {
    parent.append(document.createTextNode(source.slice(at, match.index)));
    const token = match[0];
    if (token.startsWith('`')) parent.append(node('code', token.slice(1, -1)));
    else {
      const parts = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      try {
        const url = new URL(parts[2], location.origin);
        if (!['http:', 'https:'].includes(url.protocol)) throw new Error('unsafe');
        const link = node('a', parts[1]); link.href = url.href;
        if (url.origin !== location.origin) { link.target = '_blank'; link.rel = 'noopener noreferrer'; }
        parent.append(link);
      } catch { parent.append(document.createTextNode(parts[1])); }
    }
    at = match.index + token.length;
  }
  parent.append(document.createTextNode(source.slice(at)));
}

export function renderMarkdown(source, target) {
  const fragment = document.createDocumentFragment();
  let list, listType, codeBlock, paragraph;
  const flushParagraph = () => { if (paragraph) { fragment.append(paragraph); paragraph = undefined; } };
  const flushList = () => { if (list) { fragment.append(list); list = undefined; listType = undefined; } };
  for (const raw of String(source).replaceAll('\r\n', '\n').split('\n')) {
    if (raw.startsWith('```')) {
      flushParagraph(); flushList();
      if (codeBlock) { fragment.append(codeBlock); codeBlock = undefined; }
      else { codeBlock = node('pre'); codeBlock.append(node('code')); }
      continue;
    }
    if (codeBlock) { codeBlock.firstChild.append(document.createTextNode(`${raw}\n`)); continue; }
    const heading = raw.match(/^(#{2,3})\s+(.+)$/);
    if (heading) { flushParagraph(); flushList(); const h = node(`h${heading[1].length}`); appendInline(h, heading[2]); fragment.append(h); continue; }
    const item = raw.match(/^\s*(-|\d+\.)\s+(.+)$/);
    if (item) {
      flushParagraph(); const wanted = item[1] === '-' ? 'ul' : 'ol';
      if (listType !== wanted) { flushList(); list = node(wanted); listType = wanted; }
      const li = node('li'); appendInline(li, item[2]); list.append(li); continue;
    }
    if (raw.startsWith('> ')) { flushParagraph(); flushList(); const quote = node('blockquote'); appendInline(quote, raw.slice(2)); fragment.append(quote); continue; }
    if (!raw.trim()) { flushParagraph(); flushList(); continue; }
    flushList();
    if (!paragraph) paragraph = node('p'); else paragraph.append(document.createTextNode(' '));
    appendInline(paragraph, raw.trim());
  }
  flushParagraph(); flushList(); if (codeBlock) fragment.append(codeBlock);
  target.replaceChildren(fragment);
}

async function managedPage() {
  const target = document.querySelector('[data-help-body]');
  if (!target) return;
  const declared = target.dataset.helpSlug;
  const slug = declared === 'query' ? new URLSearchParams(location.search).get('slug') : declared;
  if (!slug || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) return;
  try {
    const response = await fetch(`/api/help/page?slug=${encodeURIComponent(slug)}`, { cache: 'no-store' });
    if (!response.ok) return;
    const { page } = await response.json();
    document.title = `${page.title} · WellSim Help`;
    const title = document.querySelector('h1'); if (title) title.textContent = page.title;
    const summary = document.querySelector('[data-help-summary]'); if (summary) summary.textContent = page.summary;
    renderMarkdown(page.bodyMarkdown, target);
    const updated = document.querySelector('[data-help-updated]');
    if (updated) updated.textContent = `Published revision ${page.revision} · ${new Date(page.updatedAt).toLocaleDateString()}`;
  } catch { /* Static help remains complete when the optional CMS is unavailable. */ }
}

async function managedCatalog() {
  const target = document.getElementById('managed-pages');
  if (!target) return;
  try {
    const response = await fetch('/api/help/catalog', { cache: 'no-store' });
    if (!response.ok) return;
    const { pages } = await response.json();
    for (const page of pages) {
      const existing = document.querySelector(`[data-help-card="${CSS.escape(page.slug)}"]`);
      if (existing) {
        existing.querySelector('h2').textContent = page.title;
        existing.querySelector('p').textContent = page.summary;
      } else {
        const link = node('a', undefined, 'card');
        link.href = knownPages.has(page.slug) ? `/help/${page.slug}.html` : `/help/article.html?slug=${encodeURIComponent(page.slug)}`;
        link.append(node('h2', page.title), node('p', page.summary)); target.append(link); target.hidden = false;
      }
    }
  } catch { /* Keep the static catalog. */ }
}

managedPage();
managedCatalog();
