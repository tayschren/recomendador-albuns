// ════════════════════════════════════════════════════════════════
//  SPINREC — NOVAS FEATURES v2
//  · Busca direta (Last.fm search)
//  · Artistas similares no card (artist.getSimilar)
//  · Modo artista específico (artist.getTopAlbums)
//  · Gráficos da coleção (radar gênero, timeline décadas)
//  · Wishlist separada do histórico
//  · Compartilhar card (texto + tweet + Web Share API)
//  · PWA básico (manifest + service worker)
// ════════════════════════════════════════════════════════════════

// ══════════════════════
//  BUSCA DIRETA
// ══════════════════════
let searchDebounceTimer = null;
let searchPanelOpen = false;
function toggleSearchPanel(){
  searchPanelOpen = !searchPanelOpen;
  document.getElementById('search-panel').classList.toggle('open', searchPanelOpen);
  document.getElementById('search-btn').classList.toggle('active', searchPanelOpen);
  if(searchPanelOpen) document.getElementById('search-album').focus();
  // Close artist panel if open
  if(searchPanelOpen && artistPanelOpen) toggleArtistPanel();
}

function debouncedSearch(){
  clearTimeout(searchDebounceTimer);
  searchDebounceTimer = setTimeout(()=>{
    const q = document.getElementById('search-album').value.trim();
    if(q.length >= 3) doSearch();
    else document.getElementById('search-results').innerHTML='';
  }, 400);
}

async function doSearch(){
  const albumQ = document.getElementById('search-album').value.trim();
  const artistQ = document.getElementById('search-artist').value.trim();
  if(!albumQ) return;

  const btn = document.getElementById('search-go-btn');
  btn.disabled = true;
  btn.textContent = '…';
  document.getElementById('search-results').innerHTML = '<div class="search-empty">Buscando…</div>';

  try {
    // Last.fm album.search
    const url = `${LASTFM_BASE}/?method=album.search&album=${encodeURIComponent(albumQ)}&api_key=${LASTFM_API_KEY}&format=json&limit=8`;
    const r = await fetch(url);
    const d = await r.json();
    let results = d.results?.albummatches?.album || [];
    if(artistQ) results = results.filter(a => a.artist.toLowerCase().includes(artistQ.toLowerCase()));

    if(!results.length){
      document.getElementById('search-results').innerHTML = '<div class="search-empty">Nenhum álbum encontrado.</div>';
      return;
    }

    document.getElementById('search-results').innerHTML = results.map(a => {
      const img = LastFmService.getBestImage(a.image) || '';
      return `<div class="search-result-item" onclick="loadSearchResult('${x(a.name)}','${x(a.artist)}')">
        <img class="search-result-img" src="${x(img)}" onerror="this.style.display='none'" alt="">
        <div class="search-result-info">
          <div class="search-result-title">${x(a.name)}</div>
          <div class="search-result-artist">${x(a.artist)}</div>
        </div>
        <span style="font-size:.6rem;color:var(--info);letter-spacing:.06em;flex-shrink:0">▶ Girar</span>
      </div>`;
    }).join('');
  } catch(e){
    document.getElementById('search-results').innerHTML = '<div class="search-empty">Erro na busca. Tente novamente.</div>';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Buscar';
  }
}

async function loadSearchResult(albumName, artistName){
  // Clear search UI
  document.getElementById('search-results').innerHTML = '<div class="search-empty">Carregando…</div>';
  document.getElementById('search-go-btn').disabled = true;

  showLoad(true); hideRes();
  try {
    const mbData = await MusicBrainzService.searchRelease(albumName, artistName);
    const spData = await SpotifyService.resolveAlbum(albumName, artistName);
    let tracks = [];
    if(spData?.spotifyId) tracks = await SpotifyService.getTracklist(spData.spotifyId);
    if(!tracks.length && mbData?.mbid) tracks = await MusicBrainzService.getTracklist(mbData.mbid);
    const totalMin = tracks.length ? Math.round(tracks.reduce((s,t)=>s+(t.ms||0),0)/60000) : 0;

    // Get album info from Last.fm for popularity + tags
    const lfmInfo = await LastFmService.getAlbumInfo(artistName, albumName);
    const popularity = parseInt(lfmInfo?.listeners || lfmInfo?.playcount || 0);
    const genres = (lfmInfo?.tags?.tag || []).map(t=>t.name).slice(0,3);
    const lastfmUrl = lfmInfo?.url || '';
    const image = spData?.image || (lfmInfo?.image ? LastFmService.getBestImage(lfmInfo.image) : '') || '';

    const album = {
      id: spData?.spotifyId || mbData?.mbid || 'search_'+btoa(encodeURIComponent(artistName+albumName)).substring(0,20),
      name: albumName, artist: artistName,
      year: mbData?.date?.substring(0,4) || '?',
      type: 'album',
      tracks: tracks.length ? tracks : [{n:1,name:'Tracklist indisponível',ms:0}],
      totalTracks: tracks.length, durationMin: totalMin, image, genres,
      popularity, url: spData?.url || '', lastfmUrl,
      label: mbData?.label || '', country: mbData?.country || '', mbid: mbData?.mbid || '',
      _sources:{lastfm:true, mb:!!mbData, spotify:!!(spData?.image||spData?.url)}
    };

    curAlbum = album; spins++;
    document.getElementById('stat-spins').textContent = spins;
    DBService.addAlbum(album);
    checkBadges(true);
    renderCard(album);
    document.getElementById('result-section').style.display = 'block';
    document.getElementById('result-section').scrollIntoView({behavior:'smooth',block:'start'});
    document.getElementById('search-results').innerHTML = '';
  } catch(e){
    showErr('Erro ao carregar álbum.<br><small>'+e.message+'</small>');
  } finally {
    showLoad(false);
    document.getElementById('search-go-btn').disabled = false;
  }
}

// ══════════════════════
//  ARTISTAS SIMILARES
// ══════════════════════
async function loadSimilarArtists(artistName){
  const wrap = document.getElementById('similar-artists-wrap');
  if(!wrap) return;
  wrap.innerHTML = '<span class="similar-loading">Buscando artistas similares…</span>';

  try {
    const url = `${LASTFM_BASE}/?method=artist.getSimilar&artist=${encodeURIComponent(artistName)}&api_key=${LASTFM_API_KEY}&format=json&limit=8`;
    const r = await fetch(url);
    const d = await r.json();
    const similar = d.similarartists?.artist || [];

    if(!similar.length){
      wrap.innerHTML = '<span class="similar-loading" style="opacity:.5">Nenhum artista similar encontrado.</span>';
      return;
    }

    wrap.innerHTML = similar.slice(0,5).map(a =>
      `<button class="similar-artist-btn" onclick="spinBySpecificArtist('${x(a.name)}')">
        <span class="sim-icon">⟳</span>${x(a.name)}
      </button>`
    ).join('');
  } catch(e){
    wrap.innerHTML = '<span class="similar-loading" style="opacity:.5">—</span>';
  }
}

// ══════════════════════
//  MODO ARTISTA
// ══════════════════════
let artistPanelOpen = false;
function toggleArtistPanel(){
  artistPanelOpen = !artistPanelOpen;
  document.getElementById('artist-mode-panel').classList.toggle('open', artistPanelOpen);
  document.getElementById('artist-btn').classList.toggle('active', artistPanelOpen);
  if(artistPanelOpen) document.getElementById('artist-name-input').focus();
  if(artistPanelOpen && searchPanelOpen) toggleSearchPanel();
}

async function spinByArtist(){
  const name = document.getElementById('artist-name-input').value.trim();
  if(!name) { document.getElementById('artist-name-input').focus(); return; }
  await spinBySpecificArtist(name);
}

async function spinBySpecificArtist(artistName){
  document.getElementById('artist-spin-btn').disabled = true;
  showLoad(true); hideRes();
  document.getElementById('refine-section').style.display = 'none';

  try {
    const albums = await LastFmService.getArtistAlbums(artistName);
    if(!albums.length) { showErr(`Nenhum álbum encontrado para "${x(artistName)}".`); return; }

    // Filter out already listened
    const h = DBService.getHistory();
    const listenedNames = h.filter(a=>a.listened).map(a=>a.name.toLowerCase());
    let pool = shuffle(albums.filter(a => !listenedNames.includes(a.name.toLowerCase())));
    if(!pool.length) pool = shuffle(albums); // all listened? show anyway

    // Try to build a full album object
    let album = null;
    for(let i = 0; i < Math.min(pool.length, 5); i++){
      const candidate = pool[i];
      if(!candidate.name || candidate.name==='(null)') continue;
      const mbData = await MusicBrainzService.searchRelease(candidate.name, artistName);
      const spData = await SpotifyService.resolveAlbum(candidate.name, artistName);
      let tracks = [];
      if(spData?.spotifyId) tracks = await SpotifyService.getTracklist(spData.spotifyId);
      if(!tracks.length && mbData?.mbid) tracks = await MusicBrainzService.getTracklist(mbData.mbid);
      const totalMin = tracks.length ? Math.round(tracks.reduce((s,t)=>s+(t.ms||0),0)/60000) : 0;
      const image = spData?.image || LastFmService.getBestImage(candidate.image) || '';

      album = {
        id: spData?.spotifyId || mbData?.mbid || lfmId(candidate),
        name: candidate.name, artist: artistName,
        year: mbData?.date?.substring(0,4) || '?',
        type: 'album',
        tracks: tracks.length ? tracks : [{n:1,name:'Tracklist indisponível',ms:0}],
        totalTracks: tracks.length, durationMin: totalMin, image,
        genres: (candidate.tags?.tag||[]).map(t=>t.name).slice(0,3),
        popularity: parseInt(candidate.playcount||0),
        url: spData?.url||candidate.url||'', lastfmUrl: candidate.url||'',
        label: mbData?.label||'', country: mbData?.country||'', mbid: mbData?.mbid||'',
        _sources:{lastfm:true, mb:!!mbData, spotify:!!(spData?.image||spData?.url)},
        _artistMode: artistName
      };
      break;
    }

    if(!album){ showErr(`Não foi possível montar um álbum completo de "${x(artistName)}".`); return; }
    curAlbum = album; spins++;
    document.getElementById('stat-spins').textContent = spins;
    DBService.addAlbum(album);
    checkBadges(true);
    renderCard(album);
    document.getElementById('result-section').style.display = 'block';
    document.getElementById('result-section').scrollIntoView({behavior:'smooth',block:'start'});
  } catch(e){
    console.error(e);
    showErr('Erro no modo artista.<br><small>'+e.message+'</small>');
  } finally {
    showLoad(false);
    document.getElementById('artist-spin-btn').disabled = false;
  }
}

