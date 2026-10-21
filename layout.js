// UI placement only: retain the existing controls, IDs and data handlers.
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const brand = document.querySelector('.sidebar .brand');
  const fetched = new Map();
  const renderBrand = () => {
    const view = document.querySelector('[data-view][aria-current]')?.dataset.view || 'calendar';
    brand.textContent = `Family_最終取得${fetched.get(view) || '----'}_vol_1.0.0`;
  };
  for (const view of ['calendar', 'notes', 'checklists']) {
    const notice = $(`${view}-notice`);
    const update = () => {
      const isFetch = notice.textContent.startsWith('最終取得 ');
      if (isFetch) {
        const parts = new Intl.DateTimeFormat('en-US', {timeZone:'Asia/Tokyo',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
        fetched.set(view, parts.find(p=>p.type==='month').value + parts.find(p=>p.type==='day').value);
        notice.hidden = true;
      } else if (notice.textContent) notice.hidden = false;
      renderBrand();
    };
    new MutationObserver(update).observe(notice, {childList:true,subtree:true,characterData:true});
  }
  new MutationObserver(renderBrand).observe(document.querySelector('.sidebar nav'), {subtree:true,attributes:true,attributeFilter:['aria-current']});
  renderBrand();
  const settings = $('settings-dialog');
  const closeSettings = () => settings.close();
  $('settings-open').addEventListener('click', () => { navUpdate(); settings.showModal(); });
  $('settings-close').addEventListener('click', closeSettings);
  $('settings-account').append(document.querySelector('.account'));
  $('settings-theme').append($('theme'));
  $('backup-open').addEventListener('click', closeSettings);
  $('logout').addEventListener('click', closeSettings);

  for (const [view, top, tools, create] of [
    ['calendar', '.calendar-topline', '.calendar-filters', 'new-event'],
    ['notes', '#notes .notes-top', '#notes .notes-tools', 'notes-new'],
    ['checklists', '#checklists .notes-top', '#checklists .notes-tools', 'checklists-new']
  ]) {
    const section = $(view), group = document.createElement('section');
    group.className = 'settings-group'; group.dataset.settingsView = view;
    const heading = document.createElement('h3');
    heading.textContent = {calendar:'カレンダー',notes:'メモ',checklists:'チェックリスト'}[view];
    group.append(heading, document.querySelector(top));
    $('settings-groups').append(group);

    const bar = document.createElement('div'); bar.className = 'quick-tools';
    const toggle = document.createElement('button'); toggle.type = 'button'; toggle.className = 'quiet';
    toggle.textContent = '検索'; toggle.id = `${view}-filters-open`;
    const dialog = document.createElement('dialog'); dialog.id = `${view}-filters-dialog`;
    const header = document.createElement('header'); header.className = 'dialog-heading';
    const title = document.createElement('h2'); title.textContent = `${heading.textContent}の検索`;
    title.id = `${view}-filters-title`; dialog.setAttribute('aria-labelledby', title.id);
    const done = document.createElement('button'); done.type = 'button'; done.className = 'quiet'; done.textContent = '表示する';
    header.append(title, done); dialog.append(header);
    const filters = document.querySelector(tools);
    if (view !== 'calendar') bar.append($(create));
    dialog.append(filters); section.append(dialog);
    toggle.addEventListener('click', () => dialog.showModal());
    done.addEventListener('click', () => dialog.close());
    const update = () => {
      const active = [...filters.querySelectorAll('input,select')].some(n => n.type === 'checkbox' ? n.checked : !!n.value.trim());
      toggle.textContent = active ? '検索 ●' : '検索';
      toggle.setAttribute('aria-label', active ? '検索・絞り込み（適用中）' : '検索・絞り込み');
    };
    filters.addEventListener('input', update); filters.addEventListener('change', update);
    const reset = document.createElement('button'); reset.type = 'button'; reset.className = 'quiet'; reset.textContent = '条件を解除';
    reset.addEventListener('click', () => { for (const n of filters.querySelectorAll('input,select')) { if(n.type === 'checkbox') n.checked = false; else n.value = ''; n.dispatchEvent(new Event('input', {bubbles:true})); n.dispatchEvent(new Event('change', {bubbles:true})); } update(); });
    filters.append(reset); bar.append(toggle);
    if (view === 'calendar') document.querySelector('.calendar-actions').append(toggle);
    else section.prepend(bar);
    // Category management belongs to settings; close its parent before opening an editor.
    const category = $(view === 'calendar' ? 'open-category' : `${view}-category`);
    group.append(category); category.addEventListener('click', closeSettings);
  }
  const navUpdate = () => {
    const view = document.querySelector('[data-view][aria-current]')?.dataset.view || 'calendar';
    for (const group of document.querySelectorAll('[data-settings-view]')) group.hidden = group.dataset.settingsView !== view;
  };
  document.querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', () => queueMicrotask(navUpdate)));
  navUpdate();
  // Keep checklist items near the top; supplementary fields remain editable.
  const extra = document.createElement('details');
  extra.className = 'note-extra';
  const summary = document.createElement('summary'); summary.textContent = '補足・カテゴリ・詳細';
  extra.append(summary);
  const form = $('note-form'), content = $('note-content');
  form.insertBefore(extra, content.previousElementSibling);
  extra.append(content.previousElementSibling, content, form.querySelector('.note-options'), form.querySelector('.field-hint'), $('note-metadata'));
  const editorMode = () => { extra.open = $('note-checklist').hidden; };
  new MutationObserver(editorMode).observe($('note-checklist'), {attributes:true,attributeFilter:['hidden']});
  editorMode();
  // visualViewport follows Safari's keyboard; dvh remains the fallback.
  const resize = () => {
    if (window.visualViewport) {
      document.documentElement.style.setProperty('--app-height', `${window.visualViewport.height}px`);
      document.documentElement.style.setProperty('--app-top', `${window.visualViewport.offsetTop}px`);
    }
  };
  window.visualViewport?.addEventListener('resize', resize);
  window.visualViewport?.addEventListener('scroll', resize);
  window.addEventListener('resize', resize); resize();
  new MutationObserver(() => {
    if ($('app').hidden) { fetched.clear(); renderBrand(); for (const d of document.querySelectorAll('dialog[open]')) d.close(); }
  }).observe($('app'), {attributes:true,attributeFilter:['hidden']});
})();
