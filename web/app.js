import { setToken, readManifest, fetchFile } from './github.js';

const $ = id => document.getElementById(id);

/* ===================== State ===================== */
let files = [];
let folderTree = null;
let currentPath = '';
let selected = new Set();
let expandedFolders = new Set(['']);
let viewMode = 'list';
let history = [];
let historyIndex = -1;
let currentPreviewFile = null;

/* ===================== Utils ===================== */
const ROOT_NAME = 'scripts box';

const size = n => {
  if (!n) return '—';
  const u = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  while (n >= 1024 && i < 3) { n /= 1024; i++; }
  return n.toFixed(i ? 1 : 0) + ' ' + u[i];
};

const bytes = n => {
  if (!n) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  while (n >= 1024 && i < 3) { n /= 1024; i++; }
  return n.toFixed(i ? 1 : 0) + ' ' + u[i];
};

const esc = s => String(s).replace(/[&<>\"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;'}[c]));

const fileIcon = path => {
  const ext = (path.split('.').pop() || '').toLowerCase();
  const map = {
    png:'🖼️', jpg:'🖼️', jpeg:'🖼️', gif:'🖼️', webp:'🖼️', svg:'🖼️', bmp:'🖼️', ico:'🖼️',
    mp4:'🎬', webm:'🎬', mov:'🎬', avi:'🎬', mkv:'🎬', flv:'🎬',
    mp3:'🎵', wav:'🎵', ogg:'🎵', flac:'🎵', m4a:'🎵', aac:'🎵',
    zip:'📦', rar:'📦', '7z':'📦', tar:'📦', gz:'📦', bz2:'📦',
    json:'📋', csv:'📋', xlsx:'📋', xls:'📋', ods:'📋',
    md:'📝', txt:'📝', doc:'📝', docx:'📝', rtf:'📝',
    pdf:'📕',
    py:'🐍', js:'📜', ts:'📜', jsx:'📜', tsx:'📜', mjs:'📜', cjs:'📜',
    html:'🌐', htm:'🌐', css:'🎨', scss:'🎨', less:'🎨',
    yaml:'⚙️', yml:'⚙️', xml:'⚙️', toml:'⚙️', ini:'⚙️', conf:'⚙️',
    sh:'⚙️', bat:'⚙️', ps1:'⚙️', cmd:'⚙️',
    c:'💻', cpp:'💻', h:'💻', java:'💻', go:'💻', rs:'💻', rb:'💻', php:'💻',
  };
  return map[ext] || '📄';
};

/* ===================== Tree building ===================== */
function buildTree() {
  const root = { name: ROOT_NAME, path: '', children: {}, files: [] };
  for (const f of files) {
    const parts = f.path.split('/');
    let node = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      if (!node.children[part]) {
        node.children[part] = { name: part, path: parts.slice(0, i + 1).join('/'), children: {}, files: [] };
      }
      node = node.children[part];
    }
    if (parts.length > 1) node.files.push(f);
    else root.files.push(f);
  }
  // post-order: compute total size (sum of all files recursively) for each folder
  function computeSize(node) {
    let total = 0;
    for (const f of node.files) total += f.size || 0;
    for (const child of Object.values(node.children)) total += computeSize(child);
    node.totalSize = total;
    return total;
  }
  computeSize(root);
  return root;
}

function findNode(path) {
  if (!path) return folderTree;
  const parts = path.split('/');
  let node = folderTree;
  for (const p of parts) {
    if (!node.children[p]) return null;
    node = node.children[p];
  }
  return node;
}

function getChildren(path) {
  const node = findNode(path);
  if (!node) return { folders: [], files: [] };
  const folders = Object.values(node.children).sort((a, b) => a.name.localeCompare(b.name, 'zh'));
  const fls = [...node.files].sort((a, b) => a.path.localeCompare(b.path, 'zh'));
  return { folders, files: fls };
}

function getFilesRecursive(path) {
  const node = findNode(path);
  if (!node) return [];
  let result = [...node.files];
  for (const child of Object.values(node.children)) {
    result = result.concat(getFilesRecursive(child.path));
  }
  return result;
}

// Returns { checked, indeterminate } for a folder based on its files' selection
function getFolderCheckState(path) {
  const all = getFilesRecursive(path);
  if (all.length === 0) return { checked: false, indeterminate: false };
  const selCount = all.filter(f => selected.has(f.path)).length;
  if (selCount === 0) return { checked: false, indeterminate: false };
  if (selCount === all.length) return { checked: true, indeterminate: false };
  return { checked: false, indeterminate: true };
}

// Returns { checked, indeterminate } for the "select all" control over a list of items
function getSelectAllState(items) {
  if (items.length === 0) return { checked: false, indeterminate: false };
  let selCount = 0;
  let partial = false;
  for (const item of items) {
    if (item.isFolder) {
      const st = getFolderCheckState(item.path);
      if (st.checked) selCount++;
      else if (st.indeterminate) partial = true;
    } else {
      if (selected.has(item.path)) selCount++;
    }
  }
  if (selCount === 0 && !partial) return { checked: false, indeterminate: false };
  if (selCount === items.length && !partial) return { checked: true, indeterminate: false };
  return { checked: false, indeterminate: true };
}

/* ===================== Navigation ===================== */
function navigate(path, pushHistory = true) {
  currentPath = path;
  if (pushHistory) {
    history = history.slice(0, historyIndex + 1);
    history.push(path);
    historyIndex = history.length - 1;
  }
  renderBreadcrumbs();
  renderTree();
  renderFileList();
}

function goBack() {
  if (historyIndex > 0) { historyIndex--; navigate(history[historyIndex], false); }
}
function goForward() {
  if (historyIndex < history.length - 1) { historyIndex++; navigate(history[historyIndex], false); }
}
function goUp() {
  if (!currentPath) return;
  const parts = currentPath.split('/');
  parts.pop();
  navigate(parts.join('/'));
}

/* ===================== Breadcrumbs ===================== */
function renderBreadcrumbs() {
  const parts = currentPath ? currentPath.split('/') : [];
  let html = `<span class="crumb" data-path="">${esc(ROOT_NAME)}</span>`;
  let cur = '';
  for (const p of parts) {
    cur = cur ? cur + '/' + p : p;
    html += '<span class="crumb-sep">/</span>';
    html += `<span class="crumb" data-path="${esc(cur)}">${esc(p)}</span>`;
  }
  $('crumbs').innerHTML = html;
  const crumbs = $('crumbs').querySelectorAll('.crumb');
  crumbs.forEach(c => { c.onclick = () => navigate(c.dataset.path); });
  if (crumbs.length) crumbs[crumbs.length - 1].classList.add('current');
}

/* ===================== Tree ===================== */
function renderTree() {
  const container = $('tree');
  container.innerHTML = '';
  container.appendChild(renderTreeNode(folderTree, 0));
}

function renderTreeNode(node, depth) {
  const wrap = document.createElement('div');
  const el = document.createElement('div');
  el.className = 'tree-node' + (node.path === currentPath ? ' active' : '');

  const hasChildren = Object.keys(node.children).length > 0;
  const twisty = document.createElement('span');
  twisty.className = 'twisty';
  twisty.textContent = hasChildren ? (expandedFolders.has(node.path) ? '▾' : '▸') : '';
  twisty.onclick = e => {
    e.stopPropagation();
    if (expandedFolders.has(node.path)) expandedFolders.delete(node.path);
    else expandedFolders.add(node.path);
    renderTree();
  };

  const icon = document.createElement('span');
  icon.className = 'folder-icon';
  icon.textContent = expandedFolders.has(node.path) ? '📂' : '📁';

  const name = document.createElement('span');
  name.className = 'node-name';
  name.textContent = node.name;

  const sz = document.createElement('span');
  sz.className = 'node-size';
  sz.textContent = size(node.totalSize || 0);

  el.appendChild(twisty);
  el.appendChild(icon);
  el.appendChild(name);
  el.appendChild(sz);
  el.style.paddingLeft = (6 + depth * 14) + 'px';
  el.onclick = () => navigate(node.path);

  wrap.appendChild(el);

  if (hasChildren && expandedFolders.has(node.path)) {
    const childWrap = document.createElement('div');
    childWrap.className = 'tree-children';
    Object.values(node.children)
      .sort((a, b) => a.name.localeCompare(b.name, 'zh'))
      .forEach(child => childWrap.appendChild(renderTreeNode(child, depth + 1)));
    wrap.appendChild(childWrap);
  }
  return wrap;
}

/* ===================== File list ===================== */
function renderFileList() {
  const list = $('fileList');
  list.className = 'file-list ' + viewMode + '-view';
  list.innerHTML = '';

  const q = $('search').value.trim().toLowerCase();
  let items;

  if (q) {
    // search across all files
    const matches = files.filter(f => f.path.toLowerCase().includes(q));
    items = matches.map(f => ({ ...f, isFolder: false, displayPath: f.path }));
  } else {
    const { folders, files: fls } = getChildren(currentPath);
    items = [
      ...folders.map(f => ({ ...f, isFolder: true, displayPath: f.path })),
      ...fls.map(f => ({ ...f, isFolder: false, displayPath: f.path }))
    ];
  }

  if (items.length === 0) {
    list.classList.add('hidden');
    $('emptyState').classList.remove('hidden');
    $('emptyState').querySelector('.empty-text').textContent = q ? '没有匹配的文件' : '该文件夹为空';
    return;
  }
  list.classList.remove('hidden');
  $('emptyState').classList.add('hidden');

  if (viewMode === 'list') {
    const header = document.createElement('div');
    header.className = 'list-header';

    // select-all checkbox
    const allCb = document.createElement('input');
    allCb.type = 'checkbox';
    allCb.className = 'checkbox select-all';
    const allState = getSelectAllState(items);
    allCb.checked = allState.checked;
    allCb.indeterminate = allState.indeterminate;
    allCb.onchange = () => {
      if (allCb.checked) {
        for (const item of items) {
          if (item.isFolder) getFilesRecursive(item.path).forEach(f => selected.add(f.path));
          else selected.add(item.path);
        }
      } else {
        for (const item of items) {
          if (item.isFolder) getFilesRecursive(item.path).forEach(f => selected.delete(f.path));
          else selected.delete(item.path);
        }
      }
      updateSelectionUI();
      renderFileList();
    };

    const hIcon = document.createElement('span');
    const hName = document.createElement('span'); hName.textContent = '名称';
    const hSize = document.createElement('span'); hSize.textContent = '大小';
    const hType = document.createElement('span'); hType.textContent = '类型';
    const hStorage = document.createElement('span'); hStorage.textContent = '存储';
    header.appendChild(allCb);
    header.appendChild(hIcon);
    header.appendChild(hName);
    header.appendChild(hSize);
    header.appendChild(hType);
    header.appendChild(hStorage);
    list.appendChild(header);

    for (const item of items) {
      const row = document.createElement('div');
      row.className = 'file-row';
      if (!item.isFolder && selected.has(item.path)) row.classList.add('selected');

      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.className = 'checkbox';
      if (item.isFolder) {
        const st = getFolderCheckState(item.path);
        cb.checked = st.checked;
        cb.indeterminate = st.indeterminate;
      } else {
        cb.checked = selected.has(item.path);
      }
      cb.onclick = e => e.stopPropagation();
      cb.onchange = () => {
        if (item.isFolder) {
          const all = getFilesRecursive(item.path);
          if (cb.checked) all.forEach(f => selected.add(f.path));
          else all.forEach(f => selected.delete(f.path));
        } else {
          if (cb.checked) selected.add(item.path);
          else selected.delete(item.path);
        }
        updateSelectionUI();
        renderFileList();
      };

      const icon = document.createElement('span');
      icon.className = 'file-icon';
      icon.textContent = item.isFolder ? '📁' : fileIcon(item.path);

      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = item.isFolder ? item.name : item.path.split('/').pop();
      if (q && item.isFolder) {
        name.title = item.path;
      }

      const sizeEl = document.createElement('span');
      sizeEl.className = 'meta';
      sizeEl.textContent = item.isFolder ? size(item.totalSize || 0) : size(item.size);

      const typeEl = document.createElement('span');
      typeEl.className = 'meta';
      if (item.isFolder) typeEl.textContent = '文件夹';
      else {
        const ext = item.path.split('.').pop();
        typeEl.textContent = ext === item.path ? '文件' : ext.toUpperCase();
      }

      const storageEl = document.createElement('span');
      storageEl.className = 'meta';
      storageEl.textContent = item.isFolder ? '—' : (item.storage === 'release' ? '媒体' : 'Git');

      row.appendChild(cb);
      row.appendChild(icon);
      row.appendChild(name);
      row.appendChild(sizeEl);
      row.appendChild(typeEl);
      row.appendChild(storageEl);

      row.onclick = e => {
        if (e.target === cb) return;
        if (item.isFolder) navigate(item.path);
        else { preview(item); row.classList.add('selected'); }
      };
      row.ondblclick = e => {
        if (e.target === cb) return;
        if (item.isFolder) navigate(item.path);
        else downloadRecord(item);
      };

      list.appendChild(row);
    }
  } else {
    // grid view — add a select-all bar above the cards
    const bar = document.createElement('div');
    bar.className = 'grid-toolbar';
    const allCb = document.createElement('input');
    allCb.type = 'checkbox';
    allCb.className = 'checkbox';
    const allState = getSelectAllState(items);
    allCb.checked = allState.checked;
    allCb.indeterminate = allState.indeterminate;
    allCb.onchange = () => {
      if (allCb.checked) {
        for (const item of items) {
          if (item.isFolder) getFilesRecursive(item.path).forEach(f => selected.add(f.path));
          else selected.add(item.path);
        }
      } else {
        for (const item of items) {
          if (item.isFolder) getFilesRecursive(item.path).forEach(f => selected.delete(f.path));
          else selected.delete(item.path);
        }
      }
      updateSelectionUI();
      renderFileList();
    };
    const label = document.createElement('span');
    label.className = 'grid-toolbar-label';
    label.textContent = '全选';
    label.onclick = () => allCb.click();
    bar.appendChild(allCb);
    bar.appendChild(label);
    list.appendChild(bar);

    for (const item of items) {
      const card = document.createElement('div');
      card.className = 'file-card';
      if (!item.isFolder && selected.has(item.path)) card.classList.add('selected');

      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.className = 'card-checkbox';
      if (item.isFolder) {
        const st = getFolderCheckState(item.path);
        cb.checked = st.checked;
        cb.indeterminate = st.indeterminate;
      } else {
        cb.checked = selected.has(item.path);
      }
      cb.onchange = () => {
        if (item.isFolder) {
          const all = getFilesRecursive(item.path);
          if (cb.checked) all.forEach(f => selected.add(f.path));
          else all.forEach(f => selected.delete(f.path));
        } else {
          if (cb.checked) selected.add(item.path);
          else selected.delete(item.path);
        }
        updateSelectionUI();
        renderFileList();
      };
      cb.onclick = e => e.stopPropagation();

      const displayName = item.isFolder ? item.name : item.path.split('/').pop();

      card.innerHTML = `
        <div class="card-icon">${item.isFolder ? '📁' : fileIcon(item.path)}</div>
        <div class="card-name">${esc(displayName)}</div>
        <div class="card-size">${item.isFolder ? size(item.totalSize || 0) : size(item.size)}</div>
      `;
      card.insertBefore(cb, card.firstChild);

      card.onclick = e => {
        if (e.target === cb) return;
        if (item.isFolder) navigate(item.path);
        else { preview(item); card.classList.add('selected'); }
      };
      card.ondblclick = e => {
        if (e.target === cb) return;
        if (item.isFolder) navigate(item.path);
        else downloadRecord(item);
      };

      list.appendChild(card);
    }
  }
}

/* ===================== Preview ===================== */
function syncResizer() {
  const pv = $('preview');
  const rz = $('previewResizer');
  if (rz) rz.style.display = pv.classList.contains('collapsed') ? 'none' : '';
}

async function preview(f) {
  if (!f) return;
  currentPreviewFile = f;
  // ensure preview panel is visible
  $('preview').classList.remove('collapsed');
  $('togglePreview').classList.add('active');
  syncResizer();

  const body = $('previewBody');
  const dlBtn = $('downloadOne');
  dlBtn.disabled = false;

  body.innerHTML = `
    <h3>${esc(f.path.split('/').pop())}</h3>
    <div class="preview-meta">${f.storage === 'release' ? '媒体文件' : 'Git 文件'} · ${size(f.size)} · ${esc(f.path)}</div>
    <div id="previewContent">正在读取…</div>
  `;

  try {
    const r = await fetchFile(f);
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    const ext = (f.path.split('.').pop() || '').toLowerCase();
    const content = $('previewContent');

    if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico'].includes(ext)) {
      content.innerHTML = `<img src="${url}" alt="">`;
    } else if (['mp4', 'webm', 'mov', 'avi', 'mkv'].includes(ext)) {
      content.innerHTML = `<video controls src="${url}"></video>`;
    } else if (['mp3', 'wav', 'ogg', 'flac', 'm4a', 'aac'].includes(ext)) {
      content.innerHTML = `<audio controls src="${url}"></audio>`;
    } else if (blob.size > 500 * 1024) {
      content.innerHTML = `<pre>文件过大，无法在预览中显示文本内容（${size(blob.size)}）。\n请点击下方按钮下载查看。</pre>`;
    } else {
      const text = await blob.text();
      content.innerHTML = `<pre>${esc(text)}</pre>`;
    }
    dlBtn.onclick = () => downloadRecord(f);
  } catch (e) {
    $('previewContent').textContent = '无法预览：' + e.message;
  }
}