// ══════════════════════
//  WISHLIST
// ══════════════════════
const WishlistService = {
  KEY: 'spinrec4_wish',
  get(){ try{return JSON.parse(localStorage.getItem(this.KEY)||'[]')}catch{return[]} },
  save(w){ localStorage.setItem(this.KEY, JSON.stringify(w)) },
  add(a){
    let w = this.get();
    if(!w.find(x=>x.id===a.id)) w.unshift({...a, _wishTs: Date.now()});
    this.save(w); syncWishlistCount();
  },
  remove(id){
    let w = this.get().filter(a=>a.id!==id);
    this.save(w); syncWishlistCount();
    if(wishOpen) renderWishlist();
  },
  has(id){ return !!this.get().find(a=>a.id===id); },
  clear(){ if(!confirm('Limpar wishlist?'))return; localStorage.removeItem(this.KEY); syncWishlistCount(); renderWishlist(); }
};

let wishOpen = false;
function toggleWishlist(){
  wishOpen = !wishOpen;
  document.getElementById('wishlist-section').classList.toggle('open', wishOpen);
  document.getElementById('wishlist-btn').classList.toggle('active', wishOpen);
  if(wishOpen) renderWishlist();
}

function syncWishlistCount(){
  const n = WishlistService.get().length;
  document.getElementById('wishlist-count').textContent = n ? n+' álbuns' : '';
}

function renderWishlist(){
  const g = document.getElementById('wishlist-grid');
  const w = WishlistService.get();
  if(!w.length){
    g.innerHTML = '<div class="empty-state">Nenhum álbum na wishlist ainda.<br><small style="font-size:.62rem;color:var(--muted)">Use o botão 🔖 nos cards para salvar pra depois.</small></div>';
    return;
  }
  g.innerHTML = w.map(a=>`
<div class="wishlist-item" onclick="loadAlbumFromHistory('${a.id}')">
  <span class="wishlist-badge">🔖</span>
  <button class="wishlist-remove" onclick="event.stopPropagation();WishlistService.remove('${a.id}')" title="Remover">×</button>
  <img src="${x(a.image||'')}" alt="${x(a.name)}" loading="lazy" onerror="this.style.display='none'">
  <div class="wishlist-meta">
    <div class="wishlist-title">${x(a.name)}</div>
    <div class="wishlist-artist">${x(a.artist)}</div>
  </div>
</div>`).join('');
}

function clearWishlist(){ WishlistService.clear(); }

// ══════════════════════
//  COMPARTILHAR CARD
// ══════════════════════
function openShareModal(album){
  if(!album) return;
  const o = calcObscurityScore(album.popularity);
  const h = DBService.getHistory();
  const e = h.find(a=>a.id===album.id)||{};
  const rating = e.rating||0;
  const ratingStr = rating ? `${rating.toFixed(1)}/5 ⭐` : '';

  document.getElementById('share-preview').innerHTML = `
<div class="scp-top">
  <img class="scp-img" src="${x(album.image||'')}" onerror="this.style.display='none'" alt="">
  <div class="scp-info">
    <div class="scp-title">${x(album.name)}</div>
    <div class="scp-artist">${x(album.artist)}</div>
    <div class="scp-year">${album.year}${album.durationMin?' · '+album.durationMin+' min':''}</div>
  </div>
</div>
<div class="scp-badge-row">
  <span class="scp-obscurity">${o.label}</span>
  ${ratingStr?`<span class="scp-rating">${ratingStr}</span>`:''}
</div>
<div class="scp-brand">SPINREC — spinrec.app</div>`;

  // Show native share button if supported
  if(navigator.share) document.getElementById('share-native-btn').style.display='';

  document.getElementById('share-modal').classList.add('open');
}

function closeShareModal(){
  document.getElementById('share-modal').classList.remove('open');
}

function buildShareText(album){
  if(!album) return '';
  const o = calcObscurityScore(album.popularity);
  const h = DBService.getHistory();
  const e = h.find(a=>a.id===album.id)||{};
  const rating = e.rating ? ` · ${e.rating.toFixed(1)}/5 ⭐` : '';
  const url = album.url || album.lastfmUrl || '';
  return `🎵 ${album.name} — ${album.artist} (${album.year})\n${o.label}${rating}\n\nDescoberto via SPINREC${url?'\n'+url:''}`;
}

function copyShareText(){
  if(!curAlbum) return;
  const text = buildShareText(curAlbum);
  navigator.clipboard.writeText(text).then(()=>{
    const btn = document.getElementById('share-copy-btn');
    btn.textContent = '✓ Copiado!';
    btn.classList.add('copied');
    setTimeout(()=>{ btn.textContent = '📋 Copiar texto'; btn.classList.remove('copied'); }, 2200);
  }).catch(()=> alert(text));
}

function shareTweet(){
  if(!curAlbum) return;
  const text = buildShareText(curAlbum);
  window.open('https://twitter.com/intent/tweet?text='+encodeURIComponent(text), '_blank', 'noopener');
}

async function shareNative(){
  if(!curAlbum || !navigator.share) return;
  try {
    await navigator.share({ title: curAlbum.name+' — '+curAlbum.artist, text: buildShareText(curAlbum), url: curAlbum.url||curAlbum.lastfmUrl||'' });
  } catch(e){ /* cancelled */ }
}

document.getElementById('share-modal').addEventListener('click', function(e){
  if(e.target===this) closeShareModal();
});

// ══════════════════════
//  GRÁFICOS DA COLEÇÃO
// ══════════════════════
function renderCollectionCharts(){
  const h = DBService.getHistory();
  const listened = h.filter(a=>a.listened);
  const chartsEl = document.getElementById('collection-charts');
  if(!chartsEl) return;

  if(!listened.length){
    chartsEl.innerHTML = '<div class="chart-empty" style="grid-column:1/-1">Marque álbuns como escutados para ver seus gráficos.</div>';
    return;
  }

  // Gêneros top 6
  const genreMap = {};
  listened.forEach(a=>(a.genres||[]).forEach(g=>{ genreMap[g]=(genreMap[g]||0)+1; }));
  const topGenres = Object.entries(genreMap).sort((a,b)=>b[1]-a[1]).slice(0,6);
  const maxG = topGenres[0]?.[1] || 1;

  // Décadas
  const decadeMap = {};
  listened.forEach(a=>{
    if(!a.year||a.year==='?') return;
    const d = Math.floor(parseInt(a.year)/10)*10;
    decadeMap[d] = (decadeMap[d]||0)+1;
  });
  const decades = Object.entries(decadeMap).sort((a,b)=>+a[0]-+b[0]);
  const maxD = Math.max(...decades.map(d=>d[1]), 1);

  // Obscuridade
  const obscLevels = {mainstream:0,cult:0,obscure:0,ultra:0};
  listened.forEach(a=>{ const o=calcObscurityScore(parseInt(a.popularity||0)); obscLevels[o.level]++; });
  const maxO = Math.max(...Object.values(obscLevels), 1);
  const obscLabels = {mainstream:'Mainstream',cult:'Cult',obscure:'Obscuro',ultra:'Ultra Obscuro'};
  const obscColors = {mainstream:'#1DB954',cult:'var(--accent)',obscure:'#e67e22',ultra:'#e74c3c'};

  chartsEl.innerHTML = `
<div class="chart-card">
  <div class="chart-card-title">Top Gêneros</div>
  ${topGenres.length ? topGenres.map(([g,n])=>`
    <div class="chart-bar-row">
      <div class="chart-bar-label">${x(g)}</div>
      <div class="chart-bar-track"><div class="chart-bar-fill" style="width:${Math.round(n/maxG*100)}%"></div></div>
      <div class="chart-bar-val">${n}</div>
    </div>
  `).join('') : '<div class="chart-empty">Sem dados</div>'}
</div>

<div class="chart-card">
  <div class="chart-card-title">Por Década</div>
  ${decades.length ? `<div class="chart-decade-row">
    ${decades.map(([dec,n])=>`
      <div class="chart-decade-col">
        <div class="chart-decade-bar" style="height:${Math.round(n/maxD*68)+4}px" title="${n} álbuns"></div>
        <div class="chart-decade-lbl">'${String(dec).slice(2)}</div>
      </div>
    `).join('')}
  </div>
  <div style="font-size:.6rem;color:var(--muted);text-align:center;letter-spacing:.03em;">${listened.filter(a=>a.year&&a.year!=='?').length} álbuns com data</div>`
  : '<div class="chart-empty">Sem dados</div>'}
</div>

<div class="chart-card">
  <div class="chart-card-title">Perfil de Obscuridade</div>
  ${Object.entries(obscLevels).filter(([,n])=>n>0).map(([lvl,n])=>`
    <div class="chart-bar-row">
      <div class="chart-bar-label" style="color:${obscColors[lvl]}">${obscLabels[lvl]}</div>
      <div class="chart-bar-track"><div class="chart-bar-fill" style="width:${Math.round(n/maxO*100)}%;background:${obscColors[lvl]}"></div></div>
      <div class="chart-bar-val">${n}</div>
    </div>
  `).join('') || '<div class="chart-empty">Sem dados</div>'}
</div>

<div class="chart-card">
  <div class="chart-card-title">Países Explorados</div>
  ${(()=>{
    const cm={};
    listened.filter(a=>a.country).forEach(a=>{ cm[a.country]=(cm[a.country]||0)+1; });
    const top = Object.entries(cm).sort((a,b)=>b[1]-a[1]).slice(0,6);
    const maxC = top[0]?.[1]||1;
    return top.length ? top.map(([c,n])=>`
      <div class="chart-bar-row">
        <div class="chart-bar-label">${x(c)}</div>
        <div class="chart-bar-track"><div class="chart-bar-fill" style="width:${Math.round(n/maxC*100)}%;background:var(--mb)"></div></div>
        <div class="chart-bar-val">${n}</div>
      </div>
    `).join('') : '<div class="chart-empty">Sem dados de país</div>';
  })()}
</div>`;

  // Animate bars after paint
  requestAnimationFrame(()=>{
    document.querySelectorAll('.chart-bar-fill').forEach(el=>{
      el.style.transition='width .7s ease';
    });
  });
}

// ══════════════════════
//  PWA
// ══════════════════════
let deferredInstallPrompt = null;
window.addEventListener('beforeinstallprompt', e=>{
  e.preventDefault();
  deferredInstallPrompt = e;
  if(!localStorage.getItem('pwa_dismissed')){
    setTimeout(()=>document.getElementById('pwa-banner').classList.add('visible'), 3000);
  }
});

async function installPWA(){
  if(!deferredInstallPrompt) return;
  deferredInstallPrompt.prompt();
  const {outcome} = await deferredInstallPrompt.userChoice;
  if(outcome==='accepted'){
    document.getElementById('pwa-banner').classList.remove('visible');
    deferredInstallPrompt = null;
  }
}

function dismissPWA(){
  document.getElementById('pwa-banner').classList.remove('visible');
  localStorage.setItem('pwa_dismissed','1');
}

window.addEventListener('appinstalled', ()=>{
  document.getElementById('pwa-banner').classList.remove('visible');
});

