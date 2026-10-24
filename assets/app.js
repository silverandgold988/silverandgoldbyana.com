/* Silver & Gold by Ana — catálogo dinámico.
   Lee catalog/manifest.json (lo regenera el script de sincronización con Canva)
   y construye las secciones. No hace falta tocar el HTML cuando cambia el catálogo. */
(function () {
  const $ = (s, r = document) => r.querySelector(s);
  const el = (tag, attrs = {}, children = []) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') n.className = v;
      else if (k === 'html') n.innerHTML = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v);
    }
    for (const c of [].concat(children)) if (c != null) n.append(c);
    return n;
  };

    let manifest = null;
  let lb = { cat: null, idx: 0 };

  function waLink(phone, text) {
    return `https://wa.me/${phone}?text=${encodeURIComponent(text)}`;
  }

  function setWhatsApp(b) {
    const generic = waLink(b.whatsapp, `Hola Ana 👋 vi tu catálogo en la página y quiero información.`);
    ['navWa', 'heroWa', 'howWa', 'footWa', 'floatWa'].forEach(id => { const a = $('#' + id); if (a) a.href = generic; });
  }

  function visiblePages(cat) {
    return cat.skip_first_page ? cat.pages.slice(1) : cat.pages;
  }

  function src(p) { return 'catalog/' + p; }
  function thumb(cat, p) { return cat.thumbs ? src(p.replace(/\/([^/]+)$/, '/thumbs/$1')) : src(p); }

  function buildCategories(cats) {
    const wrap = $('#categorias');
    cats.forEach(cat => {
      const cover = visiblePages(cat)[0];
      wrap.append(el('a', { class: 'cat', href: '#cat-' + cat.id }, [
        el('div', { class: 'cat-img' }, el('img', { src: thumb(cat, cover), alt: cat.title, loading: 'lazy' })),
        el('b', {}, cat.title),
        el('small', {}, 'Ver catálogo →')
      ]));
    });
  }

  function buildCatalogs(cats) {
    const list = $('#catalogList');
    cats.forEach(cat => {
      const pages = visiblePages(cat);
      const grid = el('div', { class: 'pages collapsed' + (cat.orientation === 'landscape' ? ' landscape' : '') });
      const ar = cat.orientation === 'landscape' ? '1.414' : '0.707';
      pages.forEach((p, i) => {
        const card = el('div', { class: 'page', onclick: () => openLb(cat, i) }, [
          el('img', { src: thumb(cat, p), alt: `${cat.title} – página ${i + 1}`, loading: 'lazy', style: `--ar:${ar}` }),
          el('span', { class: 'pg' }, `PÁG. ${String(i + 1).padStart(2, '0')}`)
        ]);
        grid.append(card);
      });

      const head = el('div', { class: 'catalog-head' }, [
        el('div', {}, [
          el('h3', {}, 'Catálogo ' + cat.title),
          cat.subtitle ? el('p', { class: 'sub' }, cat.subtitle) : null,
          cat.note ? el('p', { class: 'note' }, cat.note) : null
        ]),
        el('div', { class: 'catalog-tools' }, [
          cat.price ? el('span', { class: 'price-tag' }, cat.price) : null,
          el('a', { class: 'btn btn-sm', href: waLink(manifest.brand.whatsapp, `Hola Ana 👋 me interesa el catálogo de ${cat.title}.`), target: '_blank', rel: 'noopener' }, 'Preguntar')
        ])
      ]);

      const section = el('section', { class: 'catalog', id: 'cat-' + cat.id }, [head, grid]);

      if (pages.length > 4) {
        const more = el('button', { class: 'btn btn-ghost more' }, `Ver las ${pages.length} páginas`);
        more.addEventListener('click', () => { grid.classList.remove('collapsed'); more.remove(); });
        section.append(more);
      }
      list.append(section);
    });
  }

  function fillHero(cats) {
    const picks = [];
    cats.forEach(c => { const v = visiblePages(c); if (v[0]) picks.push(thumb(c, v[0])); });
    ['heroImg1', 'heroImg2', 'heroImg3'].forEach((id, i) => { const img = $('#' + id); if (img && picks[i]) img.src = picks[i]; });
    const story = $('#storyImg');
    const alo = cats.find(c => c.id === 'alo') || cats[0];
    if (story && alo) story.src = thumb(alo, visiblePages(alo)[0]);
  }

  /* Lightbox */
  function openLb(cat, idx) {
    lb = { cat, idx };
    renderLb();
    $('#lightbox').hidden = false;
    document.body.style.overflow = 'hidden';
  }
  function closeLb() { $('#lightbox').hidden = true; document.body.style.overflow = ''; }
  function renderLb() {
    const pages = visiblePages(lb.cat);
    const p = pages[lb.idx];
    $('#lbImg').src = src(p);
    $('#lbImg').alt = `${lb.cat.title} – página ${lb.idx + 1}`;
    $('#lbCaption').textContent = `${lb.cat.title} · página ${lb.idx + 1} de ${pages.length}`;
    $('#lbWa').href = waLink(manifest.brand.whatsapp, `Hola Ana 👋 me interesa un modelo del catálogo de ${lb.cat.title}, página ${lb.idx + 1}. El número es: `);
    // precarga vecinos
    [lb.idx + 1, lb.idx - 1].forEach(i => { if (pages[i]) { const im = new Image(); im.src = src(pages[i]); } });
  }
  function step(d) {
    const n = visiblePages(lb.cat).length;
    lb.idx = (lb.idx + d + n) % n;
    renderLb();
  }

  $('#lbClose').addEventListener('click', closeLb);
  $('#lbPrev').addEventListener('click', () => step(-1));
  $('#lbNext').addEventListener('click', () => step(1));
  $('#lightbox').addEventListener('click', e => { if (e.target.id === 'lightbox') closeLb(); });
  document.addEventListener('keydown', e => {
    if ($('#lightbox').hidden) return;
    if (e.key === 'Escape') closeLb();
    if (e.key === 'ArrowRight') step(1);
    if (e.key === 'ArrowLeft') step(-1);
  });
  // swipe en móvil
  let tx = null;
  $('#lightbox').addEventListener('touchstart', e => { tx = e.touches[0].clientX; }, { passive: true });
  $('#lightbox').addEventListener('touchend', e => {
    if (tx == null) return;
    const dx = e.changedTouches[0].clientX - tx;
    if (Math.abs(dx) > 50) step(dx < 0 ? 1 : -1);
    tx = null;
  });

  /* Menú móvil */
  $('#burger').addEventListener('click', () => $('#navLinks').classList.toggle('open'));
  $('#navLinks').addEventListener('click', e => { if (e.target.tagName === 'A') $('#navLinks').classList.remove('open'); });

  $('#year').textContent = new Date().getFullYear();

  function init(m) {
      manifest = m;
      setWhatsApp(m.brand);
      buildCategories(m.catalogs);
      buildCatalogs(m.catalogs);
      fillHero(m.catalogs);
      if (m.updated) {
        const d = new Date(m.updated);
        $('#updatedLabel').textContent = 'Catálogo actualizado el ' + d.toLocaleDateString('es-US', { day: 'numeric', month: 'long', year: 'numeric' });
      }
  }

  fetch('catalog/manifest.json', { cache: 'no-cache' })
    .then(r => { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then(init)
    .catch(err => {
      // Sin servidor (abrir el archivo directamente) usamos la copia embebida en catalog/manifest.js
      if (window.CATALOG_MANIFEST) { init(window.CATALOG_MANIFEST); return; }
      console.error(err);
      $('#catalogList').innerHTML = '<p class="center muted">No pudimos cargar el catálogo. Escríbenos por WhatsApp y te lo enviamos.</p>';
    });
})();