/* ===================== Download ===================== */
function download(url, name) {
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
}

async function downloadRecord(f) {
  $('status').textContent = `正在下载 ${f.path.split('/').pop()}…`;
  try {
    download(URL.createObjectURL(await (await fetchFile(f)).blob()), f.path.split('/').pop());
    $('status').textContent = `已开始下载 ${f.path.split('/').pop()}`;
  } catch (e) {
    $('status').textContent = '下载失败：' + e.message;
  }
}

async function zipFiles(chosen, name) {
  if (!window.JSZip) { $('status').textContent = 'ZIP 组件加载失败'; return; }
  const z = new JSZip();
  $('status').textContent = `正在打包 ${chosen.length} 个文件…`;
  for (const f of chosen) {
    const blob = await (await fetchFile(f)).blob();
    // use path relative to root for cleaner zip structure
    const rel = f.path.startsWith(ROOT_NAME + '/') ? f.path.slice(ROOT_NAME.length + 1) : f.path;
    z.file(rel, blob);
  }
  download(URL.createObjectURL(await z.generateAsync({ type: 'blob' })), name);
  $('status').textContent = `已生成 ${name}`;
}

async function downloadSelected() {
  const chosen = files.filter(f => selected.has(f.path));
  if (!chosen.length) { $('status').textContent = '请先勾选文件'; return; }
  if (chosen.length === 1) downloadRecord(chosen[0]);
  else zipFiles(chosen, 'scripts-box-selected.zip');
}