// Register service worker
if('serviceWorker' in navigator){
  window.addEventListener('load', ()=>{
    navigator.serviceWorker.register('sw.js').catch(()=>{});
  });
}
// ║                SPINREC — CAMADA DE SERVIÇOS                  ║
// ╠══════════════════════════════════════════════════════════════╣
// ║  1. LastFmService   → descoberta por tag sem OAuth           ║
// ║  2. MusicBrainzService → metadados abertos                   ║
// ║  3. SpotifyService  → capas HD + link (PKCE OAuth)           ║
// ║  4. DBService       → localStorage (→ Supabase)              ║
// ╚══════════════════════════════════════════════════════════════╝

// ═══════════════════════════════════════
//  CONFIG
// ═══════════════════════════════════════
const SPOTIFY_CLIENT_ID = '1f4a9b64bd104af5a61fb610dffa78cd';

// Last.fm — chave pública (pode ficar no frontend; sem dados privados)
// TODO ao migrar para Next.js: mover para variável de ambiente LASTFM_API_KEY
// e chamar via /api/lastfm para não expor a key
const LASTFM_API_KEY = 'be2331260a3fb4f8d91e7a96bd4c5ebb'; // demo key — substitua pela sua

// MusicBrainz — sem autenticação para leitura
const MB_BASE = 'https://musicbrainz.org/ws/2';
const LASTFM_BASE = 'https://ws.audioscrobbler.com/2.0';

// ═══════════════════════════════════════
//  SPOTIFY PKCE AUTH
// ═══════════════════════════════════════
let pathname = window.location.pathname;
if(pathname.endsWith('index.html')) pathname = pathname.replace('index.html','');
const REDIRECT_URI = window.location.origin + pathname + (pathname.endsWith('/') ? '' : '/');

function rndStr(n){
  const c='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
  let s='';const a=new Uint8Array(n);crypto.getRandomValues(a);
  a.forEach(b=>s+=c[b%c.length]);return s;
}
async function codeChallenge(v){
  const d=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(v));
  return btoa(String.fromCharCode(...new Uint8Array(d))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
async function startLogin(){
  const v=rndStr(64);const ch=await codeChallenge(v);
  sessionStorage.setItem('pkce_v',v);
  location.href='https://accounts.spotify.com/authorize?'+new URLSearchParams({
    response_type:'code',client_id:SPOTIFY_CLIENT_ID,scope:'user-read-private',
    redirect_uri:REDIRECT_URI,code_challenge_method:'S256',code_challenge:ch
  });
}
async function exchangeCode(code){
  const v=sessionStorage.getItem('pkce_v');
  if(!v) throw new Error('PKCE verifier missing');
  const r=await fetch('https://accounts.spotify.com/api/token',{
    method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},
    body:new URLSearchParams({grant_type:'authorization_code',code,redirect_uri:REDIRECT_URI,client_id:SPOTIFY_CLIENT_ID,code_verifier:v})
  });
  if(!r.ok){const t=await r.text();throw new Error('Token: '+t)}
  saveTokens(await r.json());
  sessionStorage.removeItem('pkce_v');
  history.replaceState({},'',location.pathname);
}
async function refreshToken(){
  const rt=localStorage.getItem('sp_rt');if(!rt)throw new Error('no refresh token');
  const r=await fetch('https://accounts.spotify.com/api/token',{
    method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},
    body:new URLSearchParams({grant_type:'refresh_token',refresh_token:rt,client_id:SPOTIFY_CLIENT_ID})
  });
  if(!r.ok) throw new Error('refresh failed');
  saveTokens(await r.json());
}
function saveTokens(d){
  localStorage.setItem('sp_at',d.access_token);
  localStorage.setItem('sp_exp',Date.now()+(d.expires_in-60)*1000);
  if(d.refresh_token) localStorage.setItem('sp_rt',d.refresh_token);
}
async function getAT(){
  if(Date.now()<(+localStorage.getItem('sp_exp')||0)) return localStorage.getItem('sp_at');
  await refreshToken();return localStorage.getItem('sp_at');
}
const loggedIn=()=>!!localStorage.getItem('sp_at');
function doLogout(){['sp_at','sp_exp','sp_rt'].forEach(k=>localStorage.removeItem(k));syncAuthUI()}
function handleAuth(){loggedIn()?doLogout():startLogin()}

// ═══════════════════════════════════════
//  SERVICE: LAST.FM
//  Responsável: descoberta musical por tag/gênero
//  Docs: https://www.last.fm/api
//  TODO Next.js: chamar via /api/lastfm (server-side) p/ esconder API key
// ═══════════════════════════════════════
const LastFmService = {
  /**
   * Busca top álbuns de uma tag (gênero) no Last.fm
   * @param {string} tag  - ex: "jazz", "bossa nova", "shoegaze"
   * @param {number} page - paginação aleatória para variedade
   * @returns {Array}     - lista de {name, artist, mbid, image, url, playcount}
   */
  async getTopAlbumsByTag(tag, page=1){
    // Last.fm tag.getTopAlbums — sem OAuth, apenas API key
    const url = `${LASTFM_BASE}/?method=tag.gettopalbums&tag=${encodeURIComponent(tag)}&api_key=${LASTFM_API_KEY}&format=json&limit=50&page=${page}`;
    try {
      const r = await fetch(url);
      if(!r.ok) throw new Error('Last.fm '+r.status);
      const d = await r.json();
      return (d.albums?.album || []).filter(a => a.name && a.artist?.name && a.name !== '(null)');
    } catch(e) {
      console.warn('[LastFm] falhou, usando fallback Spotify:', e.message);
      return [];
    }
  },

  /**
   * Busca álbuns por artista no Last.fm
   * @param {string} artist
   * @returns {Array}
   */
  async getArtistAlbums(artist){
    const url = `${LASTFM_BASE}/?method=artist.gettopalbums&artist=${encodeURIComponent(artist)}&api_key=${LASTFM_API_KEY}&format=json&limit=20`;
    try {
      const r = await fetch(url);
      const d = await r.json();
      return (d.topalbums?.album || []);
    } catch(e){ return []; }
  },

  /**
   * Obtém info detalhada de um álbum via Last.fm
   * Inclui: tags, wiki, playcount, listeners
   */
  async getAlbumInfo(artist, album){
    const url = `${LASTFM_BASE}/?method=album.getinfo&artist=${encodeURIComponent(artist)}&album=${encodeURIComponent(album)}&api_key=${LASTFM_API_KEY}&format=json`;
    try {
      const r = await fetch(url);
      const d = await r.json();
      return d.album || null;
    } catch(e){ return null; }
  },

  // Extrai a melhor imagem disponível do array de imagens do Last.fm
  getBestImage(images){
    if(!images || !images.length) return '';
    const pref = ['extralarge','large','medium','small'];
    for(const size of pref){
      const img = images.find(i => i.size === size);
      if(img && img['#text'] && img['#text'] !== '') return img['#text'];
    }
    return images[images.length-1]?.['#text'] || '';
  }
};

// ═══════════════════════════════════════
//  SERVICE: MUSICBRAINZ
//  Responsável: metadados abertos (label, país, data, tracklist oficial)
//  Docs: https://musicbrainz.org/doc/MusicBrainz_API
//  Rate limit: 1 req/s — respeitar com delay
//  TODO Next.js: cachear respostas no Supabase p/ evitar rate limit
// ═══════════════════════════════════════
const MusicBrainzService = {
  _lastCall: 0,

  // Garante delay mínimo de 1.1s entre chamadas (respeitar rate limit)
  async _throttle(){
    const now = Date.now();
    const diff = now - this._lastCall;
    if(diff < 1100) await new Promise(r => setTimeout(r, 1100 - diff));
    this._lastCall = Date.now();
  },

  /**
   * Busca release-group pelo nome do álbum + artista
   * Retorna: mbid, tipo, data, label, país, tracklist
   */
  async searchRelease(albumName, artistName){
    await this._throttle();
    const q = encodeURIComponent(`release:"${albumName}" AND artist:"${artistName}"`);
    const url = `${MB_BASE}/release?query=${q}&limit=5&fmt=json`;
    try {
      const r = await fetch(url, {headers:{'User-Agent':'SPINREC/1.0 (spinrec.app)'}});
      if(!r.ok) return null;
      const d = await r.json();
      const releases = d.releases || [];
      // Prefere release com mais informações
      const best = releases.find(rel => rel['label-info']?.length > 0) || releases[0];
      if(!best) return null;
      return {
        mbid: best.id,
        date: best.date || '',
        country: best.country || '',
        label: best['label-info']?.[0]?.label?.name || '',
        status: best.status || '',
        trackCount: best['track-count'] || 0,
        barcode: best.barcode || '',
      };
    } catch(e){
      console.warn('[MusicBrainz] erro:', e.message);
      return null;
    }
  },

  /**
   * Obtém tracklist oficial de um release pelo MBID
   */
  async getTracklist(mbid){
    if(!mbid) return [];
    await this._throttle();
    try {
      const r = await fetch(`${MB_BASE}/release/${mbid}?inc=recordings&fmt=json`, {
        headers:{'User-Agent':'SPINREC/1.0 (spinrec.app)'}
      });
      if(!r.ok) return [];
      const d = await r.json();
      const media = d.media || [];
      return media.flatMap(m => (m.tracks || []).map(t => ({
        n: t.number,
        name: t.title,
        ms: t.length || 0
      })));
    } catch(e){ return []; }
  }
};

// ═══════════════════════════════════════
//  SERVICE: SPOTIFY
//  Responsável: capas HD + link de escuta
//  Docs: https://developer.spotify.com/documentation/web-api
//  TODO Next.js: tokens gerenciados server-side via Supabase session
// ═══════════════════════════════════════
const SpotifyService = {
  async fetch(path, retry=false){
    if(!loggedIn()) return null; // Spotify é opcional
    try {
      const token = await getAT();
      const r = await fetch('https://api.spotify.com/v1'+path, {
        headers:{Authorization:'Bearer '+token}
      });
      if(r.status === 401){
        if(retry) throw new Error('401 após refresh');
        await refreshToken(); return this.fetch(path, true);
      }
      if(!r.ok) return null;
      return r.json();
    } catch(e){
      console.warn('[Spotify] erro:', e.message);
      return null;
    }
  },

  /**
   * Resolve capa em alta resolução + URL do álbum no Spotify
   * Busca pelo nome do álbum + artista
   * @returns {image, url} ou {image:'', url:''}
   */
  async resolveAlbum(albumName, artistName){
    const q = `album:${albumName} artist:${artistName}`;
    const d = await this.fetch(`/search?q=${encodeURIComponent(q)}&type=album&limit=5&market=BR`);
    if(!d) return {image:'', url:''};
    const items = d.albums?.items || [];
    const match = items.find(i =>
      i.name.toLowerCase().includes(albumName.toLowerCase().substring(0,10))
    ) || items[0];
    if(!match) return {image:'', url:''};
    return {
      image: match.images?.[0]?.url || '',
      url: match.external_urls?.spotify || '',
      spotifyId: match.id,
      tracks: [], // preenchido separadamente se necessário
      totalTracks: match.total_tracks || 0,
    };
  },

  /**
   * Obtém tracklist completa de um álbum Spotify
   */
  async getTracklist(spotifyId){
    if(!spotifyId) return [];
    const d = await this.fetch(`/albums/${spotifyId}/tracks?limit=50&market=BR`);
    if(!d) return [];
    return (d.items || []).map(t => ({
      n: t.track_number,
      name: t.name,
      ms: t.duration_ms || 0
    }));
  }
};

