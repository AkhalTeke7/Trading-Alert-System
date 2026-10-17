// theme.js — 4 modes: night (default) / day / dawn / vivid (colorful texts)
// Switcher is ONLY mounted on main.html — other pages just read the saved theme.
(function(){
  const KEY = 'pa.theme';
  const THEMES = ['night','day','dawn'];
  const ICONS = { night:'ti ti-moon', day:'ti ti-sun', dawn:'ti ti-sunrise' };
  const TITLES= { night:'Night', day:'Day', dawn:'Dawn' };

  function getStored(){
    try{
      const v = localStorage.getItem(KEY);
      if(v==='vivid'){ localStorage.removeItem(KEY); return null; }
      if(THEMES.includes(v)) return v;
    }catch{}
    return null;
  }
  function systemPrefersLight(){
    try{ return window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches; }catch{ return false; }
  }
  function resolveInitial(){
    const s = getStored();
    if(s) return s;
    return systemPrefersLight() ? 'day' : 'night';
  }
  function applyTheme(name){
    if(name==='night') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', name);
    try{ localStorage.setItem(KEY, name); }catch{}
    // update switcher UI
    document.querySelectorAll('.theme-switch [data-theme-btn]').forEach(b=>{
      b.classList.toggle('active', b.getAttribute('data-theme-btn')===name);
    });
    // let charts re-tint (main.html injects TradingView widget with theme bg)
    window.dispatchEvent(new CustomEvent('pa:theme', { detail: { theme: name }}));
  }
  function buildSwitcher(container){
    if(!container || container.__paTheme) return;
    container.__paTheme = true;
    container.classList.add('theme-switch');
    container.setAttribute('role','group');
    container.setAttribute('aria-label','Theme');
    THEMES.forEach(name=>{
      const btn = document.createElement('button');
      btn.type='button';
      btn.setAttribute('data-theme-btn', name);
      btn.title = TITLES[name];
      btn.setAttribute('aria-label', TITLES[name]);
      btn.innerHTML = `<i class="${ICONS[name]}"></i>`;
      btn.addEventListener('click', ()=> applyTheme(name));
      container.appendChild(btn);
    });
  }
  // apply before paint if possible
  const initial = resolveInitial();
  applyTheme(initial);

  // expose
  window.PA_THEME = { THEMES, apply: applyTheme, get: ()=> getStored()||initial };

  function isMainPage(){
    const p = (location.pathname||'').toLowerCase();
    return p.endsWith('/main.html') || p.endsWith('/') || p==='' ;
  }
  function mount(){
    // ONLY show switcher on main page — other pages just honor the saved theme
    if(!isMainPage()){
      const stray = document.getElementById('theme-switch');
      if(stray) stray.remove();
      return;
    }
    const spots = [
      document.getElementById('theme-switch'),
      document.querySelector('.right-header'),
      document.querySelector('header'),
    ].filter(Boolean);
    let host = document.getElementById('theme-switch');
    if(!host){
      host = document.createElement('div');
      host.id='theme-switch';
      if(spots[1]) spots[1].appendChild(host);
      else if(spots[2]) spots[2].appendChild(host);
      else document.body.prepend(host);
    }
    buildSwitcher(host);
    applyTheme(getStored()||initial);
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();

  // keep tabs in sync
  window.addEventListener('storage', e=>{
    if(e.key===KEY && THEMES.includes(e.newValue)) applyTheme(e.newValue);
  });
})();
