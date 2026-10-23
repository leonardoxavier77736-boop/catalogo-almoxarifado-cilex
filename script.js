(() => {
  'use strict';

  const CONFIG = {
    API_URL: 'https://script.google.com/macros/s/AKfycbwiWoLsxOemc1dtwOwsn5YdPdU11Mp8YZMjFjRKh0ms1eNlkIFSUyzc9y-zkhiCxyUq/exec',
    PIN_CORRETO: '8486',
    BATCH_SIZE: 50,
    MAX_IMAGE_DIMENSION: 1600,
    IMAGE_JPEG_QUALITY: 0.9,
    STORAGE_CACHE_KEY: 'catalogo_estoque_api_cache_v28', 
    THEME_STORAGE_KEY: 'catalogo_estoque_theme',
    IMAGE_EXTENSIONS: ['jpg', 'png', 'jpeg', 'webp', 'jfif', 'avif', 'gif'],
    SCROLL_STEP: 260
  };

  const state = {
    allItems: [], filteredItems: [], displayedCount: 0, families: [], selectedFamily: 'TODOS',
    searchQuery: '', currentTheme: 'light', isLoading: false
  };

  // Função para ignorar acentos, cedilhas e maiúsculas/minúsculas
function removerAcentos(texto) {
  if (!texto) return '';
  return texto.toString()
              .normalize('NFD') // Separa as letras dos seus acentos
              .replace(/[\u0300-\u036f]/g, '') // Remove os acentos separados
              .toLowerCase(); // Transforma tudo em minúsculas
}

  const DOM = {
    html: document.documentElement,
    searchInput: document.getElementById('search-input'), searchClearBtn: document.getElementById('search-clear-btn'),
    btnSyncApi: document.getElementById('btn-sync-api'), themeToggleBtn: document.getElementById('theme-toggle-btn'),
    themeIcon: document.getElementById('theme-icon'), itemsCounter: document.getElementById('items-counter'),
    filterCategories: document.getElementById('filter-categories'), btnScrollLeft: document.getElementById('btn-scroll-left'),
    btnScrollRight: document.getElementById('btn-scroll-right'), productsGrid: document.getElementById('products-grid'),
    scrollSentinel: document.getElementById('infinite-scroll-sentinel'), loadingState: document.getElementById('loading-state'),
    emptyState: document.getElementById('empty-state'), toast: document.getElementById('toast-notification')
  };

  function normalizeString(str) { return str ? String(str).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim() : ''; }
  function showToast(msg, dur = 3500) { DOM.toast.textContent = msg; DOM.toast.classList.add('show'); clearTimeout(DOM.toast._t); DOM.toast._t = setTimeout(() => DOM.toast.classList.remove('show'), dur); }
  function escapeHtml(str) { return str ? String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;') : ''; }

  // DETECTOR DE SCROLL ESTÁVEL (COM TRAVA ANTIBUG PARA O PC)
  let lastScrollY = window.scrollY;
  let scrollLocked = false;

  window.addEventListener('scroll', () => {
    if (scrollLocked) return;
    const currentScrollY = window.scrollY;
    const diff = currentScrollY - lastScrollY;

    if (Math.abs(diff) > 8) {
      if (currentScrollY > 40 && diff > 0) {
        document.body.classList.add('scrolled-down');
        scrollLocked = true;
        setTimeout(() => { scrollLocked = false; }, 300);
      } else if (diff < 0 || currentScrollY <= 15) {
        document.body.classList.remove('scrolled-down');
        scrollLocked = true;
        setTimeout(() => { scrollLocked = false; }, 300);
      }
      lastScrollY = currentScrollY;
    }
  }, { passive: true });

  function initTheme() {
    const saved = localStorage.getItem(CONFIG.THEME_STORAGE_KEY);
    const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    applyTheme(saved ? saved : (prefersDark ? 'dark' : 'light'));
    DOM.themeToggleBtn.addEventListener('click', () => applyTheme(state.currentTheme === 'dark' ? 'light' : 'dark'));
  }
  function applyTheme(theme) {
    state.currentTheme = theme;
    if (theme === 'dark') { DOM.html.setAttribute('data-theme', 'dark'); DOM.html.classList.add('dark-mode'); DOM.themeIcon.textContent = '☀️'; } 
    else { DOM.html.removeAttribute('data-theme'); DOM.html.classList.remove('dark-mode'); DOM.themeIcon.textContent = '🌙'; }
    localStorage.setItem(CONFIG.THEME_STORAGE_KEY, theme);
  }

  function showLoading(show) { 
    DOM.loadingState.style.display = show ? 'block' : 'none'; 
    if(show) {
      DOM.productsGrid.style.display = 'none'; 
      DOM.emptyState.style.display = 'none';
    } else {
      DOM.productsGrid.style.display = 'grid'; 
    }
  }

  // NOVA FUNÇÃO DE BUSCA (COM FORÇAR ATUALIZAÇÃO)
  async function fetchCatalogFromApi(forceRefresh = false) {
    let hasCache = false;
    
    // Se não for uma atualização forçada, tenta usar a memória (cache)
    if (!forceRefresh) {
      try {
        const cached = localStorage.getItem(CONFIG.STORAGE_CACHE_KEY);
        if (cached) { processRawItems(JSON.parse(cached)); showLoading(false); hasCache = true; }
      } catch(e){}
    }

    // Se não tem cache ou se o utilizador clicou no botão para forçar
    if (!hasCache || forceRefresh) {
      showLoading(true);
    }

    try {
      const res = await fetch(`${CONFIG.API_URL}?t=${new Date().getTime()}`, { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        if (data && data.length) {
          localStorage.setItem(CONFIG.STORAGE_CACHE_KEY, JSON.stringify(data));
          processRawItems(data); 
        }
      }
    } catch (e) { console.warn('Conexão instável. A manter os dados locais.'); } 
    finally { showLoading(false); }
  }

  // BOTÃO DE ATUALIZAR AGORA FORÇA A LIMPEZA DA MEMÓRIA
  DOM.btnSyncApi.onclick = () => { 
    showToast('A atualizar os dados...'); 
    localStorage.removeItem(CONFIG.STORAGE_CACHE_KEY); 
    fetchCatalogFromApi(true); // O true força o download de novos dados!
  };

  function processRawItems(raw) {
    state.allItems = raw.map((i, idx) => ({
      id: idx,
      codigo: String(i.codigo || i.CÓDIGO || '').trim(),
      familia: String(i.familia || 'GERAL').trim(),
      descricao: String(i.descricao || '').trim(),
      unidade: String(i.unidade || 'UN').trim(),
      localizacao: String(i.localizacao || '-').trim(),

      // FOTO 1
      foto: String(i.foto || '').trim(),

      // FOTO 2
      foto2: String(i.foto2 || '').trim(),

      searchIndex: normalizeString(
        `${i.codigo} ${i.descricao} ${i.familia} ${i.localizacao}`
      )
    })).filter(i => i.codigo || i.descricao);

    extractFamilies();
    renderCategories();
    applyFilters();
  }

  function extractFamilies() {
    const s = new Set(); state.allItems.forEach(i => { if (i.familia) s.add(i.familia); });
    state.families = Array.from(s).sort();
  }

  function updateCarouselArrows() {
    const scrollLeft = DOM.filterCategories.scrollLeft;
    const maxScroll = Math.max(0, DOM.filterCategories.scrollWidth - DOM.filterCategories.clientWidth);
    if (scrollLeft <= 2) { DOM.btnScrollLeft.style.opacity = '0'; DOM.btnScrollLeft.style.pointerEvents = 'none'; } 
    else { DOM.btnScrollLeft.style.opacity = '1'; DOM.btnScrollLeft.style.pointerEvents = 'auto'; }
    if (scrollLeft >= maxScroll - 2) { DOM.btnScrollRight.style.opacity = '0'; DOM.btnScrollRight.style.pointerEvents = 'none'; } 
    else { DOM.btnScrollRight.style.opacity = '1'; DOM.btnScrollRight.style.pointerEvents = 'auto'; }
  }
  DOM.filterCategories.addEventListener('scroll', updateCarouselArrows);
  window.addEventListener('resize', updateCarouselArrows);

  function renderCategories() {
    DOM.filterCategories.innerHTML = '';
    const btnTodos = document.createElement('button');
    btnTodos.className = `filter-btn ${state.selectedFamily === 'TODOS' ? 'active' : ''}`;
    btnTodos.textContent = 'TODOS';
    btnTodos.onclick = () => { 
      state.selectedFamily = 'TODOS'; 
      renderCategories(); 
      applyFilters(); 
      window.scrollTo({ top: 0, behavior: 'smooth' }); 
    };
    DOM.filterCategories.appendChild(btnTodos);

    state.families.forEach(f => {
      const b = document.createElement('button'); 
      b.className = `filter-btn ${state.selectedFamily === f ? 'active' : ''}`;
      b.textContent = f; 
      b.dataset.family = f; 
      b.onclick = () => { 
        state.selectedFamily = f; 
        renderCategories(); 
        applyFilters(); 
        window.scrollTo({ top: 0, behavior: 'smooth' }); 
      };
      DOM.filterCategories.appendChild(b);
    });
    setTimeout(updateCarouselArrows, 100);
  }

  DOM.btnScrollLeft.onclick = () => DOM.filterCategories.scrollBy({ left: -CONFIG.SCROLL_STEP, behavior: 'smooth' });
  DOM.btnScrollRight.onclick = () => DOM.filterCategories.scrollBy({ left: CONFIG.SCROLL_STEP, behavior: 'smooth' });

  let searchTimeout;
  DOM.searchInput.addEventListener('input', (e) => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => { 
      state.searchQuery = e.target.value; 
      DOM.searchClearBtn.style.display = state.searchQuery ? 'block' : 'none'; 
      applyFilters(); 
      window.scrollTo({ top: 0, behavior: 'smooth' }); 
    }, 150);
  });
  DOM.searchClearBtn.onclick = () => { DOM.searchInput.value = ''; state.searchQuery = ''; DOM.searchClearBtn.style.display = 'none'; applyFilters(); window.scrollTo({ top: 0, behavior: 'smooth' }); };

  function applyFilters() {
    const terms = state.searchQuery.trim().split(/\s+/).filter(Boolean).map(normalizeString);
    state.filteredItems = state.allItems.filter(i => {
      if (state.selectedFamily !== 'TODOS' && i.familia !== state.selectedFamily) return false;
      if (terms.length > 0 && !terms.every(t => i.searchIndex.includes(t))) return false;
      return true;
    });
    state.displayedCount = 0; DOM.productsGrid.innerHTML = '';
    if (state.filteredItems.length === 0) { DOM.emptyState.style.display = 'block'; DOM.scrollSentinel.style.display = 'none'; } 
    else { DOM.emptyState.style.display = 'none'; renderBatch(); }
    updateCounter();
  }

  function renderBatch() {
    const max = Math.min(state.displayedCount + CONFIG.BATCH_SIZE, state.filteredItems.length);
    if (state.displayedCount >= max) return;
    const frag = document.createDocumentFragment();
    for (let i = state.displayedCount; i < max; i++) { frag.appendChild(createCard(state.filteredItems[i])); }
    DOM.productsGrid.appendChild(frag); state.displayedCount = max;
    DOM.scrollSentinel.style.display = max < state.filteredItems.length ? 'block' : 'none';
    updateCounter();
  }

  DOM.scrollSentinel.onclick = renderBatch;
  new IntersectionObserver((e) => { if(e[0].isIntersecting) renderBatch(); }, { rootMargin: '300px' }).observe(DOM.scrollSentinel);

  function updateCounter() {
    DOM.itemsCounter.innerHTML = `<span class="counter-num">${state.displayedCount}</span> / ${state.filteredItems.length}`;
  }

  function createCard(item) {
    const card = document.createElement('article'); 
    card.className = 'product-card'; 
    card.dataset.codigo = item.codigo;
    
    // Recuperamos a leitura da foto da sua API!
    const hasPhotoData = Boolean(item.foto);
    const imgSrc1 = hasPhotoData ? item.foto : `${encodeURIComponent(item.codigo)}.${CONFIG.IMAGE_EXTENSIONS[0]}`;
    
    // A foto 2 tentará ler um item.foto2 (se existir) ou fará a busca pelo nome _2
    const imgSrc2 = item.foto2 ? item.foto2 : `${encodeURIComponent(item.codigo)}_2.${CONFIG.IMAGE_EXTENSIONS[0]}`;

    card.dataset.hasPhoto1 = Boolean(imgSrc1) && hasPhotoData ? 'true' : 'false';
    card.dataset.hasPhoto2 = Boolean(item.foto2) ? 'true' : 'false'; 

    card.innerHTML = `
      <div class="card-media-wrapper" style="position:relative; cursor:pointer;" title="Clique para alternar as fotos">
        <div class="image-placeholder"><div class="spinner-small"></div></div>
        
        <!-- Imagem 1 (Padrão - Restabelecida) -->
        <img class="card-image img-1" src="${imgSrc1}" alt="${escapeHtml(item.descricao)}" style="opacity: 0;" data-ext-index="0" data-has-api="${hasPhotoData}">
        
        <!-- Imagem 2 (Detalhe com _2 no nome) -->
        <img class="card-image img-2" src="${imgSrc2}" alt="${escapeHtml(item.descricao)} (Detalhe)" style="display: none; opacity: 0;" data-ext-index="0">
        
        <!-- Bolinhas indicadoras (estilo Instagram) -->
        <div class="photo-dots" style="display:none; position:absolute; bottom:8px; left:50%; transform:translateX(-50%); gap:6px; z-index:10;">
           <div class="dot dot-1" style="width:8px; height:8px; border-radius:50%; background:#ffffff; box-shadow:0 0 4px rgba(0,0,0,0.6);"></div>
           <div class="dot dot-2" style="width:8px; height:8px; border-radius:50%; background:rgba(255,255,255,0.4); box-shadow:0 0 4px rgba(0,0,0,0.6);"></div>
        </div>
      </div>
      
      <div class="card-body">
        <div class="card-badges"><span class="badge badge-family">${escapeHtml(item.familia)}</span><span class="badge badge-um">${escapeHtml(item.unidade)}</span></div>
        <h3 class="card-title-desc" title="${escapeHtml(item.descricao)}">${escapeHtml(item.descricao)}</h3>
        <div class="card-metadata">
          <div class="meta-box meta-box-codigo">Cód: ${escapeHtml(item.codigo)}</div>
          <div class="meta-box meta-box-local">📍 ${escapeHtml(item.localizacao)}</div>
        </div>
        
        <div class="card-actions-container" style="display:flex; gap:8px; width:100%;"></div>
      </div>
    `;

    const img1 = card.querySelector('.img-1');
    const img2 = card.querySelector('.img-2');
    const placeholder = card.querySelector('.image-placeholder');
    const wrapper = card.querySelector('.card-media-wrapper');
    const dots = card.querySelector('.photo-dots');
    const dot1 = card.querySelector('.dot-1');
    const dot2 = card.querySelector('.dot-2');
    const containerBtn = card.querySelector('.card-actions-container');

    card.updateVisibility = function() {
      const h1 = card.dataset.hasPhoto1 === 'true';
      const h2 = card.dataset.hasPhoto2 === 'true';
      
      if (h1 && h2) { dots.style.display = 'flex'; } else { dots.style.display = 'none'; }

      if (!h1 && !h2) {
          img1.style.display = 'none'; img2.style.display = 'none'; placeholder.style.display = 'flex';
          placeholder.innerHTML = `<div style="display:flex; flex-direction:column; align-items:center; gap:8px; color:var(--text-muted);"><svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg><span style="font-size: 0.8rem; font-weight: 600;">Sem foto</span></div>`;
      } else {
          placeholder.style.display = 'none';
          if (h1 && !h2) { img1.style.display = 'block'; img2.style.display = 'none'; }
          if (!h1 && h2) { img1.style.display = 'none'; img2.style.display = 'block'; }
      }

      if (!h1 && !h2) {
          containerBtn.innerHTML = `<button type="button" class="whatsapp-action-btn btn-p1">📸 Adicionar Foto</button>`;
      } else if (h1 && !h2) {
          containerBtn.innerHTML = `
              <button type="button" class="whatsapp-action-btn btn-p1" style="flex:1; font-size:0.85rem;">📸 Alterar 1</button>
              <button type="button" class="whatsapp-action-btn btn-p2" style="flex:1; font-size:0.85rem; background-color:#3b82f6;">📸 Add 2</button>
          `;
      } else if (!h1 && h2) {
          containerBtn.innerHTML = `
              <button type="button" class="whatsapp-action-btn btn-p1" style="flex:1; font-size:0.85rem; background-color:#3b82f6;">📸 Add 1</button>
              <button type="button" class="whatsapp-action-btn btn-p2" style="flex:1; font-size:0.85rem;">📸 Alterar 2</button>
          `;
      } else {
          containerBtn.innerHTML = `
              <button type="button" class="whatsapp-action-btn btn-p1" style="flex:1; font-size:0.85rem;">📸 Alterar 1</button>
              <button type="button" class="whatsapp-action-btn btn-p2" style="flex:1; font-size:0.85rem;">📸 Alterar 2</button>
          `;
      }

      const b1 = containerBtn.querySelector('.btn-p1'); if (b1) b1.onclick = (e) => { e.stopPropagation(); handleUpload(item, card, b1, 1); };
      const b2 = containerBtn.querySelector('.btn-p2'); if (b2) b2.onclick = (e) => { e.stopPropagation(); handleUpload(item, card, b2, 2); };
    };

    wrapper.onclick = () => {
       if (card.dataset.hasPhoto1 === 'true' && card.dataset.hasPhoto2 === 'true') {
           if (img1.style.display !== 'none') {
               img1.style.display = 'none'; img2.style.display = 'block';
               dot1.style.background = 'rgba(255,255,255,0.4)'; dot2.style.background = '#ffffff';
           } else {
               img1.style.display = 'block'; img2.style.display = 'none';
               dot1.style.background = '#ffffff'; dot2.style.background = 'rgba(255,255,255,0.4)';
           }
       }
    };

    // Lógica resiliente restaurada para a Foto 1
    img1.onload = () => { img1.style.opacity = '1'; img1.style.display = 'block'; card.dataset.hasPhoto1 = 'true'; card.updateVisibility(); };
    img1.onerror = () => {
      if (img1.dataset.hasApi === 'true') { 
          img1.dataset.hasApi = 'false'; img1.dataset.extIndex = '0'; 
          img1.src = `${encodeURIComponent(item.codigo)}.${CONFIG.IMAGE_EXTENSIONS[0]}`; 
          return; 
      }
      let extIdx = parseInt(img1.dataset.extIndex) + 1;
      if (extIdx < CONFIG.IMAGE_EXTENSIONS.length) { 
        img1.dataset.extIndex = extIdx; img1.src = `${encodeURIComponent(item.codigo)}.${CONFIG.IMAGE_EXTENSIONS[extIdx]}`; 
      } else { card.dataset.hasPhoto1 = 'false'; card.updateVisibility(); }
    };

    img2.onload = () => { img2.style.opacity = '1'; card.dataset.hasPhoto2 = 'true'; card.updateVisibility(); };
    img2.onerror = () => {
      let extIdx = parseInt(img2.dataset.extIndex) + 1;
      if (extIdx < CONFIG.IMAGE_EXTENSIONS.length) { 
        img2.dataset.extIndex = extIdx; img2.src = `${encodeURIComponent(item.codigo)}_2.${CONFIG.IMAGE_EXTENSIONS[extIdx]}`; 
      } else { card.dataset.hasPhoto2 = 'false'; card.updateVisibility(); }
    };

    card.updateVisibility();
    return card;
  }

 // NOVA FUNÇÃO DE UPLOAD - BLINDADA CONTRA BLOQUEIO DA XIAOMI/IPHONE
  function handleUpload(item, card, btn, photoIndex) {
    // 1. Cria o input e adiciona-o ao site (escondido) para a Xiaomi não bloquear
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = 'image/*';
    inp.style.display = 'none';
    document.body.appendChild(inp);

    // 2. Quando a foto for tirada/escolhida, isto acontece:
    inp.onchange = () => {
      const file = inp.files[0];
      document.body.removeChild(inp); // Limpa o código escondido
      if (!file) return; // Se a pessoa cancelar a câmara, não faz nada

      // 3. AGORA SIM, com a foto na mão, pedimos a senha para enviar!
      const pin = prompt('🔒 Digite a senha para AUTORIZAR o envio desta foto:');
      if (pin === null) return;
      if (pin.trim() !== CONFIG.PIN_CORRETO) {
        return alert('Senha incorreta! Envio cancelado.');
      }

      // Se a senha estiver certa, começa a enviar...
      const originalHTML = btn.innerHTML;
      btn.disabled = true; btn.innerHTML = `⏳ <span>A enviar...</span>`;
      document.getElementById('cloud-upload-overlay').classList.add('active');
      document.getElementById('cloud-upload-desc').textContent = `A enviar foto ${photoIndex} de ${item.codigo}...`;

      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = async () => {
          let w = img.width, h = img.height;
          if (w > h && w > CONFIG.MAX_IMAGE_DIMENSION) { h = Math.round((h * CONFIG.MAX_IMAGE_DIMENSION) / w); w = CONFIG.MAX_IMAGE_DIMENSION; }
          else if (h > CONFIG.MAX_IMAGE_DIMENSION) { w = Math.round((w * CONFIG.MAX_IMAGE_DIMENSION) / h); h = CONFIG.MAX_IMAGE_DIMENSION; }
          const cvs = document.createElement('canvas'); cvs.width = w; cvs.height = h;
          const ctx = cvs.getContext('2d'); ctx.fillStyle = '#FFF'; ctx.fillRect(0,0,w,h); ctx.drawImage(img, 0,0,w,h);
          const b64 = cvs.toDataURL('image/jpeg', CONFIG.IMAGE_JPEG_QUALITY);

          // O Truque da Foto 1 e Foto 2
          // Enviamos sempre o código limpo (ex: 402040270566) para passar na validação da planilha
          const codigoEnvio = item.codigo; 

          try {
            const res = await fetch(CONFIG.API_URL, { 
              method: 'POST', 
              body: JSON.stringify({ 
                codigo: codigoEnvio, 
                foto: b64,
                indice: photoIndex // Informa se é a foto 1 ou 2
              }) 
            });
            const result = await res.json();
            if (res.ok && (result.status === 'sucesso' || result.result === 'sucesso')) {
              const targetImg = card.querySelector('.img-' + photoIndex);
              targetImg.src = b64; 
              targetImg.dataset.extIndex = 0; 
              if (photoIndex === 1) { 
                item.foto = b64;
                card.dataset.hasPhoto1 = 'true'; 
              } else { 
                item.foto2 = b64;
                card.dataset.hasPhoto2 = 'true'; 
              }
              
              if(card.updateVisibility) card.updateVisibility();
              showToast('Foto ' + photoIndex + ' guardada com sucesso!');
            } else { 
              alert('Falha ao guardar: ' + JSON.stringify(result)); 
            }
          } catch (err) { 
            alert('Erro de ligação: ' + err.message); 
          }
          
          document.getElementById('cloud-upload-overlay').classList.remove('active');
          btn.disabled = false; btn.innerHTML = originalHTML;
        };
        img.src = e.target.result;
      };
      reader.readAsDataURL(file);
    };

    // 4. DISPARA A AÇÃO IMEDIATAMENTE AO CLICAR! 
    // Sem perguntas antes, a Xiaomi vai abrir o menu normal de Câmara/Ficheiros na hora.
    inp.click();
  }

  document.addEventListener('DOMContentLoaded', () => { initTheme(); fetchCatalogFromApi(); });
})();