// ═══════════════════════════════════════
//  SERVICE: DB (localStorage → Supabase)
//  TODO: substituir por Supabase client
//
//  Migração para Supabase:
//  import { createClient } from '@supabase/supabase-js'
//  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
//  -- Tabelas: spinrec_history (user_id, album_id, rating, listened, ts)
//              spinrec_albums  (id, name, artist, image, url, ...)
// ═══════════════════════════════════════
const DBService = {
  KEY: 'spinrec4',
  getHistory(){ try{return JSON.parse(localStorage.getItem(this.KEY)||'[]')}catch{return[]} },
  saveHistory(h){ localStorage.setItem(this.KEY, JSON.stringify(h)) },
  addAlbum(a){
    let h=this.getHistory();
    if(!h.find(x=>x.id===a.id)) h.unshift({...a,rating:0,listened:false,favorite:false,note:'',ts:Date.now()});
    this.saveHistory(h);syncStats();
  },
  setListened(id,v){ let h=this.getHistory();const x=h.find(a=>a.id===id);if(x)x.listened=v;this.saveHistory(h);syncStats(); },
  setRating(id,v){ let h=this.getHistory();const x=h.find(a=>a.id===id);if(x)x.rating=v;this.saveHistory(h);if(histOpen)renderHist(); },
  setFavorite(id,v){ let h=this.getHistory();const x=h.find(a=>a.id===id);if(x)x.favorite=v;this.saveHistory(h);if(histOpen)renderHist(); },
  setNote(id,v){ let h=this.getHistory();const x=h.find(a=>a.id===id);if(x)x.note=v;this.saveHistory(h); },
  clear(){ if(!confirm('Limpar todo o histórico?'))return;localStorage.removeItem(this.KEY);syncStats();renderHist(); },
};

// ═══════════════════════════════════════
//  COUNTRIES — tags Last.fm por região
// ═══════════════════════════════════════
const COUNTRIES = [
  {l:'Qualquer',f:'🌍',q:''},
  {l:'Japão',f:'🇯🇵',q:'japanese',tags:['japanese music','city pop','j-pop','japanese jazz','japanese rock','shibuya-kei']},
  {l:'Brasil',f:'🇧🇷',q:'brazilian',tags:['mpb','bossa nova','samba','tropicália','baile funk','axé','forró']},
  {l:'EUA',f:'🇺🇸',q:'american',tags:['classic rock','blues','soul','hip hop','country','americana','r&b']},
  {l:'Reino Unido',f:'🇬🇧',q:'british',tags:['britpop','post-punk','brit rock','shoegaze','madchester','new wave']},
  {l:'Alemanha',f:'🇩🇪',q:'german',tags:['krautrock','neue deutsche welle','german electronic','kosmische']},
  {l:'Noruega',f:'🇳🇴',q:'norwegian',tags:['black metal','norwegian black metal','nordic folk']},
  {l:'Jamaica',f:'🇯🇲',q:'jamaican',tags:['reggae','dub','dancehall','rocksteady','ska']},
  {l:'Islândia',f:'🇮🇸',q:'icelandic',tags:['icelandic','nordic ambient','post-rock iceland']},
  {l:'Mali',f:'🇲🇱',q:'malian',tags:['malian music','afrobeat mali','desert blues','wassoulou']},
  {l:'Nigeria',f:'🇳🇬',q:'nigerian',tags:['afrobeat','highlife','jùjú','afropop']},
  {l:'Cuba',f:'🇨🇺',q:'cuban',tags:['salsa','son cubano','rumba','nueva trova']},
  {l:'Argentina',f:'🇦🇷',q:'argentinian',tags:['tango','rock nacional','folklore argentino']},
  {l:'França',f:'🇫🇷',q:'french',tags:['chanson','french pop','french jazz','yé-yé','french electronic']},
  {l:'Suécia',f:'🇸🇪',q:'swedish',tags:['swedish pop','abba','melodic death metal','swedish jazz']},
  {l:'Etiópia',f:'🇪🇹',q:'ethiopian',tags:['ethiojazz','azmari','ethiopian music']},
];

let selCountry = COUNTRIES[0];
let countryBtns = [];

function buildCountries(){
  const w = document.getElementById('country-grid');
  if(!w) return;
  w.innerHTML=''; countryBtns=[];
  COUNTRIES.forEach((c,i)=>{
    const b = document.createElement('button');
    b.className = 'country-chip'+(i===0?' active':'');
    b.innerHTML = `<span class="country-flag">${c.f}</span>${c.l}`;
    b.onclick = ()=>{
      countryBtns.forEach(x=>x.classList.remove('active'));
      b.classList.add('active');
      selCountry = c;
    };
    w.appendChild(b); countryBtns.push(b);
  });
}

// ═══════════════════════════════════════
//  OBSCURITY SCORE
// ═══════════════════════════════════════
function calcObscurityScore(popularity){
  // popularity = Last.fm playcount
  if(popularity >= 2000000) return {level:'mainstream',label:'Mainstream',score:15};
  if(popularity >= 200000)  return {level:'cult',label:'Cult',score:45};
  if(popularity >= 20000)   return {level:'obscure',label:'Obscuro',score:72};
  return {level:'ultra',label:'Ultra Obscuro',score:92};
}

function renderObscurityBadge(popularity){
  const o = calcObscurityScore(popularity);
  const icons = {mainstream:'📊',cult:'🔥',obscure:'🕳',ultra:'💀'};
  return `<div class="obscurity-wrap">
    <span class="obscurity-badge ${o.level}">${icons[o.level]} ${o.label}</span>
    <div class="obscurity-bar"><div class="obscurity-fill" style="width:${o.score}%;background:${o.level==='mainstream'?'#1DB954':o.level==='cult'?'var(--accent)':o.level==='obscure'?'#e67e22':'#e74c3c'}"></div></div>
    <span class="obscurity-score-num">${fmtNum(popularity)} plays</span>
  </div>`;
}

// ═══════════════════════════════════════
//  ALBUM PAGE MODAL
// ═══════════════════════════════════════
function openAlbumPage(a){
  const modal = document.getElementById('album-modal');
  const content = document.getElementById('album-modal-content');
  const o = calcObscurityScore(a.popularity);
  const countryDisplay = a.country ? `<span class="country-origin-badge">${a.country}</span>` : '';

  content.innerHTML = `
<div class="album-page">
  <div>
    <div class="album-page-cover">
      <img src="${x(a.image)||'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 200 200%22%3E%3Crect fill=%22%23141414%22 width=%22200%22 height=%22200%22/%3E%3Ctext fill=%22%236a6560%22 font-size=%2248%22 text-anchor=%22middle%22 x=%22100%22 y=%22115%22%3E♪%3C/text%3E%3C/svg%3E'}" alt="${x(a.name)}" onerror="this.src='data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 200 200%22%3E%3Crect fill=%22%23141414%22 width=%22200%22 height=%22200%22/%3E%3Ctext fill=%22%236a6560%22 font-size=%2248%22 text-anchor=%22middle%22 x=%22100%22 y=%22115%22%3E♪%3C/text%3E%3C/svg%3E'">
      <div class="album-page-cover-shadow"></div>
    </div>
    ${renderObscurityBadge(a.popularity)}
    <div style="margin-top:14px">
      ${a.url?`<a class="btn btn-spotify" style="display:inline-flex;margin-bottom:6px" href="${x(a.url)}" target="_blank" rel="noopener">▶ Ouvir no Spotify</a>`:''}
      ${a.lastfmUrl?`<a class="btn btn-lastfm" style="display:inline-flex" href="${x(a.lastfmUrl)}" target="_blank" rel="noopener">◉ Ver no Last.fm</a>`:''}
    </div>
  </div>
  <div class="album-page-right">
    <div>
      <div class="album-page-title">${x(a.name)}</div>
      <div class="album-page-artist">${x(a.artist)}${countryDisplay}</div>
      <div class="album-page-meta">
        <span class="apm-tag">${a.year}</span>
        ${a.totalTracks?`<span class="apm-tag">${a.totalTracks} faixas</span>`:''}
        ${a.durationMin?`<span class="apm-tag">${a.durationMin} min</span>`:''}
        ${(a.genres||[]).map(g=>`<span class="apm-tag">${x(g)}</span>`).join('')}
        ${a.label?`<span class="apm-tag">${x(a.label)}</span>`:''}
      </div>
      ${a.mbid?`<div class="mb-info" style="margin-top:8px">MBID: <span>${a.mbid.substring(0,18)}…</span></div>`:''}
    </div>
    <div>
      <div class="album-page-section-title">Tracklist</div>
      <div class="album-page-full-tracklist album-page-tracklist">
        ${a.tracks.map(t=>`<div class="apt-row"><span class="apt-num">${t.n}</span><span class="apt-name">${x(t.name)}</span><span class="apt-dur">${fmt(t.ms)}</span></div>`).join('')}
      </div>
    </div>
  </div>
</div>`;
  modal.classList.add('open');
  document.body.style.overflow='hidden';
}

function closeAlbumPage(){
  document.getElementById('album-modal').classList.remove('open');
  document.body.style.overflow='';
}
document.getElementById('album-modal').addEventListener('click',function(e){
  if(e.target===this) closeAlbumPage();
});

