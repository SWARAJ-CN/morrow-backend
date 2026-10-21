(() => {
  const $ = (id) => document.getElementById(id);
  const gate = $('gate');
  const app = $('app');
  const toastEl = $('toast');
  let token = localStorage.getItem('morrow.admin.token') || '';
  let timer = null;

  function toast(message, kind) {
    toastEl.textContent = message;
    toastEl.className = 'toast show' + (kind ? ' ' + kind : '');
    clearTimeout(timer);
    timer = setTimeout(() => { toastEl.className = 'toast'; }, 2600);
  }

  async function api(path, options) {
    const response = await fetch('/api/admin' + path, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + token,
        ...(options && options.headers ? options.headers : {}),
      },
    });
    const text = await response.text();
    let data = {};
    try { data = text ? JSON.parse(text) : {}; } catch (error) { data = {}; }
    if (!response.ok) {
      const error = new Error(data.error || 'Something went wrong.');
      error.status = response.status;
      throw error;
    }
    return data;
  }

  function initials(name) {
    return String(name || '?')
      .split(/\s+/).filter(Boolean).slice(0, 2)
      .map((part) => part[0].toUpperCase()).join('') || '?';
  }

  function ago(value) {
    if (!value) return '—';
    const seconds = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 1000));
    if (seconds < 60) return seconds + 's ago';
    if (seconds < 3600) return Math.round(seconds / 60) + 'm ago';
    if (seconds < 86400) return Math.round(seconds / 3600) + 'h ago';
    return Math.round(seconds / 86400) + 'd ago';
  }

  function userRow(user) {
    const status = user.online
      ? '<span class="pill live"><span class="dot"></span>online</span>'
      : '<span class="pill off">' + ago(user.lastSeen) + '</span>';
    return '<tr>' +
      '<td><div class="name"><span class="avatar">' + initials(user.displayName) + '</span>' +
        '<div><div>' + (user.displayName || 'Unknown') + '</div>' +
        '<div class="muted" style="font-size:12px">' + (user.phone || '') + '</div></div></div></td>' +
      '<td>' + status + '</td>' +
      '<td class="muted">' + ago(user.joinedAt) + '</td>' +
      '</tr>';
  }

  function renderUsers(target, users, emptyText) {
    if (!users.length) {
      target.innerHTML = '<div class="empty">' + emptyText + '</div>';
      return;
    }
    target.innerHTML = '<table><thead><tr><th>User</th><th>Status</th><th>Joined</th></tr></thead><tbody>' +
      users.map(userRow).join('') + '</tbody></table>';
  }

  async function refresh() {
    try {
      const [users, settings, summary] = await Promise.all([
        api('/live-users'),
        api('/settings'),
        api('/summary'),
      ]);
      $('stats').innerHTML = [
        ['Users', summary.users],
        ['Live now', summary.live ?? users.liveCount],
        ['Stories', summary.stories],
        ['Messages', summary.messages],
      ].map(([label, value]) => '<div class="stat"><b>' + value + '</b><span>' + label + '</span></div>').join('');
      $('liveCount').textContent = users.liveCount;
      $('allCount').textContent = users.totalCount;
      renderUsers($('live'), users.live, 'Nobody is online right now.');
      renderUsers($('all'), users.all, 'No accounts yet.');
      if (document.activeElement !== $('invite')) $('invite').value = settings.inviteUrl || '';
    } catch (error) {
      if (error.status === 401) {
        lock();
        toast('That token was not accepted.', 'error');
      } else {
        toast(error.message || 'Could not load the data.', 'error');
      }
    }
  }

  function lock() {
    gate.hidden = false;
    app.hidden = true;
  }

  function unlock() {
    gate.hidden = true;
    app.hidden = false;
    localStorage.setItem('morrow.admin.token', token);
    refresh();
  }

  $('gateBtn').addEventListener('click', async () => {
    token = $('token').value.trim();
    if (!token) { toast('Paste a token first.', 'error'); return; }
    try {
      await api('/live-users');
      unlock();
    } catch (error) {
      toast(error.message || 'That token was not accepted.', 'error');
    }
  });

  $('token').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') $('gateBtn').click();
  });

  $('saveBtn').addEventListener('click', async () => {
    const value = $('invite').value.trim();
    $('saveBtn').disabled = true;
    try {
      await api('/settings/invite-url', { method: 'PUT', body: JSON.stringify({ inviteUrl: value }) });
      toast('Invite link saved.', 'ok');
    } catch (error) {
      toast(error.message || 'Could not save the link.', 'error');
    } finally {
      $('saveBtn').disabled = false;
    }
  });

  if (token) {
    $('token').value = token;
    unlock();
  }

  // Keep the live list fresh.
  setInterval(refresh, 5000);
})();