async function downloadCurrentFolder() {
  const all = getFilesRecursive(currentPath);
  if (!all.length) { $('status').textContent = '当前文件夹没有可下载的文件'; return; }
  const name = (currentPath.split('/').pop() || ROOT_NAME) + '.zip';
  zipFiles(all, name);
}

/* ===================== Selection UI ===================== */
function updateSelectionUI() {
  const count = selected.size;
  const btn = $('downloadSelected');
  btn.textContent = `下载选中 (${count})`;
  btn.disabled = count === 0;
}

/* ===================== Progress ===================== */
function progress(p) {
  const bar = $('progressBar'), wrap = $('progressWrap');
  if (!bar || !wrap) return;
  wrap.classList.remove('hidden');
  if (p.total) {
    bar.classList.remove('indeterminate');
    bar.style.width = Math.min(100, p.loaded / p.total * 100) + '%';
  } else {
    bar.classList.add('indeterminate');
  }
  const phase = p.phase;
  if (phase === 'parsing') {
    $('status').textContent = '正在解析云端清单…';
  } else if (p.total) {
    const done = p.loaded >= p.total;
    $('status').textContent = (done ? '正在处理' : '正在读取') + `云端清单：${bytes(p.loaded)} / ${bytes(p.total)}`;
  } else {
    $('status').textContent = `正在读取云端清单：${bytes(p.loaded)}`;
  }
}