// ═══════════════════════════════════════
//  COLLECTION & BADGES SYSTEM
// ═══════════════════════════════════════
const BADGE_DEFS = [
  // Escutas
  {id:'first_spin',icon:'🎯',name:'Primeiro Giro',desc:'Descobriu seu primeiro álbum',req:h=>h.length>=1,type:'count',target:1,getValue:h=>h.length},
  {id:'ten_albums',icon:'📀',name:'Colecionador',desc:'10 álbuns no histórico',req:h=>h.length>=10,type:'count',target:10,getValue:h=>h.length},
  {id:'fifty_albums',icon:'🗃',name:'Arquivista',desc:'50 álbuns no histórico',req:h=>h.length>=50,type:'count',target:50,getValue:h=>h.length},
  // Escutados
  {id:'listen_5',icon:'🎧',name:'Fone de Ouvido',desc:'Marcou 5 álbuns como escutados',req:h=>h.filter(a=>a.listened).length>=5,type:'count',target:5,getValue:h=>h.filter(a=>a.listened).length},
  {id:'listen_20',icon:'🎵',name:'Maratonista',desc:'Marcou 20 álbuns como escutados',req:h=>h.filter(a=>a.listened).length>=20,type:'count',target:20,getValue:h=>h.filter(a=>a.listened).length},
  {id:'listen_50',icon:'🏅',name:'Veterano',desc:'50 álbuns escutados. Respeito.',req:h=>h.filter(a=>a.listened).length>=50,type:'count',target:50,getValue:h=>h.filter(a=>a.listened).length},
  // Décadas
  {id:'decade_70s',icon:'🕺',name:'Anos 70',desc:'Ouviu 5 álbuns da década de 70',req:h=>h.filter(a=>a.listened&&a.year>='1970'&&a.year<='1979').length>=5,type:'decade',target:5,getValue:h=>h.filter(a=>a.listened&&a.year>='1970'&&a.year<='1979').length},
  {id:'decade_80s',icon:'📼',name:'Anos 80',desc:'Ouviu 5 álbuns da década de 80',req:h=>h.filter(a=>a.listened&&a.year>='1980'&&a.year<='1989').length>=5,type:'decade',target:5,getValue:h=>h.filter(a=>a.listened&&a.year>='1980'&&a.year<='1989').length},
  {id:'decade_90s',icon:'📼',name:'Anos 90',desc:'Ouviu 5 álbuns da década de 90',req:h=>h.filter(a=>a.listened&&a.year>='1990'&&a.year<='1999').length>=5,type:'decade',target:5,getValue:h=>h.filter(a=>a.listened&&a.year>='1990'&&a.year<='1999').length},
  {id:'decade_2000s',icon:'💿',name:'Anos 2000',desc:'Ouviu 5 álbuns dos anos 2000',req:h=>h.filter(a=>a.listened&&a.year>='2000'&&a.year<='2009').length>=5,type:'decade',target:5,getValue:h=>h.filter(a=>a.listened&&a.year>='2000'&&a.year<='2009').length},
  // Gêneros (via tag)
  {id:'jazz_lover',icon:'🎷',name:'Jazzista',desc:'Escutou 3 álbuns de jazz',req:h=>h.filter(a=>a.listened&&(a.genres||[]).some(g=>g.toLowerCase().includes('jazz'))).length>=3,type:'genre',target:3,getValue:h=>h.filter(a=>a.listened&&(a.genres||[]).some(g=>g.toLowerCase().includes('jazz'))).length},
  {id:'metal_head',icon:'🤘',name:'Cabeça de Metal',desc:'Escutou 3 álbuns de metal',req:h=>h.filter(a=>a.listened&&(a.genres||[]).some(g=>g.toLowerCase().includes('metal'))).length>=3,type:'genre',target:3,getValue:h=>h.filter(a=>a.listened&&(a.genres||[]).some(g=>g.toLowerCase().includes('metal'))).length},
  {id:'electronica',icon:'🎛',name:'Eletro-viciado',desc:'Escutou 3 álbuns eletrônicos',req:h=>h.filter(a=>a.listened&&(a.genres||[]).some(g=>['electronic','ambient','techno','house','idm'].some(x=>g.toLowerCase().includes(x)))).length>=3,type:'genre',target:3,getValue:h=>h.filter(a=>a.listened&&(a.genres||[]).some(g=>['electronic','ambient','techno','house','idm'].some(x=>g.toLowerCase().includes(x)))).length},
  // Obscuridade
  {id:'digger',icon:'🕳',name:'Crate Digger',desc:'Encontrou 3 álbuns ultra obscuros',req:h=>h.filter(a=>a.listened&&parseInt(a.popularity||0)<20000).length>=3,type:'obscurity',target:3,getValue:h=>h.filter(a=>a.listened&&parseInt(a.popularity||0)<20000).length},
  {id:'globetrotter',icon:'🌍',name:'Globetrotter',desc:'Descobriu música de 3 países diferentes',req:h=>{const countries=new Set(h.filter(a=>a.listened&&a.country).map(a=>a.country));return countries.size>=3},type:'world',target:3,getValue:h=>{const countries=new Set(h.filter(a=>a.listened&&a.country).map(a=>a.country));return countries.size}},
  // Avaliações
  {id:'critic',icon:'⭐',name:'Crítico Musical',desc:'Avaliou 10 álbuns com nota',req:h=>h.filter(a=>a.rating>0).length>=10,type:'rating',target:10,getValue:h=>h.filter(a=>a.rating>0).length},
  {id:'note_taker',icon:'📝',name:'Jornalista',desc:'Escreveu notas em 5 álbuns',req:h=>h.filter(a=>a.note&&a.note.trim().length>0).length>=5,type:'note',target:5,getValue:h=>h.filter(a=>a.note&&a.note.trim().length>0).length},
  // Brasil
  {id:'brasil_soul',icon:'🇧🇷',name:'Alma Brasileira',desc:'Escutou 3 álbuns de MPB/Samba/Bossa',req:h=>h.filter(a=>a.listened&&(a.genres||[]).some(g=>['mpb','samba','bossa','tropicália','baile'].some(x=>g.toLowerCase().includes(x)))).length>=3,type:'country_genre',target:3,getValue:h=>h.filter(a=>a.listened&&(a.genres||[]).some(g=>['mpb','samba','bossa','tropicália','baile'].some(x=>g.toLowerCase().includes(x)))).length},
];

let prevEarnedBadges = new Set();

function checkBadges(showToasts=false){
  const h = DBService.getHistory();
  const earned = new Set(BADGE_DEFS.filter(b=>b.req(h)).map(b=>b.id));
  if(showToasts){
    earned.forEach(id=>{
      if(!prevEarnedBadges.has(id)){
        const badge = BADGE_DEFS.find(b=>b.id===id);
        if(badge) showBadgeToast(badge);
      }
    });
  }
  prevEarnedBadges = earned;
  return earned;
}

function showBadgeToast(badge){
  const t = document.createElement('div');
  t.className='new-badge-toast';
  t.innerHTML=`<span class="toast-icon">${badge.icon}</span><div class="toast-text"><strong>🏆 Nova conquista!</strong>${badge.name} — ${badge.desc}</div>`;
  document.body.appendChild(t);
  setTimeout(()=>t.style.opacity='0',3500);
  setTimeout(()=>t.remove(),4000);
}

let collOpen = false;
function toggleCollection(){
  collOpen = !collOpen;
  document.getElementById('collection-section').classList.toggle('open', collOpen);
  document.getElementById('coll-btn').classList.toggle('active', collOpen);
  if(collOpen) renderCollection();
}

function renderCollection(){
  const h = DBService.getHistory();
  const earned = checkBadges(false);

  // Stats
  const listenedCount = h.filter(a=>a.listened).length;
  const genres = new Set(h.filter(a=>a.listened).flatMap(a=>a.genres||[]));
  const countries = new Set(h.filter(a=>a.listened&&a.country).map(a=>a.country));
  const decades = new Set(h.filter(a=>a.listened&&a.year&&a.year!=='?').map(a=>a.year.substring(0,3)+'0s'));
  const avgRating = h.filter(a=>a.rating>0).reduce((s,a)=>s+a.rating,0) / (h.filter(a=>a.rating>0).length||1);

  document.getElementById('coll-stats').innerHTML=`
    <div class="coll-stat"><span class="coll-stat-num">${h.length}</span><span class="coll-stat-label">Álbuns Descobertos</span></div>
    <div class="coll-stat"><span class="coll-stat-num">${listenedCount}</span><span class="coll-stat-label">Escutados</span></div>
    <div class="coll-stat"><span class="coll-stat-num">${genres.size}</span><span class="coll-stat-label">Gêneros Explorados</span></div>
    <div class="coll-stat"><span class="coll-stat-num">${countries.size}</span><span class="coll-stat-label">Países</span></div>
    <div class="coll-stat"><span class="coll-stat-num">${decades.size}</span><span class="coll-stat-label">Décadas</span></div>
    <div class="coll-stat"><span class="coll-stat-num">${h.filter(a=>a.rating>0).length?avgRating.toFixed(1):'—'}</span><span class="coll-stat-label">Nota Média</span></div>
  `;

  document.getElementById('badges-grid').innerHTML = BADGE_DEFS.map(b=>{
    const isEarned = earned.has(b.id);
    const val = b.getValue(h);
    const pct = Math.min(100, Math.round(val/b.target*100));
    return `<div class="badge-card ${isEarned?'earned':'locked'}">
      <div class="badge-icon">${b.icon}</div>
      <div class="badge-info">
        <div class="badge-name">${b.name}</div>
        <div class="badge-desc">${b.desc}</div>
        ${isEarned?'<div class="badge-earned-label">✓ Conquistado</div>':
          `<div class="badge-progress"><div class="badge-progress-fill" style="width:${pct}%"></div></div>
           <div class="badge-earned-label" style="color:var(--muted)">${val}/${b.target}</div>`}
      </div>
    </div>`;
  }).join('');

  // Render charts
  renderCollectionCharts();
}
const GENRES=[
  {l:'🎲 Aleatório',q:''},
  {l:'Rock',q:'rock'},{l:'Jazz',q:'jazz'},{l:'Hip-Hop',q:'hip hop'},
  {l:'Eletrônico',q:'electronic'},{l:'Pop',q:'pop'},{l:'Soul / R&B',q:'soul'},
  {l:'Metal',q:'metal'},{l:'Folk / Indie',q:'indie'},{l:'Clássico',q:'classical'},
  {l:'Blues',q:'blues'},{l:'Country',q:'country'},{l:'Reggae',q:'reggae'},
  {l:'Funk',q:'funk'},{l:'Punk',q:'punk'},{l:'Alternativo',q:'alternative'},
  {l:'Bossa Nova',q:'bossa nova'},{l:'Samba',q:'samba'},{l:'MPB',q:'mpb'},
  {l:'Forró',q:'forro'},{l:'Sertanejo',q:'sertanejo'},{l:'Pagode',q:'pagode'},
  {l:'Gospel',q:'gospel'},{l:'Ambient',q:'ambient'},{l:'Lo-fi',q:'lo-fi'},
  {l:'Grunge',q:'grunge'},{l:'New Wave',q:'new wave'},{l:'Disco',q:'disco'},
  {l:'Trap',q:'trap'},{l:'K-Pop',q:'k-pop'},{l:'Post-Rock',q:'post-rock'},
  {l:'Progressive',q:'progressive rock'},{l:'Shoegaze',q:'shoegaze'},
  {l:'Drill',q:'drill'},{l:'Psychedelic',q:'psychedelic'},
];
const FALLBACK_TAGS=['rock','jazz','electronic','pop','soul','indie','blues'];
let selGenre=GENRES[0],genreBtns=[];

function buildGenres(){
  const w=document.getElementById('genre-chips');w.innerHTML='';genreBtns=[];
  GENRES.forEach((g,i)=>{
    const b=document.createElement('button');
    b.className='chip'+(i===0?' active':'');
    b.textContent=g.l;
    b.onclick=()=>{genreBtns.forEach(x=>x.classList.remove('active'));b.classList.add('active');selGenre=g};
    w.appendChild(b);genreBtns.push(b);
  });
}
function filterGenres(v){const q=v.toLowerCase();genreBtns.forEach(b=>{b.style.display=(!q||b.textContent.toLowerCase().includes(q))?'':'none'})}

// ═══════════════════════════════════════
//  FILTER STATE
// ═══════════════════════════════════════
let F={durMin:0,durMax:9999,type:'',eraFrom:1900,eraTo:2099,excl:false};
function pick(el,g){
  document.querySelectorAll('#'+g+'-chips .chip').forEach(c=>c.classList.remove('active'));
  el.classList.add('active');
  if(g==='dur'){F.durMin=+el.dataset.min;F.durMax=+el.dataset.max}
  if(g==='type')F.type=el.dataset.val;
  if(g==='era'){F.eraFrom=+el.dataset.from;F.eraTo=+el.dataset.to}
}
function toggleExcl(el){F.excl=!F.excl;el.classList.toggle('active',F.excl)}

// ═══════════════════════════════════════
//  LOADING STEPS UI
// ═══════════════════════════════════════
function setStep(n){
  ['ls1','ls2','ls3'].forEach((id,i)=>{
    const el=document.getElementById(id);
    if(!el)return;
    el.classList.remove('active','done');
    if(i+1<n) el.classList.add('done');
    else if(i+1===n) el.classList.add('active');
  });
}

// ═══════════════════════════════════════
//  SPIN — ORQUESTRADOR PRINCIPAL
//  Fluxo: Last.fm → filtros → MusicBrainz → Spotify
// ═══════════════════════════════════════
let spins=0,curAlbum=null;

async function spin(){
  document.getElementById('spin-btn').disabled=true;
  document.getElementById('refine-section').style.display='none';
  const advBadge = document.getElementById('adventure-badge-wrap');
  if(advBadge) advBadge.innerHTML='';
  showLoad(true);hideRes();
  try {
    const album = await fetchAlbumMultiSource();
    if(!album){showErr('Nenhum álbum encontrado com esses filtros. Tente ampliar os critérios.');return}
    curAlbum=album;spins++;
    document.getElementById('stat-spins').textContent=spins;
    DBService.addAlbum(album);
    checkBadges(true);
    renderCard(album);
    document.getElementById('result-section').style.display='block';
    document.getElementById('result-section').scrollIntoView({behavior:'smooth',block:'start'});
  } catch(e){
    console.error(e);
    showErr('Erro ao buscar álbum.<br><small style="font-size:.65rem;opacity:.6">'+e.message+'</small>');
  } finally {
    showLoad(false);
    document.getElementById('spin-btn').disabled=false;
  }
}

/**
 * Orquestra os 3 serviços para montar um álbum completo:
 * 1. Last.fm  → lista de candidatos pelo gênero
 * 2. Filtra por época, tipo, exclusões
 * 3. MusicBrainz → metadados (label, país, tracklist)
 * 4. Spotify  → capa HD + link (se logado)
 */
async function fetchAlbumMultiSource(){
  const h = DBService.getHistory();
  const listenedIds = h.filter(a=>a.listened).map(a=>a.id);
  const histIds = h.map(a=>a.id);

  // ① LAST.FM — descoberta
  setStep(1);setPill('lastfm',true);
  // Combina gênero + país: ex: "jazz" + Japão → "japanese jazz" se disponível
  let tag;
  if(selCountry.q && selGenre.q){
    // Tenta tag combinada primeiro, depois fallback para país genérico
    const countryTags = selCountry.tags || [];
    const genreTag = selGenre.q;
    // Procura tag que contenha ambos
    const combined = countryTags.find(t=>t.includes(genreTag.split(' ')[0]));
    tag = combined || rnd([...countryTags, genreTag]);
  } else if(selCountry.q){
    tag = rnd(selCountry.tags || [selCountry.q]);
  } else {
    tag = selGenre.q || rnd(FALLBACK_TAGS);
  }
  const page = Math.floor(Math.random()*4)+1; // paginação aleatória para variedade
  let candidates = await LastFmService.getTopAlbumsByTag(tag, page);

  // Fallback: se Last.fm falhar, tenta tag genérica
  if(!candidates.length && selGenre.q){
    candidates = await LastFmService.getTopAlbumsByTag(rnd(FALLBACK_TAGS), 1);
  }
  if(!candidates.length) throw new Error('Last.fm não retornou álbuns para esta tag');
  setPill('lastfm',false);

  // Filtra por época e tipo (Last.fm não tem esses filtros nativos)
  // OBS: Last.fm não fornece ano direto no getTopAlbums — filtramos depois via MusicBrainz
  // Embaralha para variedade
  let pool = shuffle([...candidates]);
  if(F.excl) pool = pool.filter(a => !listenedIds.includes(lfmId(a)));

  // ② MUSICBRAINZ — metadados + filtros de época/duração
  setStep(2);setPill('mb',true);
  for(let i=0; i<Math.min(pool.length,8); i++){
    const candidate = pool[i];
    const albumName = candidate.name;
    const artistName = candidate.artist?.name || candidate.artist || '';
    if(!albumName || !artistName) continue;

    // Busca metadados no MusicBrainz
    const mbData = await MusicBrainzService.searchRelease(albumName, artistName);

    // Filtro de época via MusicBrainz
    if(mbData?.date){
      const year = parseInt(mbData.date.substring(0,4));
      if(year < F.eraFrom || year > F.eraTo) continue;
    }

    // ③ SPOTIFY — capa + link + tracklist
    setStep(3);setPill('spotify',true);
    const spData = await SpotifyService.resolveAlbum(albumName, artistName);

    // Tracklist: preferência Spotify > MusicBrainz > Last.fm
    let tracks = [];
    let totalMin = 0;
    if(spData?.spotifyId){
      tracks = await SpotifyService.getTracklist(spData.spotifyId);
    }
    if(!tracks.length && mbData?.mbid){
      tracks = await MusicBrainzService.getTracklist(mbData.mbid);
    }
    // Calcula duração
    if(tracks.length){
      totalMin = Math.round(tracks.reduce((s,t)=>s+(t.ms||0),0)/60000);
    } else {
      // Last.fm tem duração em segundos em alguns casos
      totalMin = Math.round((candidate.duration||0)/60) || 0;
    }
    // Filtro de duração (só aplica se tivermos dados)
    if(totalMin>0 && (totalMin<F.durMin || totalMin>F.durMax)) {
      setPill('spotify',false);
      continue;
    }

    setPill('mb',false);setPill('spotify',false);

    // Monta objeto normalizado
    const year = mbData?.date ? mbData.date.substring(0,4)
                : (candidate.wiki?.published || '').substring(0,4) || '?';
    const image = spData?.image || LastFmService.getBestImage(candidate.image) || '';
    const id = spData?.spotifyId || mbData?.mbid || lfmId(candidate);

    // Pula álbuns já no histórico (exceto se pool esgotado)
    if(histIds.includes(id) && i < pool.length-1) continue;

    return {
      id,
      name: albumName,
      artist: artistName,
      year,
      type: F.type || 'album',
      tracks: tracks.length ? tracks : [{n:1,name:'Tracklist indisponível',ms:0}],
      totalTracks: tracks.length || candidate.tracks?.track?.length || 0,
      durationMin: totalMin,
      image,
      genres: (candidate.tags?.tag || []).map(t=>t.name).slice(0,3),
      popularity: parseInt(candidate.playcount||0),
      url: spData?.url || candidate.url || '',
      lastfmUrl: candidate.url || '',
      label: mbData?.label || '',
      country: mbData?.country || '',
      mbid: mbData?.mbid || '',
      // Flags de fonte para exibição
      _sources: {
        lastfm: true,
        mb: !!mbData,
        spotify: !!(spData?.image || spData?.url),
      }
    };
  }
  return null;
}

// Gera um ID único para álbum Last.fm (sem Spotify ID)
function lfmId(a){ return 'lfm_'+btoa(encodeURIComponent((a.artist?.name||'')+'-'+(a.name||''))).replace(/[^a-zA-Z0-9]/g,'').substring(0,24); }
function shuffle(arr){for(let i=arr.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[arr[i],arr[j]]=[arr[j],arr[i]]}return arr}
function rnd(arr){return arr[Math.floor(Math.random()*arr.length)]}