/* ===================== Init ===================== */
async function init() {
  try {
    progress({ loaded: 0, total: 0, phase: 'connecting' });
    const m = await readManifest(progress);
    files = m.files || [];
    folderTree = buildTree();
    $('status').textContent = `已读取 ${files.length} 个云端文件`;
    $('progressWrap').classList.add('hidden');
    navigate('');
  } catch (e) {
    $('progressWrap').classList.add('hidden');
    const msg = e.message === 'Failed to fetch'
      ? '网络请求失败，请检查代理/VPN 或令牌权限'
      : e.message;
    $('status').textContent = '读取失败：' + msg;
    // show error in file area
    const es = $('emptyState');
    es.classList.remove('hidden');
    $('fileList').classList.add('hidden');
    es.querySelector('.empty-icon').textContent = '⚠️';
    es.querySelector('.empty-text').textContent = '读取失败：' + msg;
  }
}

/* ===================== Event bindings ===================== */
$('refreshBtn').onclick = init;
$('tokenBtn').onclick = () => $('tokenDialog').showModal();
$('saveToken').onclick = () => {
  setToken($('tokenInput').value);
  $('tokenDialog').close();
  init();
};
$('search').oninput = renderFileList;
$('backBtn').onclick = goBack;
$('forwardBtn').onclick = goForward;
$('upBtn').onclick = goUp;