// ═══════════════════════════════════════
//  RENDER CARD
// ═══════════════════════════════════════
function renderCard(a, adventureMode){
  const h=DBService.getHistory();const e=h.find(x=>x.id===a.id)||{};
  const r=e.rating||0;const lis=e.listened||false;const fav=e.favorite||false;const note=e.note||'';
  const tl=a.type==='album'?'ÁLBUM':a.type==='single'?'SINGLE/EP':(a.type||'ÁLBUM').toUpperCase();
  const gs=a.genres.length?a.genres.slice(0,2).join(' · '):selGenre.l||'';
  const sources = a._sources||{};

  // Adventure badge
  const advBadgeWrap = document.getElementById('adventure-badge-wrap');
  if(adventureMode && advBadgeWrap){
    const labels={challenge:'🎯 Modo Desafio',different:'🌍 Totalmente Diferente',cult:'🖤 Álbum Cult',classic:'🏆 Clássico Obrigatório',underground:'🕳 Underground',random:'🎲 Roleta Total'};
    advBadgeWrap.innerHTML=`<div class="adventure-indicator">${labels[adventureMode]||adventureMode}</div>`;
  } else if(advBadgeWrap){ advBadgeWrap.innerHTML=''; }

  document.getElementById('card-wrap').innerHTML=`
<div class="data-sources">
  ${sources.lastfm?'<span class="ds-badge lastfm">Last.fm</span>':''}
  ${sources.mb?'<span class="ds-badge mb">MusicBrainz</span>':''}
  ${sources.spotify?'<span class="ds-badge spotify">Spotify</span>':''}
</div>
<div class="album-card">
  <div class="cover-wrap">
    <img src="${x(a.image)||'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 200 200%22%3E%3Crect fill=%22%23141414%22 width=%22200%22 height=%22200%22/%3E%3Ctext fill=%22%236a6560%22 font-size=%2248%22 text-anchor=%22middle%22 x=%22100%22 y=%22115%22%3E♪%3C/text%3E%3C/svg%3E'}" alt="${x(a.name)}" loading="lazy"
      onerror="this.src='data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 200 200%22%3E%3Crect fill=%22%23141414%22 width=%22200%22 height=%22200%22/%3E%3Ctext fill=%22%236a6560%22 font-size=%2248%22 text-anchor=%22middle%22 x=%22100%22 y=%22115%22%3E♪%3C/text%3E%3C/svg%3E'">
    <div class="vinyl-shadow"></div>
    <span class="type-badge">${tl}</span>
  </div>
  <div class="album-info">
    <div class="album-info-top">
      <div class="album-genre">${x(gs)}</div>
      <div class="album-title">${x(a.name)}</div>
      <div class="album-artist">${x(a.artist)}</div>
      <div class="album-meta">
        <span><span class="dot"></span>${a.year}</span>
        ${a.totalTracks?`<span><span class="dot"></span>${a.totalTracks} faixas</span>`:''}
        ${a.durationMin?`<span><span class="dot"></span>${a.durationMin} min</span>`:''}
        ${a.label?`<span><span class="dot"></span>${x(a.label)}</span>`:''}
        ${a.country?`<span><span class="dot"></span>${x(a.country)}</span>`:''}
      </div>
      ${a.popularity>0?renderObscurityBadge(a.popularity):''}
      ${a.mbid?`<div class="mb-info">MBID: <span>${a.mbid.substring(0,18)}…</span></div>`:''}
    </div>
    <div>
      <div class="rating-section">
        <div class="rating-label-text">Sua avaliação</div>
        ${starWidget(a.id,r)}
      </div>
      <div class="album-actions">
        <button class="btn btn-listen${lis?' marked':''}" id="bl-${a.id}" onclick="togLis('${a.id}',this)">
          ${lis?'✓ Escutado':'+ Marcar como escutado'}
        </button>
        <button class="btn btn-fav${fav?' active':''}" id="bf-${a.id}" onclick="togFav('${a.id}',this)">
          ${fav?'★ Favorito':'☆ Favoritar'}
        </button>
        <button class="btn" onclick="openAlbumPage(curAlbum)" style="border-color:var(--info);color:var(--info)">⊞ Página do Álbum</button>
        ${a.url?`<a class="btn btn-spotify" href="${x(a.url)}" target="_blank" rel="noopener">▶ Spotify</a>`:''}
        ${a.lastfmUrl?`<a class="btn btn-lastfm" href="${x(a.lastfmUrl)}" target="_blank" rel="noopener">◉ Last.fm</a>`:''}
        <button class="btn btn-again" onclick="spin()">⟳ Outro álbum</button>
        ${a._artistMode ? `<button class="btn" style="border-color:#9b59b6;color:#9b59b6" onclick="spinBySpecificArtist('${x(a.artist)}')">⟳ Mais de ${x(a.artist)}</button>` : ''}
        <button class="btn btn-wishlist${WishlistService.has(a.id)?' in-wishlist':''}" id="bw-${a.id}" onclick="togWish('${a.id}',this)">
          ${WishlistService.has(a.id)?'🔖 Na wishlist':'🔖 Quero ouvir'}
        </button>
        <button class="btn btn-share" onclick="openShareModal(curAlbum)">↗ Compartilhar</button>
      </div>
      <div class="note-section">
        <div class="note-label">Nota pessoal</div>
        <textarea class="note-input" id="note-${a.id}" placeholder="O que você achou? Lembranças, contexto…" rows="2">${x(note)}</textarea>
        <div style="display:flex;align-items:center">
          <button class="note-save-btn" onclick="saveNote('${a.id}')">Salvar nota</button>
          <span class="note-saved" id="ns-${a.id}">✓ salvo</span>
        </div>
      </div>
      <div class="tracklist-section">
        <button class="tl-toggle" onclick="togTL(this)"><span class="tl-arrow">▶</span> Ver tracklist</button>
        <div class="track-list">
          ${a.tracks.map(t=>`<div class="track-row"><span class="track-num">${t.n}</span><span class="track-name">${x(t.name)}</span><span class="track-dur">${fmt(t.ms)}</span></div>`).join('')}
        </div>
      </div>
      <div class="similar-section">
        <div class="similar-label">Artistas similares</div>
        <div class="similar-artists" id="similar-artists-wrap"><span class="similar-loading">—</span></div>
      </div>
    </div>
  </div>
</div>`;

  // Show refine section
  document.getElementById('refine-section').style.display='block';

  // Load similar artists async
  if(a.artist) loadSimilarArtists(a.artist);
}

// ═══════════════════════════════════════
//  STAR WIDGET
// ═══════════════════════════════════════
function starWidget(id,cur){
  let h=`<div class="stars-container" id="sc-${id}">`;
  for(let i=1;i<=5;i++){
    const c=cur>=i?'full':cur>=i-.5?'half':'';
    h+=`<div class="star-unit ${c}" id="su-${id}-${i}">
      <div class="star-bg">★</div><div class="star-fl">★</div><div class="star-fr">★</div>
      <div class="star-left" onmouseover="pvw('${id}',${i-.5})" onmouseout="rstPvw('${id}')" onclick="commitR('${id}',${i-.5})"></div>
      <div class="star-right" onmouseover="pvw('${id}',${i})" onmouseout="rstPvw('${id}')" onclick="commitR('${id}',${i})"></div>
    </div>`;
  }
  h+=`<span class="rating-val" id="rv-${id}">${cur?cur.toFixed(1):'—'}</span></div>`;
  return h;
}
function pvw(id,v){setStar(id,v);const el=document.getElementById('rv-'+id);if(el)el.textContent=v.toFixed(1)}
function rstPvw(id){const h=DBService.getHistory();const e=h.find(a=>a.id===id);const r=e?e.rating:0;setStar(id,r);const el=document.getElementById('rv-'+id);if(el)el.textContent=r?r.toFixed(1):'—'}
function commitR(id,v){DBService.setRating(id,v);pvw(id,v)}
function setStar(id,v){for(let i=1;i<=5;i++){const u=document.getElementById(`su-${id}-${i}`);if(!u)continue;u.classList.remove('full','half');if(v>=i)u.classList.add('full');else if(v>=i-.5)u.classList.add('half')}}
function togLis(id,btn){const h=DBService.getHistory();const e=h.find(a=>a.id===id);const nv=e?!e.listened:true;DBService.setListened(id,nv);btn.textContent=nv?'✓ Escutado':'+ Marcar como escutado';btn.classList.toggle('marked',nv);checkBadges(true);if(histOpen)renderHist()}
function togTL(btn){const l=btn.nextElementSibling;l.classList.toggle('open');const o=l.classList.contains('open');btn.querySelector('.tl-arrow').textContent=o?'▼':'▶';btn.childNodes[1].textContent=o?' Ocultar tracklist':' Ver tracklist'}

function togFav(id,btn){const h=DBService.getHistory();const e=h.find(a=>a.id===id);const nv=e?!e.favorite:true;DBService.setFavorite(id,nv);btn.textContent=nv?'★ Favorito':'☆ Favoritar';btn.classList.toggle('active',nv);if(histOpen)renderHist()}
function togWish(id,btn){
  const inWish = WishlistService.has(id);
  if(inWish){
    WishlistService.remove(id);
    btn.textContent='🔖 Quero ouvir';btn.classList.remove('in-wishlist');
  } else {
    const a = curAlbum||(DBService.getHistory().find(x=>x.id===id));
    if(a) WishlistService.add(a);
    btn.textContent='🔖 Na wishlist';btn.classList.add('in-wishlist');
  }
  if(wishOpen) renderWishlist();
}
function saveNote(id){const el=document.getElementById('note-'+id);if(!el)return;DBService.setNote(id,el.value);const ns=document.getElementById('ns-'+id);if(ns){ns.classList.add('show');setTimeout(()=>ns.classList.remove('show'),1800)}}

// ═══════════════════════════════════════
//  REFINE — "Girar parecido, mas…"
//  Mapeia direção → tags Last.fm relacionadas
// ═══════════════════════════════════════
const REFINE_TAG_MAP = {
  heavier: {
    rock:['heavy metal','doom metal','sludge metal'],jazz:['free jazz','avant-garde jazz'],
    pop:['alternative','grunge'],electronic:['industrial','noise'],soul:['funk','hard bop'],
    indie:['post-hardcore','noise rock'],default:['heavy metal','hard rock','doom metal']
  },
  experimental: {
    rock:['experimental rock','krautrock','post-rock'],jazz:['avant-garde jazz','free jazz'],
    pop:['art pop','experimental pop'],electronic:['glitch','noise','idm'],
    indie:['experimental indie','lo-fi'],default:['experimental','avant-garde','noise']
  },
  calmer: {
    rock:['acoustic','folk rock','soft rock'],jazz:['smooth jazz','cool jazz','bossa nova'],
    pop:['dream pop','soft pop'],electronic:['ambient','chillout','lo-fi'],
    metal:['doom','post-metal'],default:['ambient','acoustic','folk']
  },
  darker: {
    rock:['gothic rock','dark wave','post-punk'],jazz:['noir jazz','modal jazz'],
    pop:['dark pop','electropop'],electronic:['dark ambient','industrial'],
    indie:['shoegaze','slowcore'],default:['dark wave','gothic','post-punk']
  },
  popular: {
    default:['pop','top 40','chart','hits']
  },
  obscure: {
    rock:['obscure rock','private press','acid rock'],jazz:['obscure jazz','rare groove'],
    pop:['obscure pop','cult'],electronic:['obscure electronic','experimental'],
    default:['obscure','rare','cult','private press','underground']
  }
};

function getRefineTag(direction){
  const curGenre = selGenre.q || '';
  const map = REFINE_TAG_MAP[direction];
  if(!map) return 'rock';
  // Try to match current genre to a category
  for(const [key, tags] of Object.entries(map)){
    if(key!=='default' && curGenre.includes(key)){return rnd(tags)}
  }
  return rnd(map.default || REFINE_TAG_MAP[direction].default || ['rock']);
}

async function spinRefined(direction){
  // Visually mark active refine btn
  document.querySelectorAll('.refine-btn').forEach(b=>b.classList.remove('spinning'));
  const btn=document.querySelector(`.refine-btn[data-dir="${direction}"]`);
  if(btn) btn.classList.add('spinning');

  document.getElementById('spin-btn').disabled=true;
  showLoad(true);hideRes();
  document.getElementById('refine-section').style.display='none';

  // Override the tag temporarily
  const originalGenre = selGenre;
  const refinedTag = getRefineTag(direction);
  selGenre = {l: refinedTag, q: refinedTag};

  try {
    const album = await fetchAlbumMultiSource();
    selGenre = originalGenre; // restore
    if(!album){showErr('Nenhum álbum encontrado. Tente outra direção.');return}
    curAlbum=album;spins++;
    document.getElementById('stat-spins').textContent=spins;
    DBService.addAlbum(album);
    renderCard(album);
    document.getElementById('result-section').style.display='block';
    document.getElementById('result-section').scrollIntoView({behavior:'smooth',block:'start'});
  } catch(e){
    selGenre = originalGenre;
    console.error(e);
    showErr('Erro ao buscar álbum.<br><small>'+e.message+'</small>');
  } finally {
    showLoad(false);
    document.getElementById('spin-btn').disabled=false;
    document.querySelectorAll('.refine-btn').forEach(b=>b.classList.remove('spinning'));
  }
}

// ═══════════════════════════════════════
//  ADVENTURE MODE
// ═══════════════════════════════════════
const ADVENTURE_CONFIGS = {
  challenge: {
    tags:['noise','free jazz','brutal death metal','musique concrete','harsh noise','microtonality','12-tone'],
    pageRange:[1,3]
  },
  different: {
    tags:['afrobeat','gamelan','gagaku','tuvan throat singing','flamenco','qawwali','fado','cumbia','rebetiko'],
    pageRange:[1,2]
  },
  cult: {
    tags:['cult classic','obscure rock','private press','psychedelic','krautrock','tropicália','library music'],
    pageRange:[1,4]
  },
  classic: {
    tags:['classic rock','jazz standards','soul','blues classic','70s rock','60s pop','progressive rock'],
    pageRange:[1,2],popularFilter:true
  },
  underground: {
    tags:['underground hip hop','underground metal','lo-fi indie','bedroom pop','cassette culture','noise rock'],
    pageRange:[2,5]
  },
  random: {
    // pulls from all genres randomly
    useAllGenres: true,
    pageRange:[1,5]
  }
};

function openAdventure(){document.getElementById('adventure-modal').classList.add('open')}
function closeAdventure(){document.getElementById('adventure-modal').classList.remove('open')}

async function startAdventure(mode){
  closeAdventure();
  const cfg = ADVENTURE_CONFIGS[mode];
  if(!cfg) return;

  document.getElementById('spin-btn').disabled=true;
  showLoad(true);hideRes();
  document.getElementById('refine-section').style.display='none';

  const originalGenre = selGenre;
  let tag;
  if(cfg.useAllGenres){
    tag = rnd(GENRES.filter(g=>g.q).map(g=>g.q));
  } else {
    tag = rnd(cfg.tags);
  }
  const page = Math.floor(Math.random()*(cfg.pageRange[1]-cfg.pageRange[0]+1))+cfg.pageRange[0];
  selGenre = {l: tag, q: tag};

  try {
    let album = null;
    // Try up to 3 times for underground/cult to get something rare
    for(let attempt=0; attempt<3; attempt++){
      const candidates = await LastFmService.getTopAlbumsByTag(tag, page+attempt);
      if(!candidates.length) continue;
      const shuffled = shuffle([...candidates]);

      // For underground: filter by low playcount
      let filtered = shuffled;
      if(mode==='underground') filtered = shuffled.filter(a=>parseInt(a.playcount||0)<50000) || shuffled;
      if(mode==='classic') filtered = shuffled.filter(a=>parseInt(a.playcount||0)>500000) || shuffled;

      if(filtered.length){
        // Use a temp override to pick from filtered list
        const tempAlbum = filtered[0];
        const mbData = await MusicBrainzService.searchRelease(tempAlbum.name, tempAlbum.artist?.name||'');
        const spData = await SpotifyService.resolveAlbum(tempAlbum.name, tempAlbum.artist?.name||'');
        let tracks = [];
        if(spData?.spotifyId) tracks = await SpotifyService.getTracklist(spData.spotifyId);
        if(!tracks.length && mbData?.mbid) tracks = await MusicBrainzService.getTracklist(mbData.mbid);
        const totalMin = tracks.length ? Math.round(tracks.reduce((s,t)=>s+(t.ms||0),0)/60000) : 0;
        const year = mbData?.date ? mbData.date.substring(0,4) : '?';
        const image = spData?.image || LastFmService.getBestImage(tempAlbum.image) || '';
        const id = spData?.spotifyId || mbData?.mbid || lfmId(tempAlbum);
        album = {
          id, name:tempAlbum.name, artist:tempAlbum.artist?.name||'',
          year, type:'album', tracks:tracks.length?tracks:[{n:1,name:'Tracklist indisponível',ms:0}],
          totalTracks:tracks.length, durationMin:totalMin, image,
          genres:(tempAlbum.tags?.tag||[]).map(t=>t.name).slice(0,3),
          popularity:parseInt(tempAlbum.playcount||0),
          url:spData?.url||tempAlbum.url||'', lastfmUrl:tempAlbum.url||'',
          label:mbData?.label||'', country:mbData?.country||'', mbid:mbData?.mbid||'',
          _sources:{lastfm:true,mb:!!mbData,spotify:!!(spData?.image||spData?.url)}
        };
        break;
      }
    }

    selGenre = originalGenre;
    if(!album){showErr('Aventura não encontrou álbum. Tente novamente!');return}
    curAlbum=album;spins++;
    document.getElementById('stat-spins').textContent=spins;
    DBService.addAlbum(album);
    renderCard(album, mode);
    document.getElementById('result-section').style.display='block';
    document.getElementById('result-section').scrollIntoView({behavior:'smooth',block:'start'});
  } catch(e){
    selGenre = originalGenre;
    console.error(e);
    showErr('Erro no modo aventura.<br><small>'+e.message+'</small>');
  } finally {
    showLoad(false);
    document.getElementById('spin-btn').disabled=false;
  }
}

// ═══════════════════════════════════════
//  HISTORY TAB STATE
// ═══════════════════════════════════════
let histTab = 'all';
function setHistTab(tab, el){
  histTab = tab;
  document.querySelectorAll('.htab').forEach(b=>b.classList.remove('active'));
  if(el) el.classList.add('active');
  renderHist();
}

// ═══════════════════════════════════════
//  HISTORY PANEL
// ═══════════════════════════════════════
let histOpen=false;
function toggleHistory(){
  histOpen=!histOpen;
  document.getElementById('history-section').classList.toggle('open',histOpen);
  document.getElementById('div1').style.display=histOpen?'':'none';
  document.getElementById('hist-btn').classList.toggle('active',histOpen);
  if(histOpen)renderHist();
}
function renderHist(){
  const g=document.getElementById('hist-grid');
  let h=DBService.getHistory();
  if(!h.length){g.innerHTML='<div class="empty-state">Nenhum álbum no histórico ainda.</div>';document.getElementById('hist-count').textContent='';return}

  // Filter by tab
  if(histTab==='listened') h=h.filter(a=>a.listened);
  if(histTab==='favorites') h=h.filter(a=>a.favorite);
  if(histTab==='rated') h=h.filter(a=>a.rating>0);

  // Sort
  const sortEl = document.querySelector('.history-sort');
  const sort = sortEl ? sortEl.value : 'recent';
  if(sort==='rating') h=[...h].sort((a,b)=>(b.rating||0)-(a.rating||0));
  if(sort==='alpha') h=[...h].sort((a,b)=>a.name.localeCompare(b.name));

  document.getElementById('hist-count').textContent=h.length+' álbuns';

  if(!h.length){g.innerHTML='<div class="empty-state">Nenhum álbum nessa categoria.</div>';return}

  g.innerHTML=h.map(a=>`
<div class="history-item" onclick="loadAlbumFromHistory('${a.id}')">
  <img src="${x(a.image||'')}" alt="${x(a.name)}" loading="lazy"
    onerror="this.style.display='none'">
  ${a.listened?'<span class="listened-badge">✓</span>':''}
  ${a.favorite?'<span class="fav-badge">★</span>':''}
  <div class="history-meta">
    <div class="history-title">${x(a.name)}</div>
    <div class="history-artist">${x(a.artist)}</div>
    <div class="history-stars-row">${hStars(a.rating)}</div>
    ${a.note?`<div class="history-note-text">${x(a.note.substring(0,40))}${a.note.length>40?'…':''}</div>`:''}
  </div>
</div>`).join('');
}
function hStars(r){let h='';for(let i=1;i<=5;i++){h+=r>=i?'<span class="h-star">★</span>':r>=i-.5?'<span class="h-star">⯨</span>':'<span class="h-star empty">★</span>'}return h}
function loadAlbumFromHistory(id){
  const h=DBService.getHistory();const a=h.find(x=>x.id===id);
  if(!a)return;curAlbum=a;renderCard(a);
  document.getElementById('result-section').style.display='block';
  document.getElementById('result-section').scrollIntoView({behavior:'smooth'});
}

// ═══════════════════════════════════════
//  PILL STATUS
// ═══════════════════════════════════════
function setPill(service, active){
  const el = document.getElementById('pill-'+service);
  if(!el)return;
  el.classList.toggle('active', active);
}

// ═══════════════════════════════════════
//  AUTH UI
// ═══════════════════════════════════════
function syncAuthUI(){
  const banner=document.getElementById('auth-banner');
  const txt=document.getElementById('auth-text');
  const btn=document.getElementById('auth-action-btn');
  if(loggedIn()){
    banner.classList.add('connected');
    txt.innerHTML='✓ &nbsp;Conectado ao Spotify — capas em alta resolução ativadas';
    btn.textContent='Desconectar';btn.className='auth-btn logout';
    setPill('spotify',true);
  }else{
    banner.classList.remove('connected');
    txt.innerHTML='<strong>Conecte sua conta Spotify</strong> — gratuita ou Premium — para capas em alta resolução e links de escuta.';
    btn.textContent='Entrar com Spotify';btn.className='auth-btn login';
    setPill('spotify',false);
  }
}

// ═══════════════════════════════════════
//  HELPERS
// ═══════════════════════════════════════
function showLoad(on){
  document.getElementById('load-wrap').style.display=on?'block':'none';
  document.getElementById('loading-steps').classList.toggle('on',on);
  if(on){['ls1','ls2','ls3'].forEach(id=>{const e=document.getElementById(id);if(e){e.classList.remove('active','done')}})}
}
function hideRes(){document.getElementById('result-section').style.display='none'}
function showErr(m){document.getElementById('result-section').style.display='block';document.getElementById('card-wrap').innerHTML=`<div class="notice"><strong>Ops!</strong><br>${m}</div>`}
function fmt(ms){if(!ms)return'—';const m=Math.floor(ms/60000),s=Math.floor((ms%60000)/1000);return`${m}:${s.toString().padStart(2,'0')}`}
function fmtNum(n){if(!n)return'';if(n>1000000)return(n/1000000).toFixed(1)+'M';if(n>1000)return(n/1000).toFixed(0)+'K';return n}
function x(s){if(!s)return'';return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')}
function syncStats(){
  const h=DBService.getHistory();
  const n=h.filter(a=>a.listened).length;
  document.getElementById('stat-listened').textContent=n;
  document.getElementById('listened-badge').textContent=n+' escutados';
}
function clearHist(){DBService.clear()}

// ═══════════════════════════════════════
//  BOOT
// ═══════════════════════════════════════
(async function boot(){
  buildGenres();buildCountries();syncStats();syncWishlistCount();
  prevEarnedBadges = checkBadges(false);
  setPill('db',true); // DB local sempre ativo
  document.getElementById('spin-btn').disabled=false; // funciona sem Spotify

  const p=new URLSearchParams(location.search);
  const code=p.get('code'),err=p.get('error');
  if(code||err) history.replaceState({},'',location.pathname);

  if(err){
    showErr('Login cancelado ou negado pelo Spotify.');
    document.getElementById('result-section').style.display='block';
  } else if(code){
    try {
      ['sp_at','sp_exp','sp_rt'].forEach(k=>localStorage.removeItem(k));
      await exchangeCode(code);
      await new Promise(r=>setTimeout(r,300));
    } catch(e){
      console.error('Auth error:',e);
      showErr('Erro no login com Spotify.<br><small>'+e.message+'</small>');
      document.getElementById('result-section').style.display='block';
    }
  }
  syncAuthUI();
})();