$('viewList').onclick = () => {
  viewMode = 'list';
  $('viewList').classList.add('active');
  $('viewGrid').classList.remove('active');
  renderFileList();
};
$('viewGrid').onclick = () => {
  viewMode = 'grid';
  $('viewGrid').classList.add('active');
  $('viewList').classList.remove('active');
  renderFileList();
};

$('toggleSidebar').onclick = () => {
  const sb = $('sidebar');
  sb.classList.toggle('collapsed');
  $('toggleSidebar').classList.toggle('active', !sb.classList.contains('collapsed'));
};
$('togglePreview').onclick = () => {
  const pv = $('preview');
  pv.classList.toggle('collapsed');
  $('togglePreview').classList.toggle('active', !pv.classList.contains('collapsed'));
  syncResizer();
};
$('closePreview').onclick = () => {
  $('preview').classList.add('collapsed');
  $('togglePreview').classList.remove('active');
  syncResizer();
};

/* ===================== Resizer drag ===================== */
(function initResizer() {
  const rz = $('previewResizer');
  const pv = $('preview');
  if (!rz || !pv) return;
  let dragging = false;
  const MIN = 200, MAX = 700;

  rz.addEventListener('mousedown', e => {
    dragging = true;
    rz.classList.add('active');
    document.body.classList.add('resizing');
    e.preventDefault();
  });

  document.addEventListener('mousemove', e => {
    if (!dragging) return;
    const rect = pv.getBoundingClientRect();
    let w = rect.right - e.clientX;
    w = Math.max(MIN, Math.min(MAX, w));
    pv.style.width = w + 'px';
    pv.style.minWidth = w + 'px';
  });

  document.addEventListener('mouseup', () => {
    if (!dragging) return;
    dragging = false;
    rz.classList.remove('active');
    document.body.classList.remove('resizing');
  });
})();

$('downloadSelected').onclick = downloadSelected;
$('downloadFolder').onclick = downloadCurrentFolder;

$('themeBtn').onclick = () => {
  document.body.classList.toggle('light');
  $('themeBtn').textContent = document.body.classList.contains('light') ? '☾' : '☀';
};

init();
