async function waitForDb(timeout = 5000) {
  const start = Date.now();
  while (!window.db) {
    if (Date.now() - start > timeout) throw new Error('Supabase init timeout');
    await new Promise(r => setTimeout(r, 50));
  }
}

let currentUser = null;
let currentProfile = null;
let feedMode = 'latest';
let pollVisible = false;
let activeGifPicker = null;
let selectedMediaFiles = [];
let selectedCheckin = null;
let linkPreviewData = null;
let linkPreviewTimeout = null;
let liveSubscription = null;
let photoTags = [];

const REACTIONS = [
  { type: 'like', emoji: '❤️', label: 'Like' },
  { type: 'haha', emoji: '😂', label: 'Haha' },
  { type: 'wow', emoji: '😮', label: 'Wow' },
  { type: 'sad', emoji: '😢', label: 'Sad' },
  { type: 'angry', emoji: '😡', label: 'Angry' },
  { type: 'downvote', emoji: '👎', label: 'Downvote' }
];

function getVerifiedBadge(profile) {
  if (!profile?.is_verified) return '';
  const badges = {
    staff:    '<span title="Voxxee Staff" style="font-size:14px;cursor:default;">🟣</span>',
    notable:  '<span title="Notable Account" style="font-size:14px;cursor:default;">⭐</span>',
    identity: '<span title="ID Verified" style="font-size:14px;cursor:default;">🔵</span>',
  };
  return badges[profile.verified_type] || badges.identity;
}

function avatarHtml(profile, size = 40) {
  const username = profile?.username || '?';
  const initial = username.charAt(0).toUpperCase();
  const avatarUrl = profile?.avatar_url || '';
  if (avatarUrl) {
    return `<img src="${escapeHtml(avatarUrl)}" alt="${escapeHtml(username)}"
      style="width:${size}px;height:${size}px;border-radius:50%;object-fit:cover;flex-shrink:0;cursor:pointer;"
      onerror="this.style.display='none';this.nextElementSibling.style.display='flex';" />
      <div class="post-avatar" style="display:none;width:${size}px;height:${size}px;cursor:pointer;">${initial}</div>`;
  }
  return `<div class="post-avatar" style="width:${size}px;height:${size}px;cursor:pointer;">${initial}</div>`;
}

document.addEventListener('DOMContentLoaded', async () => {
  await waitForDb();

  const { data: { session } } = await window.db.auth.getSession();
  if (!session?.user) {
    window.location.href = '/login.html';
    return;
  }
  currentUser = session.user;

  const { data: profile } = await window.db
    .from('profiles').select('*').eq('user_id', currentUser.id).single();

  currentProfile = profile;

  if (profile) {
    const avatarEl = document.getElementById('current-user-avatar');
    if (avatarEl) {
      if (profile.avatar_url) {
        avatarEl.innerHTML = `<img src="${escapeHtml(profile.avatar_url)}" style="width:100%;height:100%;border-radius:50%;object-fit:cover;" onerror="this.textContent='${profile.username.charAt(0).toUpperCase()}';this.style.display='flex';" />`;
      } else {
        avatarEl.textContent = profile.username.charAt(0).toUpperCase();
      }
    }
  }

  initMentionAutocomplete('post-content', 'post-mention-dropdown');
  setupMediaUpload();
  setupCheckin();
  setupLinkPreview();

  await Promise.all([
    loadFeed(),
    loadSidebarCommunities(),
    loadTrendingCommunities(),
    loadEcosystemSidebar(),
    loadNotifBadge(),
    loadBirthdays(),
    loadLiveBanner()
  ]);

  setupEventListeners();
  subscribeToLiveSessions();

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.reaction-btn-wrapper')) {
      document.querySelectorAll('.reaction-picker').forEach(p => p.style.display = 'none');
    }
    if (!e.target.closest('.post-menu-wrapper')) {
      document.querySelectorAll('.post-menu-dropdown').forEach(m => m.style.display = 'none');
    }
    if (!e.target.closest('.gif-picker-wrapper')) {
      document.querySelectorAll('.gif-picker-panel').forEach(p => p.style.display = 'none');
      activeGifPicker = null;
    }
    if (!e.target.closest('.diagnostics-panel') && !e.target.closest('.view-label-btn')) {
      document.querySelectorAll('.diagnostics-panel').forEach(p => p.style.display = 'none');
    }
    if (!e.target.closest('.tag-search-dropdown') && !e.target.closest('.tag-overlay-wrap')) {
      document.querySelectorAll('.tag-search-dropdown').forEach(d => d.remove());
    }
  });
});

// ─── LIVE BANNER ─────────────────────────────────────────────────────────────

async function loadLiveBanner() {
  const banner = document.getElementById('feed-live-banner');
  if (!banner || !currentUser) return;
  try {
    const { data: follows } = await window.db
      .from('follows').select('following_id').eq('follower_id', currentUser.id);
    const followingIds = follows ? follows.map(f => f.following_id) : [];
    if (followingIds.length === 0) { banner.style.display = 'none'; return; }

    const { data: sessions } = await window.db
      .from('live_sessions')
      .select('id, host_user_id, title, viewer_count, started_at')
      .eq('is_active', true)
      .in('host_user_id', followingIds)
      .order('started_at', { ascending: false });

    if (!sessions || sessions.length === 0) { banner.style.display = 'none'; return; }

    const hostIds = sessions.map(s => s.host_user_id);
    const { data: profiles } = await window.db
      .from('profiles').select('user_id, username, display_name').in('user_id', hostIds);
    const profileMap = {};
    if (profiles) profiles.forEach(p => { profileMap[p.user_id] = p; });

    const items = sessions.slice(0, 3).map(session => {
      const profile = profileMap[session.host_user_id];
      const username = profile?.username || 'someone';
      const displayName = profile?.display_name || username;
      const viewers = session.viewer_count || 0;
      return `
        <a href="/profile.html?user=${encodeURIComponent(username)}"
          style="display:flex;align-items:center;gap:10px;padding:10px 14px;background:var(--bg-card);border:1px solid rgba(0,229,255,0.2);border-radius:10px;text-decoration:none;flex-shrink:0;min-width:200px;max-width:280px;">
          <div style="width:8px;height:8px;border-radius:50%;background:#ff3b3b;animation:livepulse 1.2s infinite;flex-shrink:0;"></div>
          <div style="min-width:0;">
            <div style="font-size:13px;font-weight:700;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(displayName)}</div>
            ${session.title ? `<div style="font-size:12px;color:var(--text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(session.title)}</div>` : ''}
          </div>
          <div style="margin-left:auto;font-size:11px;color:var(--text-muted);white-space:nowrap;flex-shrink:0;">👁 ${viewers}</div>
        </a>
      `;
    }).join('');

    banner.innerHTML = `
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;">
        <div style="width:8px;height:8px;border-radius:50%;background:#ff3b3b;animation:livepulse 1.2s infinite;flex-shrink:0;"></div>
        <span style="font-size:13px;font-weight:700;color:var(--text);">Live Now</span>
        <span style="font-size:12px;color:var(--text-muted);">${sessions.length} stream${sessions.length !== 1 ? 's' : ''} from people you follow</span>
      </div>
      <div style="display:flex;gap:8px;overflow-x:auto;scrollbar-width:none;padding-bottom:2px;">${items}</div>
    `;
    banner.style.display = 'block';
  } catch (err) {
    console.error('Live banner error:', err);
    banner.style.display = 'none';
  }
}

function subscribeToLiveSessions() {
  if (liveSubscription) liveSubscription.unsubscribe();
  liveSubscription = window.db
    .channel('feed-live-sessions')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'live_sessions' }, () => {
      loadLiveBanner();
    })
    .subscribe();
}

// ─── PHOTO TAGGING ───────────────────────────────────────────────────────────

function setupPhotoTagging(mediaIndex) {
  const wrap = document.querySelector(`.tag-overlay-wrap[data-media-index="${mediaIndex}"]`);
  if (!wrap) return;

  wrap.addEventListener('click', (e) => {
    document.querySelectorAll('.tag-search-dropdown').forEach(d => d.remove());

    const rect = wrap.getBoundingClientRect();
    const xPercent = ((e.clientX - rect.left) / rect.width * 100).toFixed(1);
    const yPercent = ((e.clientY - rect.top) / rect.height * 100).toFixed(1);

    const pin = document.createElement('div');
    pin.className = 'tag-pin-temp';
    pin.style.cssText = `position:absolute;left:${xPercent}%;top:${yPercent}%;transform:translate(-50%,-50%);width:24px;height:24px;border-radius:50%;background:var(--primary);border:2px solid #fff;z-index:10;pointer-events:none;`;
    wrap.appendChild(pin);

    const dropdown = document.createElement('div');
    dropdown.className = 'tag-search-dropdown';
    dropdown.style.cssText = `position:absolute;left:${Math.min(parseFloat(xPercent), 70)}%;top:${Math.min(parseFloat(yPercent) + 5, 80)}%;background:var(--bg-card);border:1px solid var(--border);border-radius:10px;box-shadow:0 4px 20px rgba(0,0,0,0.4);z-index:20;width:220px;overflow:hidden;`;
    dropdown.innerHTML = `
      <div style="padding:8px;">
        <input type="text" class="form-input tag-user-search" placeholder="Search users..." style="font-size:13px;width:100%;" autocomplete="off" />
      </div>
      <div class="tag-user-results" style="max-height:180px;overflow-y:auto;"></div>
    `;
    wrap.appendChild(dropdown);

    const input = dropdown.querySelector('.tag-user-search');
    const results = dropdown.querySelector('.tag-user-results');
    input.focus();

    let searchTimeout;
    input.addEventListener('input', () => {
      clearTimeout(searchTimeout);
      const q = input.value.trim();
      if (q.length < 1) { results.innerHTML = ''; return; }
      searchTimeout = setTimeout(() => searchUsersForTag(q, results, mediaIndex, xPercent, yPercent, pin, dropdown), 300);
    });

    e.stopPropagation();
  });
}

async function searchUsersForTag(query, resultsEl, mediaIndex, xPercent, yPercent, pin, dropdown) {
  resultsEl.innerHTML = '<div style="padding:10px;font-size:13px;color:var(--text-muted);">Searching...</div>';
  try {
    const { data: users } = await window.db
      .from('profiles')
      .select('user_id, username, display_name')
      .ilike('username', `%${query}%`)
      .limit(8);

    if (!users || users.length === 0) {
      resultsEl.innerHTML = '<div style="padding:10px;font-size:13px;color:var(--text-muted);">No users found.</div>';
      return;
    }

    resultsEl.innerHTML = users.map(u => `
      <div class="tag-user-result" data-user-id="${u.user_id}" data-username="${escapeHtml(u.username)}"
        style="display:flex;align-items:center;gap:8px;padding:8px 12px;cursor:pointer;transition:background 0.1s;">
        <div style="width:28px;height:28px;border-radius:50%;background:var(--primary-dim);color:var(--primary);display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;flex-shrink:0;">${u.username.charAt(0).toUpperCase()}</div>
        <div>
          <div style="font-size:13px;font-weight:600;color:var(--text);">${escapeHtml(u.display_name || u.username)}</div>
          <div style="font-size:11px;color:var(--text-muted);">@${escapeHtml(u.username)}</div>
        </div>
      </div>
    `).join('');

    resultsEl.querySelectorAll('.tag-user-result').forEach(el => {
      el.addEventListener('mouseover', () => { el.style.background = 'var(--bg-hover)'; });
      el.addEventListener('mouseout', () => { el.style.background = ''; });
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        const userId = el.dataset.userId;
        const username = el.dataset.username;
        pin.remove();
        dropdown.remove();
        const exists = photoTags.find(t => t.mediaIndex === parseInt(mediaIndex) && t.taggedUserId === userId);
        if (exists) return;
        photoTags.push({
          mediaIndex: parseInt(mediaIndex),
          taggedUserId: userId,
          taggedUsername: username,
          xPercent: parseFloat(xPercent),
          yPercent: parseFloat(yPercent)
        });
        renderTagPins(mediaIndex);
      });
    });
  } catch (err) {
    console.error('Tag search error:', err);
    resultsEl.innerHTML = '<div style="padding:10px;font-size:13px;color:var(--text-muted);">Error searching.</div>';
  }
}

function renderTagPins(mediaIndex) {
  const wrap = document.querySelector(`.tag-overlay-wrap[data-media-index="${mediaIndex}"]`);
  if (!wrap) return;
  wrap.querySelectorAll('.tag-pin').forEach(p => p.remove());
  const tagsForImage = photoTags.filter(t => t.mediaIndex === parseInt(mediaIndex));
  tagsForImage.forEach(tag => {
    const pin = document.createElement('div');
    pin.className = 'tag-pin';
    pin.style.cssText = `position:absolute;left:${tag.xPercent}%;top:${tag.yPercent}%;transform:translate(-50%,-50%);z-index:10;`;
    pin.innerHTML = `
      <div style="position:relative;">
        <div style="width:24px;height:24px;border-radius:50%;background:var(--primary);border:2px solid #fff;cursor:pointer;"></div>
        <div style="position:absolute;top:28px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,0.8);color:#fff;font-size:11px;font-weight:600;padding:2px 8px;border-radius:100px;white-space:nowrap;">@${escapeHtml(tag.taggedUsername)} <span class="remove-tag" data-user-id="${tag.taggedUserId}" data-media-index="${mediaIndex}" style="cursor:pointer;margin-left:4px;opacity:0.7;">×</span></div>
      </div>
    `;
    wrap.appendChild(pin);
  });
  wrap.querySelectorAll('.remove-tag').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      photoTags = photoTags.filter(t => !(t.mediaIndex === parseInt(btn.dataset.mediaIndex) && t.taggedUserId === btn.dataset.userId));
      renderTagPins(mediaIndex);
    });
  });
}

async function savePhotoTags(postId) {
  if (photoTags.length === 0) return;
  try {
    await window.db.from('photo_tags').insert(
      photoTags.map(t => ({
        post_id: postId,
        media_index: t.mediaIndex,
        tagged_user_id: t.taggedUserId,
        x_percent: t.xPercent,
        y_percent: t.yPercent
      }))
    );
    for (const tag of photoTags) {
      if (tag.taggedUserId !== currentUser.id) {
        await window.db.from('notifications').insert({
          user_id: tag.taggedUserId,
          type: 'photo_tag',
          actor_id: currentUser.id,
          target_id: postId,
          target_type: 'post'
        });
      }
    }
  } catch (err) {
    console.error('Save photo tags error:', err);
  }
}

// ─── MEDIA UPLOAD ────────────────────────────────────────────────────────────

function setupMediaUpload() {
  const mediaBtn = document.getElementById('media-upload-btn');
  const mediaInput = document.getElementById('media-file-input');
  if (!mediaBtn || !mediaInput) return;

  mediaBtn.addEventListener('click', () => mediaInput.click());

  mediaInput.addEventListener('change', async () => {
    const files = Array.from(mediaInput.files);
    if (!files.length) return;
    const allowed = ['image/jpeg','image/png','image/gif','image/webp','video/mp4','video/quicktime','video/webm'];
    const valid = files.filter(f => allowed.includes(f.type) && f.size <= 50 * 1024 * 1024);
    if (valid.length !== files.length) {
      alert('Some files were skipped. Only images/videos under 50MB are allowed.');
    }
    selectedMediaFiles = [...selectedMediaFiles, ...valid].slice(0, 4);
    photoTags = photoTags.filter(t => t.mediaIndex < selectedMediaFiles.length);
    renderMediaPreview();
    mediaInput.value = '';
  });
}

function renderMediaPreview() {
  const preview = document.getElementById('media-preview');
  if (!preview) return;
  if (selectedMediaFiles.length === 0) {
    preview.innerHTML = '';
    preview.style.display = 'none';
    photoTags = [];
    return;
  }
  preview.style.display = 'grid';
  preview.style.gridTemplateColumns = selectedMediaFiles.length === 1 ? '1fr' : 'repeat(2, 1fr)';
  preview.style.gap = '8px';
  preview.style.marginTop = '10px';
  preview.innerHTML = selectedMediaFiles.map((file, idx) => {
    const url = URL.createObjectURL(file);
    const isVideo = file.type.startsWith('video/');
    return `
      <div style="position:relative;border-radius:8px;overflow:hidden;aspect-ratio:${selectedMediaFiles.length === 1 ? '16/9' : '1'};">
        ${isVideo
          ? `<video src="${url}" style="width:100%;height:100%;object-fit:cover;" muted playsinline></video>`
          : `<div class="tag-overlay-wrap" data-media-index="${idx}" style="position:relative;width:100%;height:100%;cursor:crosshair;">
               <img src="${url}" style="width:100%;height:100%;object-fit:cover;display:block;" />
               <div style="position:absolute;bottom:4px;left:4px;background:rgba(0,0,0,0.6);color:#fff;font-size:10px;font-weight:600;padding:2px 6px;border-radius:100px;pointer-events:none;">🏷 Click to tag</div>
             </div>`
        }
        <button onclick="removeMediaFile(${idx})"
          style="position:absolute;top:6px;right:6px;background:rgba(0,0,0,0.7);color:#fff;border:none;border-radius:50%;width:24px;height:24px;cursor:pointer;font-size:14px;line-height:24px;text-align:center;z-index:15;">×</button>
      </div>
    `;
  }).join('');
  selectedMediaFiles.forEach((file, idx) => {
    if (!file.type.startsWith('video/')) {
      setupPhotoTagging(idx);
      renderTagPins(idx);
    }
  });
}

function removeMediaFile(idx) {
  selectedMediaFiles.splice(idx, 1);
  photoTags = photoTags.filter(t => t.mediaIndex !== idx).map(t => ({
    ...t,
    mediaIndex: t.mediaIndex > idx ? t.mediaIndex - 1 : t.mediaIndex
  }));
  renderMediaPreview();
}

async function uploadMediaFiles(postId) {
  if (!selectedMediaFiles.length) return [];
  const urls = [];
  for (const file of selectedMediaFiles) {
    const ext = file.name.split('.').pop();
    const path = `${currentUser.id}/${postId}/${Date.now()}.${ext}`;
    const { data, error } = await window.db.storage
      .from('voxxee-media')
      .upload(path, file, { contentType: file.type, upsert: false });
    if (!error && data) {
      const { data: urlData } = window.db.storage
        .from('voxxee-media')
        .getPublicUrl(path);
      if (urlData?.publicUrl) urls.push(urlData.publicUrl);
    }
  }
  return urls;
}

// ─── CHECK-IN ────────────────────────────────────────────────────────────────

function setupCheckin() {
  const checkinBtn = document.getElementById('checkin-btn');
  const checkinPanel = document.getElementById('checkin-panel');
  if (!checkinBtn || !checkinPanel) return;
  checkinBtn.addEventListener('click', () => {
    const visible = checkinPanel.style.display === 'block';
    if (visible) { checkinPanel.style.display = 'none'; return; }
    checkinPanel.style.display = 'block';
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(async (pos) => {
        const { latitude, longitude } = pos.coords;
        try {
          const res = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${latitude}&lon=${longitude}&format=json`);
          const data = await res.json();
          const city = data.address?.city || data.address?.town || data.address?.village || '';
          const state = data.address?.state || '';
          const country = data.address?.country_code?.toUpperCase() || '';
          const location = [city, state, country].filter(Boolean).join(', ');
          selectedCheckin = { location, latitude, longitude };
          renderCheckinPreview();
        } catch {
          checkinPanel.innerHTML = '<div style="font-size:13px;color:var(--text-muted);padding:8px;">Could not detect location.</div>';
        }
      }, () => {
        checkinPanel.innerHTML = '<div style="font-size:13px;color:var(--text-muted);padding:8px;">Location access denied.</div>';
      });
    }
  });
}

function renderCheckinPreview() {
  const panel = document.getElementById('checkin-panel');
  if (!panel || !selectedCheckin) return;
  panel.innerHTML = `
    <div style="display:flex;align-items:center;gap:8px;padding:8px;background:var(--bg-input);border:1px solid var(--border);border-radius:8px;">
      <span style="font-size:16px;">📍</span>
      <span style="font-size:14px;color:var(--text);flex:1;">${escapeHtml(selectedCheckin.location)}</span>
      <button onclick="clearCheckin()" style="background:none;border:none;cursor:pointer;color:var(--text-muted);font-size:16px;">×</button>
    </div>
  `;
}

function clearCheckin() {
  selectedCheckin = null;
  const panel = document.getElementById('checkin-panel');
  if (panel) panel.style.display = 'none';
}

// ─── LINK PREVIEW ────────────────────────────────────────────────────────────

function setupLinkPreview() {
  const textarea = document.getElementById('post-content');
  if (!textarea) return;
  textarea.addEventListener('input', () => {
    clearTimeout(linkPreviewTimeout);
    linkPreviewTimeout = setTimeout(() => detectAndFetchLinkPreview(textarea.value), 800);
  });
}

async function detectAndFetchLinkPreview(text) {
  const urlMatch = text.match(/https?:\/\/[^\s]+/);
  if (!urlMatch) { linkPreviewData = null; renderLinkPreview(null); return; }
  const url = urlMatch[0];
  try {
    const res = await fetch(`https://api.microlink.io?url=${encodeURIComponent(url)}`);
    const data = await res.json();
    if (data.status === 'success') {
      linkPreviewData = {
        url, title: data.data.title || '',
        description: data.data.description || '',
        image: data.data.image?.url || '',
        siteName: data.data.publisher || new URL(url).hostname
      };
      renderLinkPreview(linkPreviewData);
    }
  } catch { linkPreviewData = null; }
}

function renderLinkPreview(data) {
  const container = document.getElementById('link-preview-container');
  if (!container) return;
  if (!data) { container.innerHTML = ''; container.style.display = 'none'; return; }
  container.style.display = 'block';
  container.innerHTML = `
    <div style="border:1px solid var(--border);border-radius:10px;overflow:hidden;margin-top:10px;position:relative;">
      <button onclick="clearLinkPreview()" style="position:absolute;top:8px;right:8px;background:rgba(0,0,0,0.6);color:#fff;border:none;border-radius:50%;width:24px;height:24px;cursor:pointer;font-size:14px;line-height:24px;text-align:center;z-index:1;">×</button>
      ${data.image ? `<img src="${data.image}" style="width:100%;height:160px;object-fit:cover;" onerror="this.style.display='none'" />` : ''}
      <div style="padding:12px;">
        <div style="font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;">${escapeHtml(data.siteName)}</div>
        <div style="font-size:14px;font-weight:600;color:var(--text);margin-bottom:4px;">${escapeHtml(data.title)}</div>
        ${data.description ? `<div style="font-size:13px;color:var(--text-muted);line-height:1.4;">${escapeHtml(data.description.slice(0, 120))}${data.description.length > 120 ? '...' : ''}</div>` : ''}
      </div>
    </div>
  `;
}

function clearLinkPreview() {
  linkPreviewData = null;
  renderLinkPreview(null);
}

// ─── BIRTHDAYS ───────────────────────────────────────────────────────────────

async function loadBirthdays() {
  const sidebar = document.getElementById('birthdays-sidebar');
  const list = document.getElementById('birthdays-list');
  if (!sidebar || !list) return;
  try {
    const today = new Date();
    const month = today.getMonth() + 1;
    const day = today.getDate();
    const { data: users } = await window.db
      .from('users').select('id, date_of_birth').not('date_of_birth', 'is', null);
    if (!users || users.length === 0) return;
    const birthdayUserIds = users
      .filter(u => {
        if (u.id === currentUser.id) return false;
        const dob = new Date(u.date_of_birth);
        return dob.getMonth() + 1 === month && dob.getDate() === day;
      }).map(u => u.id);
    if (birthdayUserIds.length === 0) return;
    const { data: profiles } = await window.db
      .from('profiles').select('user_id, username, display_name').in('user_id', birthdayUserIds);
    if (!profiles || profiles.length === 0) return;
    sidebar.style.display = 'block';
    list.innerHTML = profiles.map(p => {
      const displayName = p.display_name || p.username;
      const initial = p.username.charAt(0).toUpperCase();
      return `
        <a href="/profile.html?user=${encodeURIComponent(p.username)}" style="display:flex;align-items:center;gap:10px;padding:8px 0;text-decoration:none;">
          <div style="width:36px;height:36px;border-radius:50%;background:var(--primary-dim);color:var(--primary);display:flex;align-items:center;justify-content:center;font-size:15px;font-weight:700;flex-shrink:0;">${initial}</div>
          <div>
            <div style="font-size:14px;font-weight:600;color:var(--text);">${escapeHtml(displayName)}</div>
            <div style="font-size:12px;color:var(--text-muted);">@${escapeHtml(p.username)}</div>
          </div>
          <div style="margin-left:auto;font-size:18px;">🎂</div>
        </a>
      `;
    }).join('');
  } catch (err) { console.error('Birthdays error:', err); }
}

async function loadNotifBadge() {
  const badge = document.getElementById('notif-badge');
  if (!badge || !currentUser) return;
  try {
    const { count } = await window.db
      .from('notifications').select('id', { count: 'exact', head: true })
      .eq('user_id', currentUser.id).eq('is_read', false);
    if (count && count > 0) {
      badge.textContent = count > 99 ? '99+' : count;
      badge.style.display = 'inline-flex';
    } else { badge.style.display = 'none'; }
  } catch (err) { console.error('Notif badge error:', err); }
}

function setupEventListeners() {
  document.getElementById('post-btn').addEventListener('click', handleCreatePost);
  document.getElementById('logout-btn').addEventListener('click', async () => {
    await window.auth.signOut(); window.location.href = '/';
  });
  document.querySelectorAll('.feed-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      feedMode = btn.dataset.mode;
      document.querySelectorAll('.feed-tab-btn').forEach(b => b.className = 'btn btn-ghost feed-tab-btn');
      btn.className = 'btn btn-primary feed-tab-btn';
      loadFeed();
    });
  });
  document.getElementById('poll-toggle-btn').addEventListener('click', () => {
    pollVisible = !pollVisible;
    document.getElementById('poll-creator').style.display = pollVisible ? 'block' : 'none';
  });
  document.getElementById('add-option-btn').addEventListener('click', () => {
    const container = document.getElementById('poll-options').querySelector('.form-group');
    const options = container.querySelectorAll('.poll-option');
    if (options.length >= 4) return;
    const input = document.createElement('input');
    input.type = 'text'; input.className = 'form-input poll-option';
    input.placeholder = `Option ${options.length + 1}`; input.maxLength = 100;
    input.style.marginTop = '8px';
    container.appendChild(input);
  });
}

async function loadFeed() {
  const container = document.getElementById('feed-container');
  container.innerHTML = '<div class="loading"><div class="spinner"></div>Loading feed...</div>';
  try {
    let posts = [];

    if (feedMode === 'latest') {
      let q = window.db.from('posts').select('*').eq('is_removed', false)
        .order('created_at', { ascending: false }).limit(50);
      if (!currentProfile?.show_adult_content) q = q.eq('is_adult', false);
      const { data, error } = await q;
      if (error) throw error;
      posts = data || [];

    } else if (feedMode === 'following') {
      const { data: follows } = await window.db
        .from('follows').select('following_id').eq('follower_id', currentUser.id);
      const followingIds = follows ? follows.map(f => f.following_id) : [];
      if (followingIds.length === 0) {
        container.innerHTML = '<div class="loading">Follow some people to see their posts here.</div>';
        return;
      }
      let q = window.db.from('posts').select('*').eq('is_removed', false)
        .in('user_id', followingIds).order('created_at', { ascending: false }).limit(50);
      if (!currentProfile?.show_adult_content) q = q.eq('is_adult', false);
      const { data, error } = await q;
      if (error) throw error;
      posts = data || [];

    } else if (feedMode === 'top') {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      let q = window.db.from('posts').select('*').eq('is_removed', false)
        .gte('created_at', since).limit(200);
      if (!currentProfile?.show_adult_content) q = q.eq('is_adult', false);
      const { data, error } = await q;
      if (error) throw error;
      const allPosts = data || [];
      if (allPosts.length > 0) {
        const postIds = allPosts.map(p => p.id);
        const { data: reactions } = await window.db
          .from('reactions').select('target_id').in('target_id', postIds).eq('target_type', 'post');
        const reactionCounts = {};
        if (reactions) reactions.forEach(r => { reactionCounts[r.target_id] = (reactionCounts[r.target_id] || 0) + 1; });
        posts = allPosts.sort((a, b) => (reactionCounts[b.id] || 0) - (reactionCounts[a.id] || 0)).slice(0, 50);
      }

    } else if (feedMode === 'hot') {
      const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      let q = window.db.from('posts').select('*').eq('is_removed', false)
        .gte('created_at', since).limit(200);
      if (!currentProfile?.show_adult_content) q = q.eq('is_adult', false);
      const { data, error } = await q;
      if (error) throw error;
      const allPosts = data || [];
      if (allPosts.length > 0) {
        const postIds = allPosts.map(p => p.id);
        const [reactionsRes, commentsRes] = await Promise.all([
          window.db.from('reactions').select('target_id').in('target_id', postIds).eq('target_type', 'post'),
          window.db.from('comments').select('post_id').in('post_id', postIds).eq('is_removed', false)
        ]);
        const reactionCounts = {};
        if (reactionsRes.data) reactionsRes.data.forEach(r => { reactionCounts[r.target_id] = (reactionCounts[r.target_id] || 0) + 1; });
        const commentCounts = {};
        if (commentsRes.data) commentsRes.data.forEach(c => { commentCounts[c.post_id] = (commentCounts[c.post_id] || 0) + 1; });
        posts = allPosts.sort((a, b) => {
          const scoreA = (reactionCounts[a.id] || 0) + (commentCounts[a.id] || 0) * 2;
          const scoreB = (reactionCounts[b.id] || 0) + (commentCounts[b.id] || 0) * 2;
          return scoreB - scoreA;
        }).slice(0, 50);
      }
    }

    if (posts && currentProfile?.muted_keywords?.length > 0) {
      const keywords = currentProfile.muted_keywords.map(k => k.toLowerCase());
      posts = posts.filter(post => {
        const content = (post.content || '').toLowerCase();
        return !keywords.some(kw => content.includes(kw));
      });
    }

    if (!posts || posts.length === 0) {
      const emptyMessages = {
        latest: 'No posts yet. Be the first to say something.',
        following: 'Follow some people to see their posts here.',
        top: 'No posts in the last 24 hours yet.',
        hot: 'No posts this week yet.'
      };
      container.innerHTML = `<div class="loading">${emptyMessages[feedMode] || 'No posts found.'}</div>`;
      return;
    }

    const userIds = [...new Set(posts.map(p => p.user_id))];
    const { data: profiles } = await window.db
      .from('profiles').select('user_id, username, display_name, avatar_url, is_verified, verified_type, reputation')
      .in('user_id', userIds);
    const profileMap = {};
    if (profiles) profiles.forEach(p => { profileMap[p.user_id] = p; });

    const communityIds = [...new Set(posts.filter(p => p.community_id).map(p => p.community_id))];
    let communityMap = {};
    if (communityIds.length > 0) {
      const { data: communities } = await window.db
        .from('communities').select('id, name, slug').in('id', communityIds);
      if (communities) communities.forEach(c => { communityMap[c.id] = c; });
    }

    const postIds = posts.map(p => p.id);

    const sharedPostIds = [...new Set(posts.filter(p => p.shared_post_id).map(p => p.shared_post_id))];
    let sharedPostMap = {};
    let sharedProfileMap = {};
    if (sharedPostIds.length > 0) {
      const { data: sharedPosts } = await window.db.from('posts').select('*').in('id', sharedPostIds);
      if (sharedPosts) {
        sharedPosts.forEach(p => { sharedPostMap[p.id] = p; });
        const sharedUserIds = [...new Set(sharedPosts.map(p => p.user_id))];
        const { data: sharedProfiles } = await window.db
          .from('profiles').select('user_id, username, display_name, avatar_url, is_verified, verified_type').in('user_id', sharedUserIds);
        if (sharedProfiles) sharedProfiles.forEach(p => { sharedProfileMap[p.user_id] = p; });
      }
    }

    const { data: reactions } = await window.db
      .from('reactions').select('target_id, reaction_type').in('target_id', postIds).eq('target_type', 'post');
    const reactionMap = {};
    if (reactions) {
      reactions.forEach(r => {
        if (!reactionMap[r.target_id]) reactionMap[r.target_id] = {};
        reactionMap[r.target_id][r.reaction_type] = (reactionMap[r.target_id][r.reaction_type] || 0) + 1;
      });
    }

    const { data: comments } = await window.db
      .from('comments').select('post_id').in('post_id', postIds).eq('is_removed', false);
    const commentCountMap = {};
    if (comments) comments.forEach(c => { commentCountMap[c.post_id] = (commentCountMap[c.post_id] || 0) + 1; });

    let myReactionMap = {};
    if (currentUser) {
      const { data: myReactions } = await window.db
        .from('reactions').select('target_id, reaction_type')
        .in('target_id', postIds).eq('target_type', 'post').eq('user_id', currentUser.id);
      if (myReactions) myReactions.forEach(r => { myReactionMap[r.target_id] = r.reaction_type; });
    }

    const { data: views } = await window.db.from('post_views').select('post_id').in('post_id', postIds);
    const viewCountMap = {};
    if (views) views.forEach(v => { viewCountMap[v.post_id] = (viewCountMap[v.post_id] || 0) + 1; });

    const { data: shares } = await window.db.from('shares').select('post_id').in('post_id', postIds);
    const shareCountMap = {};
    if (shares) shares.forEach(s => { shareCountMap[s.post_id] = (shareCountMap[s.post_id] || 0) + 1; });

    const { data: polls } = await window.db.from('polls').select('*').in('post_id', postIds);
    const pollMap = {};
    if (polls) polls.forEach(p => { pollMap[p.post_id] = p; });

    if (polls && polls.length > 0) {
      const pollIds = polls.map(p => p.id);
      const { data: myVotes } = await window.db
        .from('poll_votes').select('poll_id, option_index').in('poll_id', pollIds).eq('user_id', currentUser.id);
      const myVoteMap = {};
      if (myVotes) myVotes.forEach(v => { myVoteMap[v.poll_id] = v.option_index; });
      const { data: allVotes } = await window.db
        .from('poll_votes').select('poll_id, option_index').in('poll_id', pollIds);
      const pollVoteCountMap = {};
      if (allVotes) {
        allVotes.forEach(v => {
          if (!pollVoteCountMap[v.poll_id]) pollVoteCountMap[v.poll_id] = {};
          pollVoteCountMap[v.poll_id][v.option_index] = (pollVoteCountMap[v.poll_id][v.option_index] || 0) + 1;
        });
      }
      polls.forEach(p => {
        p.voteCounts = pollVoteCountMap[p.id] || {};
        p.totalVotes = Object.values(p.voteCounts).reduce((a, b) => a + b, 0);
        p.myVote = myVoteMap[p.id] !== undefined ? myVoteMap[p.id] : null;
      });
    }

    const postsWithMedia = posts.filter(p => p.media_urls && p.media_urls.length > 0);
    let photoTagMap = {};
    if (postsWithMedia.length > 0) {
      const mediaPostIds = postsWithMedia.map(p => p.id);
      const { data: allTags } = await window.db
        .from('photo_tags').select('post_id, media_index, tagged_user_id, x_percent, y_percent')
        .in('post_id', mediaPostIds);
      if (allTags && allTags.length > 0) {
        const tagUserIds = [...new Set(allTags.map(t => t.tagged_user_id))];
        const { data: tagProfiles } = await window.db
          .from('profiles').select('user_id, username').in('user_id', tagUserIds);
        const tagProfileMap = {};
        if (tagProfiles) tagProfiles.forEach(p => { tagProfileMap[p.user_id] = p; });
        allTags.forEach(tag => {
          if (!photoTagMap[tag.post_id]) photoTagMap[tag.post_id] = [];
          photoTagMap[tag.post_id].push({ ...tag, username: tagProfileMap[tag.tagged_user_id]?.username || 'unknown' });
        });
      }
    }

    container.innerHTML = posts.map(post =>
      renderPost(post, profileMap, communityMap, reactionMap, commentCountMap, myReactionMap, viewCountMap, pollMap, shareCountMap, sharedPostMap, sharedProfileMap, photoTagMap)
    ).join('');

    if (!document.getElementById('share-modal')) {
      const modal = document.createElement('div');
      modal.id = 'share-modal';
      modal.style.cssText = 'display:none;position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:1000;align-items:center;justify-content:center;padding:20px;';
      modal.innerHTML = `
        <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:16px;width:100%;max-width:520px;overflow:hidden;">
          <div style="padding:20px 24px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;">
            <div style="font-size:17px;font-weight:700;color:var(--text);">🔁 Repost to Feed</div>
            <button id="share-modal-close" style="background:none;border:none;cursor:pointer;font-size:20px;color:var(--text-muted);line-height:1;">×</button>
          </div>
          <div style="padding:20px 24px;">
            <textarea id="share-comment" class="form-input" rows="3" placeholder="Add your thoughts... (optional)" maxlength="500" style="width:100%;resize:none;margin-bottom:16px;font-size:15px;"></textarea>
            <div id="share-post-preview" style="background:var(--bg-input);border:1px solid var(--border);border-radius:10px;padding:14px;margin-bottom:16px;font-size:14px;color:var(--text-muted);"></div>
            <div style="display:flex;gap:8px;justify-content:flex-end;">
              <button id="share-modal-cancel" class="btn btn-ghost">Cancel</button>
              <button id="share-modal-submit" class="btn btn-primary">🔁 Repost</button>
            </div>
          </div>
        </div>
      `;
      document.body.appendChild(modal);
      document.getElementById('share-modal-close').addEventListener('click', closeShareModal);
      document.getElementById('share-modal-cancel').addEventListener('click', closeShareModal);
      modal.addEventListener('click', (e) => { if (e.target === modal) closeShareModal(); });
    }

    if (!document.getElementById('report-modal')) {
      const modal = document.createElement('div');
      modal.id = 'report-modal';
      modal.style.cssText = 'display:none;position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:1000;align-items:center;justify-content:center;padding:20px;';
      modal.innerHTML = `
        <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:16px;width:100%;max-width:480px;overflow:hidden;">
          <div style="padding:20px 24px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;">
            <div style="font-size:17px;font-weight:700;color:var(--text);">🚩 Report Post</div>
            <button id="report-modal-close" style="background:none;border:none;cursor:pointer;font-size:20px;color:var(--text-muted);line-height:1;">×</button>
          </div>
          <div style="padding:20px 24px;">
            <div style="font-size:14px;color:var(--text-muted);margin-bottom:16px;">Why are you reporting this post?</div>
            <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:16px;">
              ${[['spam','🚫 Spam or advertising'],['harassment','😡 Harassment or bullying'],['hate_speech','🤬 Hate speech or discrimination'],['misinformation','📰 Misinformation or false content'],['illegal','⚖️ Illegal content'],['adult','🔞 Adult content shown to minors'],['violence','💢 Violence or threats'],['other','❓ Other']].map(([value, label]) => `
                <label style="display:flex;align-items:center;gap:10px;padding:10px 14px;border:1px solid var(--border);border-radius:8px;cursor:pointer;">
                  <input type="radio" name="report-reason" value="${value}" style="accent-color:var(--primary);" />
                  <span style="font-size:14px;color:var(--text);">${label}</span>
                </label>
              `).join('')}
            </div>
            <div id="report-error" style="display:none;color:var(--danger);font-size:13px;margin-bottom:12px;"></div>
            <div style="display:flex;gap:8px;justify-content:flex-end;">
              <button id="report-modal-cancel" class="btn btn-ghost">Cancel</button>
              <button id="report-modal-submit" class="btn btn-primary" style="background:#ef4444;border-color:#ef4444;">Submit Report</button>
            </div>
          </div>
        </div>
      `;
      document.body.appendChild(modal);
      document.getElementById('report-modal-close').addEventListener('click', closeReportModal);
      document.getElementById('report-modal-cancel').addEventListener('click', closeReportModal);
      modal.addEventListener('click', (e) => { if (e.target === modal) closeReportModal(); });
    }

    attachPostListeners();
    recordFeedViews(postIds);

  } catch (err) {
    console.error('Feed error:', err);
    container.innerHTML = '<div class="loading">Could not load feed. Please refresh.</div>';
  }
}

async function handleViewDiagnostics(postId, viewCount, reactionMap, commentCount, shareCount) {
  const card = document.querySelector(`.post-card[data-post-id="${postId}"]`);
  if (!card) return;
  const existing = card.querySelector('.diagnostics-panel');
  if (existing) { existing.style.display = existing.style.display === 'none' ? 'block' : 'none'; return; }
  const { data: reactions } = await window.db
    .from('reactions').select('reaction_type').eq('target_id', postId).eq('target_type', 'post');
  const counts = {};
  if (reactions) reactions.forEach(r => { counts[r.reaction_type] = (counts[r.reaction_type] || 0) + 1; });
  const totalReactions = Object.values(counts).reduce((a, b) => a + b, 0);
  const reactionRows = REACTIONS.filter(r => counts[r.type] > 0).map(r => `
    <div style="display:flex;justify-content:space-between;font-size:13px;padding:4px 0;">
      <span style="color:var(--text-muted);">${r.emoji} ${r.label}</span>
      <span style="font-weight:600;color:var(--text);">${counts[r.type]}</span>
    </div>
  `).join('');
  const engagementRate = viewCount > 0 ? ((totalReactions + commentCount) / viewCount * 100).toFixed(1) : '0.0';
  const panel = document.createElement('div');
  panel.className = 'diagnostics-panel';
  panel.style.cssText = 'margin-top:12px;background:var(--bg-input);border:1px solid var(--border);border-radius:12px;padding:16px;font-size:13px;';
  panel.innerHTML = `
    <div style="font-size:14px;font-weight:700;color:var(--text);margin-bottom:12px;">📊 Post Analytics</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px;">
      <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:10px;padding:12px;text-align:center;"><div style="font-size:22px;font-weight:800;color:var(--primary);">${viewCount.toLocaleString()}</div><div style="font-size:12px;color:var(--text-muted);margin-top:2px;">👁 Views</div></div>
      <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:10px;padding:12px;text-align:center;"><div style="font-size:22px;font-weight:800;color:var(--primary);">${totalReactions}</div><div style="font-size:12px;color:var(--text-muted);margin-top:2px;">❤️ Reactions</div></div>
      <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:10px;padding:12px;text-align:center;"><div style="font-size:22px;font-weight:800;color:var(--primary);">${commentCount}</div><div style="font-size:12px;color:var(--text-muted);margin-top:2px;">💬 Comments</div></div>
      <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:10px;padding:12px;text-align:center;"><div style="font-size:22px;font-weight:800;color:var(--primary);">${shareCount}</div><div style="font-size:12px;color:var(--text-muted);margin-top:2px;">🔁 Reposts</div></div>
    </div>
    ${reactionRows ? `<div style="border-top:1px solid var(--border);padding-top:12px;margin-bottom:12px;"><div style="font-size:12px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;">Reaction Breakdown</div>${reactionRows}</div>` : ''}
    <div style="border-top:1px solid var(--border);padding-top:12px;">
      <div style="display:flex;justify-content:space-between;font-size:13px;"><span style="color:var(--text-muted);">Engagement rate</span><span style="font-weight:700;color:${parseFloat(engagementRate) >= 5 ? '#4caf7d' : 'var(--text)'};">${engagementRate}%</span></div>
      <div style="font-size:11px;color:var(--text-muted);margin-top:4px;">(reactions + comments) ÷ views</div>
    </div>
  `;
  const postActions = card.querySelector('.post-actions');
  if (postActions) postActions.before(panel);
}

function renderSharedPost(sharedPost, sharedProfileMap) {
  if (!sharedPost) {
    return `<div style="margin-top:12px;padding:14px;background:var(--bg-input);border:1px solid var(--border);border-radius:12px;"><div style="font-size:13px;color:var(--text-muted);font-style:italic;">Original post unavailable.</div></div>`;
  }
  const profile = sharedProfileMap[sharedPost.user_id];
  const username = profile?.username || 'unknown';
  const displayName = profile?.display_name || username;
  const verifiedBadge = getVerifiedBadge(profile);
  const timestamp = new Date(sharedPost.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  const content = sharedPost.is_removed ? '<em style="color:var(--text-muted);">This post has been deleted.</em>' : escapeHtml(sharedPost.content || '');
  return `
    <div style="margin-top:12px;padding:14px;background:var(--bg-input);border:1px solid var(--border);border-radius:12px;cursor:pointer;"
      onclick="window.location.href='/comments.html?post=${sharedPost.id}'">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
        <div style="display:flex;align-items:center;flex-shrink:0;">
          ${avatarHtml(profile, 28)}
        </div>
        <div>
          <span style="font-size:13px;font-weight:700;color:var(--text);">${escapeHtml(displayName)}</span>
          ${verifiedBadge}
          <span style="font-size:12px;color:var(--text-muted);"> @${escapeHtml(username)}</span>
        </div>
        <span style="font-size:12px;color:var(--text-muted);margin-left:auto;">${timestamp}</span>
      </div>
      <div style="font-size:14px;color:var(--text);line-height:1.5;">${content}</div>
    </div>
  `;
}

function openReportModal(postId) {
  const modal = document.getElementById('report-modal');
  if (!modal) return;
  document.querySelectorAll('input[name="report-reason"]').forEach(r => r.checked = false);
  document.getElementById('report-error').style.display = 'none';
  const submitBtn = document.getElementById('report-modal-submit');
  submitBtn.onclick = () => handleReport(postId);
  modal.style.display = 'flex';
}

function closeReportModal() {
  const modal = document.getElementById('report-modal');
  if (modal) modal.style.display = 'none';
}

async function handleReport(postId) {
  const reason = document.querySelector('input[name="report-reason"]:checked')?.value;
  const errorEl = document.getElementById('report-error');
  if (!reason) { errorEl.textContent = 'Please select a reason.'; errorEl.style.display = 'block'; return; }
  const submitBtn = document.getElementById('report-modal-submit');
  submitBtn.textContent = 'Submitting...'; submitBtn.disabled = true;
  try {
    const { data: existing } = await window.db.from('reports').select('id')
      .eq('reporter_id', currentUser.id).eq('target_id', postId).eq('target_type', 'post').single();
    if (existing) {
      errorEl.textContent = 'You have already reported this post.'; errorEl.style.display = 'block';
      submitBtn.textContent = 'Submit Report'; submitBtn.disabled = false; return;
    }
    const { error } = await window.db.from('reports').insert({
      reporter_id: currentUser.id, target_id: postId, target_type: 'post', reason, status: 'pending'
    });
    if (error) throw error;
    closeReportModal();
  } catch (err) {
    console.error('Report error:', err);
    errorEl.textContent = 'Something went wrong. Please try again.'; errorEl.style.display = 'block';
  }
  submitBtn.textContent = 'Submit Report'; submitBtn.disabled = false;
}

function openShareModal(postId, postContent, postUsername) {
  const modal = document.getElementById('share-modal');
  if (!modal) return;
  document.getElementById('share-comment').value = '';
  document.getElementById('share-post-preview').innerHTML = `
    <div style="font-size:12px;color:var(--text-muted);margin-bottom:6px;">@${escapeHtml(postUsername)} wrote:</div>
    <div style="font-size:14px;color:var(--text);line-height:1.5;">${escapeHtml((postContent || '').slice(0, 200))}${(postContent || '').length > 200 ? '...' : ''}</div>
  `;
  const submitBtn = document.getElementById('share-modal-submit');
  submitBtn.onclick = () => handleShare(postId);
  modal.style.display = 'flex';
  document.getElementById('share-comment').focus();
}

function closeShareModal() {
  const modal = document.getElementById('share-modal');
  if (modal) modal.style.display = 'none';
}

async function handleShare(postId) {
  if (!currentUser) return;
  const comment = document.getElementById('share-comment').value.trim();
  const submitBtn = document.getElementById('share-modal-submit');
  submitBtn.textContent = 'Reposting...'; submitBtn.disabled = true;
  try {
    await window.db.from('shares').insert({ post_id: postId, user_id: currentUser.id, comment });
    const shareContent = comment ? `${comment}\n\n🔁 [Reposted]` : '🔁 [Reposted]';
    await window.db.from('posts').insert({ user_id: currentUser.id, content: shareContent, shared_post_id: postId });
    closeShareModal();
  } catch (err) { console.error('Share error:', err); closeShareModal(); }
  finally { submitBtn.textContent = '🔁 Repost'; submitBtn.disabled = false; }
}

async function recordFeedViews(postIds) {
  if (!currentUser || !postIds.length) return;
  try {
    const viewedKey = 'viewed_posts_' + currentUser.id;
    const viewed = JSON.parse(sessionStorage.getItem(viewedKey) || '[]');
    const newPostIds = postIds.filter(id => !viewed.includes(id));
    if (newPostIds.length === 0) return;
    await window.db.from('post_views').insert(newPostIds.map(post_id => ({ post_id, user_id: currentUser.id })));
    sessionStorage.setItem(viewedKey, JSON.stringify([...viewed, ...newPostIds]));
  } catch (err) {}
}

function renderPost(post, profileMap, communityMap, reactionMap, commentCountMap, myReactionMap, viewCountMap, pollMap, shareCountMap, sharedPostMap, sharedProfileMap, photoTagMap) {
  const profile = profileMap[post.user_id];
  const username = profile?.username || 'unknown';
  const displayName = profile?.display_name || username;
  const verifiedBadge = getVerifiedBadge(profile);
  const repBadge = repBadgeHtml(profile?.reputation);
  const community = post.community_id && communityMap[post.community_id]
    ? `<span class="post-community">in ${communityMap[post.community_id].name}</span>` : '';
  const timestamp = new Date(post.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  const editedLabel = post.is_edited ? `<span style="font-size:11px;color:var(--text-muted);"> · edited</span>` : '';
  const adultBadge = post.is_adult ? `<span style="font-size:11px;padding:2px 6px;border-radius:100px;background:rgba(239,68,68,0.15);color:#ef4444;font-weight:600;">🔞</span>` : '';

  const commentCount = commentCountMap[post.id] || 0;
  const myReaction = myReactionMap[post.id];
  const postReactions = reactionMap[post.id] || {};
  const viewCount = viewCountMap ? (viewCountMap[post.id] || 0) : 0;
  const shareCount = shareCountMap ? (shareCountMap[post.id] || 0) : 0;
  const isOwnPost = post.user_id === currentUser?.id;

  const totalReactions = Object.values(postReactions).reduce((a, b) => a + b, 0);
  const topEmojis = REACTIONS.filter(r => postReactions[r.type] > 0)
    .sort((a, b) => (postReactions[b.type] || 0) - (postReactions[a.type] || 0))
    .slice(0, 3).map(r => r.emoji).join('');

  const myReactionObj = REACTIONS.find(r => r.type === myReaction);
  const reactBtnLabel = myReactionObj ? `${myReactionObj.emoji} ${myReactionObj.label}` : '❤️ React';
  const reactBtnStyle = myReaction ? 'font-weight:700;color:var(--primary);' : '';

  const viewLabel = viewCount > 0 ? (
    isOwnPost
      ? `<button class="view-label-btn post-action-btn" data-post-id="${post.id}" data-view-count="${viewCount}" data-comment-count="${commentCount}" data-share-count="${shareCount}" style="font-size:12px;color:var(--text-muted);background:none;border:none;cursor:pointer;padding:0;" title="Click to see post analytics">👁 ${viewCount.toLocaleString()} view${viewCount !== 1 ? 's' : ''} 📊</button>`
      : `<span style="font-size:12px;color:var(--text-muted);">👁 ${viewCount.toLocaleString()} view${viewCount !== 1 ? 's' : ''}</span>`
  ) : '';

  const sharedPostHtml = post.shared_post_id && sharedPostMap
    ? renderSharedPost(sharedPostMap[post.shared_post_id] || null, sharedProfileMap || {})
    : '';

  const postContent = post.shared_post_id
    ? (post.content || '').replace(/\n\n🔁 \[Reposted\]$/, '').trim()
    : (post.content || '');

  const mediaUrls = post.media_urls || [];
  const postPhotoTags = photoTagMap ? (photoTagMap[post.id] || []) : [];
  let mediaHtml = '';
  if (mediaUrls.length > 0) {
    const grid = mediaUrls.length === 1 ? '1fr' : 'repeat(2,1fr)';
    mediaHtml = `<div style="display:grid;grid-template-columns:${grid};gap:6px;margin-top:10px;border-radius:10px;overflow:hidden;">
      ${mediaUrls.map((url, idx) => {
        const isVideo = url.match(/\.(mp4|mov|webm)(\?|$)/i);
        const tagsForImage = postPhotoTags.filter(t => t.media_index === idx);
        if (isVideo) {
          return `<video src="${url}" controls style="width:100%;max-height:400px;object-fit:cover;background:#000;" playsinline></video>`;
        }
        const tagPins = tagsForImage.map(tag => `
          <div class="feed-tag-pin" style="position:absolute;left:${tag.x_percent}%;top:${tag.y_percent}%;transform:translate(-50%,-50%);z-index:10;">
            <div style="position:relative;">
              <div style="width:20px;height:20px;border-radius:50%;background:var(--primary);border:2px solid #fff;"></div>
              <div style="position:absolute;top:24px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,0.8);color:#fff;font-size:10px;font-weight:600;padding:2px 6px;border-radius:100px;white-space:nowrap;pointer-events:none;">
                <a href="/profile.html?user=${encodeURIComponent(tag.username)}" style="color:#fff;text-decoration:none;">@${escapeHtml(tag.username)}</a>
              </div>
            </div>
          </div>
        `).join('');
        return `
          <div style="position:relative;${mediaUrls.length===1?'':'aspect-ratio:1;'}overflow:hidden;">
            <img src="${url}" style="width:100%;${mediaUrls.length===1?'max-height:400px;':'height:100%;'}object-fit:cover;cursor:pointer;display:block;" onclick="window.open('${url}','_blank')" />
            ${tagPins}
          </div>
        `;
      }).join('')}
    </div>`;
  }

  const checkinHtml = post.checkin_location
    ? `<div style="font-size:13px;color:var(--text-muted);margin-top:6px;">📍 ${escapeHtml(post.checkin_location)}</div>`
    : '';

  let linkPreviewHtml = '';
  if (post.link_preview && typeof post.link_preview === 'object') {
    const lp = post.link_preview;
    linkPreviewHtml = `
      <a href="${lp.url}" target="_blank" rel="noopener noreferrer" style="display:block;margin-top:10px;border:1px solid var(--border);border-radius:10px;overflow:hidden;text-decoration:none;">
        ${lp.image ? `<img src="${lp.image}" style="width:100%;height:160px;object-fit:cover;" onerror="this.style.display='none'" />` : ''}
        <div style="padding:12px;">
          <div style="font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;">${escapeHtml(lp.siteName || '')}</div>
          <div style="font-size:14px;font-weight:600;color:var(--text);margin-bottom:4px;">${escapeHtml(lp.title || '')}</div>
          ${lp.description ? `<div style="font-size:13px;color:var(--text-muted);">${escapeHtml(lp.description.slice(0,120))}${lp.description.length>120?'...':''}</div>` : ''}
        </div>
      </a>
    `;
  }

  const poll = pollMap ? pollMap[post.id] : null;
  let pollHtml = '';
  if (poll) {
    const options = poll.options || [];
    const isExpired = poll.expires_at && new Date(poll.expires_at) < new Date();
    const showResults = poll.myVote !== null || isExpired;
    const totalVotes = poll.totalVotes || 0;
    pollHtml = `
      <div class="poll-card" data-poll-id="${poll.id}" style="margin-top:12px;background:var(--bg-input);border:1px solid var(--border);border-radius:12px;padding:14px;">
        <div style="font-size:15px;font-weight:600;color:var(--text);margin-bottom:12px;">${escapeHtml(poll.question)}</div>
        <div class="poll-options">
          ${options.map((opt, idx) => {
            const voteCount = poll.voteCounts[idx] || 0;
            const pct = totalVotes > 0 ? Math.round((voteCount / totalVotes) * 100) : 0;
            const isMyVote = poll.myVote === idx;
            if (showResults) {
              return `
                <div style="margin-bottom:8px;">
                  <div style="display:flex;justify-content:space-between;font-size:14px;margin-bottom:4px;">
                    <span style="color:var(--text);${isMyVote?'font-weight:700;':''}">${isMyVote?'✓ ':''}${escapeHtml(opt)}</span>
                    <span style="color:var(--text-muted);">${pct}%</span>
                  </div>
                  <div style="height:6px;background:var(--border);border-radius:100px;overflow:hidden;">
                    <div style="height:100%;width:${pct}%;background:${isMyVote?'var(--primary)':'var(--text-muted)'};border-radius:100px;transition:width 0.3s ease;"></div>
                  </div>
                </div>`;
            } else {
              return `<button class="poll-vote-btn" data-poll-id="${poll.id}" data-option-index="${idx}"
                style="display:block;width:100%;text-align:left;padding:10px 14px;margin-bottom:6px;background:var(--bg-card);border:1px solid var(--border);border-radius:8px;cursor:pointer;font-size:14px;color:var(--text);">
                ${escapeHtml(opt)}</button>`;
            }
          }).join('')}
        </div>
        <div style="font-size:12px;color:var(--text-muted);margin-top:8px;">
          ${totalVotes} vote${totalVotes !== 1 ? 's' : ''}
          ${isExpired ? ' · Closed' : poll.expires_at ? ` · Ends ${new Date(poll.expires_at).toLocaleDateString('en-US',{month:'short',day:'numeric'})}` : ''}
        </div>
      </div>`;
  }

  const modeLabel = (feedMode === 'top' || feedMode === 'hot') ? (() => {
    const total = totalReactions + commentCount;
    if (total === 0) return '';
    return `<span style="font-size:11px;padding:2px 8px;border-radius:100px;background:rgba(245,166,35,0.15);color:#f5a623;font-weight:600;margin-left:6px;">🔥 ${total} interactions</span>`;
  })() : '';

  return `
    <div class="post-card" data-post-id="${post.id}">
      <div class="post-header">
        <div style="display:flex;align-items:center;flex-shrink:0;" onclick="window.location.href='/profile.html?user=${encodeURIComponent(username)}'">
          ${avatarHtml(profile, 40)}
        </div>
        <div class="post-meta">
          <div class="post-username">
            <a href="/profile.html?user=${encodeURIComponent(username)}" style="text-decoration:none;color:inherit;">${escapeHtml(displayName)}</a>
            ${verifiedBadge}
            <span style="font-weight:400;color:var(--text-muted);font-size:13px;">@${escapeHtml(username)}</span>
            ${repBadge}
            ${adultBadge}
            ${modeLabel}
          </div>
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
            <span class="post-timestamp">${timestamp}</span>
            ${editedLabel}
            ${community}
          </div>
        </div>
        <div class="post-menu-wrapper" style="position:relative;margin-left:auto;">
          <button class="post-menu-btn" data-post-id="${post.id}" style="background:none;border:none;cursor:pointer;color:var(--text-muted);font-size:18px;padding:4px 8px;border-radius:6px;line-height:1;">•••</button>
          <div class="post-menu-dropdown" data-post-id="${post.id}" style="display:none;position:absolute;top:28px;right:0;background:var(--bg-card);border:1px solid var(--border);border-radius:10px;box-shadow:0 4px 20px rgba(0,0,0,0.3);z-index:200;min-width:150px;overflow:hidden;">
            ${isOwnPost ? `
              <button class="edit-btn" data-post-id="${post.id}" data-content="${escapeHtml(post.content || '')}" style="display:block;width:100%;text-align:left;padding:10px 16px;background:none;border:none;cursor:pointer;font-size:14px;color:var(--text);">✏️ Edit</button>
              <button class="delete-btn" data-post-id="${post.id}" style="display:block;width:100%;text-align:left;padding:10px 16px;background:none;border:none;cursor:pointer;font-size:14px;color:var(--danger);">🗑️ Delete</button>
            ` : `
              <button class="report-btn" data-post-id="${post.id}" style="display:block;width:100%;text-align:left;padding:10px 16px;background:none;border:none;cursor:pointer;font-size:14px;color:var(--danger);">🚩 Report Post</button>
            `}
          </div>
        </div>
      </div>

      <div class="post-content-wrapper">
        ${postContent ? `<div class="post-content">${renderMentions(postContent)}</div>` : ''}
        ${checkinHtml}
        ${mediaHtml}
        ${linkPreviewHtml}
        ${sharedPostHtml}
      </div>

      ${pollHtml}

      ${totalReactions > 0 || viewCount > 0 ? `
        <div style="padding:4px 0 8px 0;display:flex;justify-content:space-between;align-items:center;">
          ${totalReactions > 0 ? `<span class="reaction-summary" style="font-size:13px;color:var(--text-muted);cursor:pointer;">${topEmojis} ${totalReactions}</span>` : '<span></span>'}
          ${viewLabel}
        </div>
      ` : ''}

      <div class="post-actions">
        <div class="reaction-btn-wrapper" style="position:relative;">
          <button class="post-action-btn react-btn" data-post-id="${post.id}" style="${reactBtnStyle}">${reactBtnLabel}</button>
          <div class="reaction-picker" data-post-id="${post.id}" style="display:none;position:absolute;bottom:36px;left:0;background:var(--bg-card);border:1px solid var(--border);border-radius:100px;padding:6px 10px;gap:4px;z-index:100;box-shadow:0 4px 20px rgba(0,0,0,0.3);">
            ${REACTIONS.map(r => `
              <button class="reaction-option" data-post-id="${post.id}" data-type="${r.type}" title="${r.label}"
                style="background:none;border:none;cursor:pointer;font-size:22px;padding:2px 4px;border-radius:50%;transition:transform 0.1s ease;${myReaction === r.type ? 'transform:scale(1.3);' : ''}"
                onmouseover="this.style.transform='scale(1.3)'" onmouseout="this.style.transform='${myReaction === r.type ? 'scale(1.3)' : 'scale(1)'}'">
                ${r.emoji}
              </button>
            `).join('')}
          </div>
        </div>
        <button class="post-action-btn comment-btn" data-post-id="${post.id}">💬 <span>${commentCount > 0 ? commentCount : ''} Comment${commentCount !== 1 ? 's' : ''}</span></button>
        <div class="gif-picker-wrapper" style="position:relative;">
          <button class="post-action-btn gif-react-btn" data-post-id="${post.id}">🎞️ GIF</button>
          <div class="gif-picker-panel" data-post-id="${post.id}" style="display:none;position:absolute;bottom:40px;left:0;width:300px;background:var(--bg-card);border:1px solid var(--border);border-radius:12px;box-shadow:0 4px 24px rgba(0,0,0,0.4);z-index:300;overflow:hidden;">
            <div style="padding:10px;">
              <div style="display:flex;gap:6px;margin-bottom:8px;">
                <input type="text" class="gif-search-input form-input" placeholder="Search GIFs..." style="flex:1;font-size:13px;padding:6px 10px;" />
                <button class="gif-search-btn" data-post-id="${post.id}" style="background:var(--primary);color:#fff;border:none;border-radius:8px;padding:6px 10px;cursor:pointer;font-size:13px;">Go</button>
              </div>
              <div class="gif-results" data-post-id="${post.id}" style="display:grid;grid-template-columns:repeat(3,1fr);gap:4px;max-height:200px;overflow-y:auto;">
                <div style="grid-column:1/-1;font-size:12px;color:var(--text-muted);padding:8px;text-align:center;">Loading GIFs...</div>
              </div>
            </div>
          </div>
        </div>
        <button class="post-action-btn share-btn" data-post-id="${post.id}" data-post-content="${escapeHtml(post.content || '')}" data-post-username="${escapeHtml(username)}" data-share-count="${shareCount}">🔁 ${shareCount > 0 ? shareCount : 'Repost'}</button>
        <button class="post-action-btn copy-link-btn" data-post-id="${post.id}">🔗</button>
      </div>
    </div>
  `;
}

function attachPostListeners() {
  document.querySelectorAll('.react-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const postId = btn.dataset.postId;
      const picker = document.querySelector(`.reaction-picker[data-post-id="${postId}"]`);
      const isVisible = picker.style.display === 'flex';
      document.querySelectorAll('.reaction-picker').forEach(p => p.style.display = 'none');
      picker.style.display = isVisible ? 'none' : 'flex';
    });
  });

  document.querySelectorAll('.reaction-option').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const postId = btn.dataset.postId;
      const type = btn.dataset.type;
      document.querySelector(`.reaction-picker[data-post-id="${postId}"]`).style.display = 'none';
      handleReaction(postId, type);
    });
  });

  document.querySelectorAll('.post-menu-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const postId = btn.dataset.postId;
      const menu = document.querySelector(`.post-menu-dropdown[data-post-id="${postId}"]`);
      const isVisible = menu.style.display === 'block';
      document.querySelectorAll('.post-menu-dropdown').forEach(m => m.style.display = 'none');
      menu.style.display = isVisible ? 'none' : 'block';
    });
  });

  document.querySelectorAll('.edit-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const postId = btn.dataset.postId;
      const content = btn.dataset.content;
      document.querySelector(`.post-menu-dropdown[data-post-id="${postId}"]`).style.display = 'none';
      showEditForm(postId, content);
    });
  });

  document.querySelectorAll('.delete-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const menu = document.querySelector(`.post-menu-dropdown[data-post-id="${btn.dataset.postId}"]`);
      if (menu) menu.style.display = 'none';
      handleDeletePost(btn.dataset.postId);
    });
  });

  document.querySelectorAll('.report-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const menu = document.querySelector(`.post-menu-dropdown[data-post-id="${btn.dataset.postId}"]`);
      if (menu) menu.style.display = 'none';
      openReportModal(btn.dataset.postId);
    });
  });

  document.querySelectorAll('.comment-btn').forEach(btn => {
    btn.addEventListener('click', () => { window.location.href = `/comments.html?post=${btn.dataset.postId}`; });
  });

  document.querySelectorAll('.poll-vote-btn').forEach(btn => {
    btn.addEventListener('click', () => handlePollVote(btn.dataset.pollId, parseInt(btn.dataset.optionIndex)));
  });

  document.querySelectorAll('.share-btn').forEach(btn => {
    btn.addEventListener('click', () => openShareModal(btn.dataset.postId, btn.dataset.postContent, btn.dataset.postUsername));
  });

  document.querySelectorAll('.copy-link-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const url = `${window.location.origin}/comments.html?post=${btn.dataset.postId}`;
      navigator.clipboard.writeText(url).then(() => {
        btn.textContent = '✅';
        setTimeout(() => { btn.textContent = '🔗'; }, 2000);
      });
    });
  });

  document.querySelectorAll('.view-label-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      handleViewDiagnostics(btn.dataset.postId, parseInt(btn.dataset.viewCount||'0'), {}, parseInt(btn.dataset.commentCount||'0'), parseInt(btn.dataset.shareCount||'0'));
    });
  });

  document.querySelectorAll('.gif-react-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const postId = btn.dataset.postId;
      const panel = document.querySelector(`.gif-picker-panel[data-post-id="${postId}"]`);
      const isVisible = panel.style.display === 'block';
      document.querySelectorAll('.gif-picker-panel').forEach(p => p.style.display = 'none');
      if (!isVisible) {
        panel.style.display = 'block';
        activeGifPicker = postId;
        loadGifPickerTrending(postId);
        panel.querySelector('.gif-search-input').focus();
      } else { activeGifPicker = null; }
    });
  });

  document.querySelectorAll('.gif-search-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const postId = btn.dataset.postId;
      const panel = document.querySelector(`.gif-picker-panel[data-post-id="${postId}"]`);
      const query = panel.querySelector('.gif-search-input').value.trim();
      if (query) searchGifsForPost(postId, query);
    });
  });

  document.querySelectorAll('.gif-search-input').forEach(input => {
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        const panel = input.closest('.gif-picker-panel');
        const query = input.value.trim();
        if (query) searchGifsForPost(panel.dataset.postId, query);
      }
    });
    input.addEventListener('click', (e) => e.stopPropagation());
  });
}

async function loadGifPickerTrending(postId) {
  const resultsEl = document.querySelector(`.gif-results[data-post-id="${postId}"]`);
  if (!resultsEl) return;
  resultsEl.innerHTML = '<div style="grid-column:1/-1;font-size:12px;color:var(--text-muted);padding:8px;text-align:center;">Loading...</div>';
  try {
    await window.loadApiKeys();
    const key = window.giphyApiKey;
    if (!key) { resultsEl.innerHTML = '<div style="grid-column:1/-1;font-size:12px;color:var(--text-muted);padding:8px;">GIFs unavailable.</div>'; return; }
    const res = await fetch(`https://api.giphy.com/v1/gifs/trending?api_key=${key}&limit=12&rating=g`);
    const data = await res.json();
    renderGifPickerResults(postId, data.data);
  } catch { resultsEl.innerHTML = '<div style="grid-column:1/-1;font-size:12px;color:var(--text-muted);padding:8px;">Could not load GIFs.</div>'; }
}

async function searchGifsForPost(postId, query) {
  const resultsEl = document.querySelector(`.gif-results[data-post-id="${postId}"]`);
  if (!resultsEl) return;
  resultsEl.innerHTML = '<div style="grid-column:1/-1;font-size:12px;color:var(--text-muted);padding:8px;text-align:center;">Searching...</div>';
  try {
    await window.loadApiKeys();
    const key = window.giphyApiKey;
    if (!key) return;
    const res = await fetch(`https://api.giphy.com/v1/gifs/search?api_key=${key}&q=${encodeURIComponent(query)}&limit=12&rating=g`);
    const data = await res.json();
    renderGifPickerResults(postId, data.data);
  } catch { resultsEl.innerHTML = '<div style="grid-column:1/-1;font-size:12px;color:var(--text-muted);padding:8px;">Search failed.</div>'; }
}

function renderGifPickerResults(postId, gifs) {
  const resultsEl = document.querySelector(`.gif-results[data-post-id="${postId}"]`);
  if (!resultsEl) return;
  if (!gifs || gifs.length === 0) { resultsEl.innerHTML = '<div style="grid-column:1/-1;font-size:12px;color:var(--text-muted);padding:8px;">No GIFs found.</div>'; return; }
  resultsEl.innerHTML = gifs.map(gif => `
    <img src="${gif.images.fixed_height_small.url}" data-full="${gif.images.fixed_height.url}"
      style="width:100%;height:70px;object-fit:cover;border-radius:6px;cursor:pointer;"
      class="gif-pick-item" data-post-id="${postId}" />
  `).join('');
  resultsEl.querySelectorAll('.gif-pick-item').forEach(img => {
    img.addEventListener('click', (e) => { e.stopPropagation(); postGifReaction(postId, img.dataset.full); });
  });
}

async function postGifReaction(postId, gifUrl) {
  if (!currentUser) return;
  document.querySelectorAll('.gif-picker-panel').forEach(p => p.style.display = 'none');
  activeGifPicker = null;
  try {
    await window.db.from('comments').insert({ post_id: postId, user_id: currentUser.id, content: gifUrl });
    const gifBtn = document.querySelector(`.gif-react-btn[data-post-id="${postId}"]`);
    if (gifBtn) {
      gifBtn.textContent = '✅ Sent!'; gifBtn.style.color = '#4caf7d';
      setTimeout(() => { gifBtn.textContent = '🎞️ GIF'; gifBtn.style.color = ''; }, 2000);
    }
  } catch (err) { console.error('GIF reaction error:', err); }
}

async function handlePollVote(pollId, optionIndex) {
  if (!currentUser) return;
  try {
    const { data: existing } = await window.db
      .from('poll_votes').select('id').eq('poll_id', pollId).eq('user_id', currentUser.id).single();
    if (existing) return;
    await window.db.from('poll_votes').insert({ poll_id: pollId, user_id: currentUser.id, option_index: optionIndex });
    await refreshPollResults(pollId);
  } catch (err) { console.error('Poll vote error:', err); }
}

async function refreshPollResults(pollId) {
  const pollCard = document.querySelector(`.poll-card[data-poll-id="${pollId}"]`);
  if (!pollCard) return;
  const { data: poll } = await window.db.from('polls').select('*').eq('id', pollId).single();
  if (!poll) return;
  const { data: allVotes } = await window.db.from('poll_votes').select('option_index').eq('poll_id', pollId);
  const voteCounts = {};
  if (allVotes) allVotes.forEach(v => { voteCounts[v.option_index] = (voteCounts[v.option_index] || 0) + 1; });
  const totalVotes = allVotes ? allVotes.length : 0;
  const { data: myVoteRow } = await window.db.from('poll_votes').select('option_index').eq('poll_id', pollId).eq('user_id', currentUser.id).single();
  const myVote = myVoteRow ? myVoteRow.option_index : null;
  const options = poll.options || [];
  const isExpired = poll.expires_at && new Date(poll.expires_at) < new Date();
  const optionsContainer = pollCard.querySelector('.poll-options');
  if (optionsContainer) {
    optionsContainer.innerHTML = options.map((opt, idx) => {
      const voteCount = voteCounts[idx] || 0;
      const pct = totalVotes > 0 ? Math.round((voteCount / totalVotes) * 100) : 0;
      const isMyVote = myVote === idx;
      return `
        <div style="margin-bottom:8px;">
          <div style="display:flex;justify-content:space-between;font-size:14px;margin-bottom:4px;">
            <span style="color:var(--text);${isMyVote?'font-weight:700;':''}">${isMyVote?'✓ ':''}${escapeHtml(opt)}</span>
            <span style="color:var(--text-muted);">${pct}%</span>
          </div>
          <div style="height:6px;background:var(--border);border-radius:100px;overflow:hidden;">
            <div style="height:100%;width:${pct}%;background:${isMyVote?'var(--primary)':'var(--text-muted)'};border-radius:100px;transition:width 0.3s ease;"></div>
          </div>
        </div>
      `;
    }).join('');
  }
}

function showEditForm(postId, currentContent) {
  const card = document.querySelector(`.post-card[data-post-id="${postId}"]`);
  if (!card) return;
  const wrapper = card.querySelector('.post-content-wrapper');
  wrapper.innerHTML = `
    <div style="margin-top:8px;">
      <textarea class="form-input edit-post-textarea" data-post-id="${postId}" style="width:100%;resize:vertical;min-height:80px;font-size:15px;" maxlength="2000">${currentContent}</textarea>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:8px;">
        <button class="btn btn-ghost cancel-edit-btn" data-post-id="${postId}" style="font-size:13px;">Cancel</button>
        <button class="btn btn-primary save-edit-btn" data-post-id="${postId}" style="font-size:13px;">Save</button>
      </div>
    </div>
  `;
  const textarea = wrapper.querySelector('.edit-post-textarea');
  textarea.focus();
  textarea.setSelectionRange(textarea.value.length, textarea.value.length);
  wrapper.querySelector('.cancel-edit-btn').addEventListener('click', () => {
    wrapper.innerHTML = `<div class="post-content">${renderMentions(currentContent)}</div>`;
  });
  wrapper.querySelector('.save-edit-btn').addEventListener('click', () => {
    handleEditPost(postId, textarea.value.trim(), wrapper, currentContent);
  });
}

async function handleEditPost(postId, newContent, wrapper, originalContent) {
  if (!newContent) return;
  if (newContent === originalContent) { wrapper.innerHTML = `<div class="post-content">${renderMentions(originalContent)}</div>`; return; }
  const saveBtn = wrapper.querySelector('.save-edit-btn');
  saveBtn.textContent = 'Saving...'; saveBtn.disabled = true;
  try {
    const { error } = await window.db.from('posts').update({ content: newContent, is_edited: true }).eq('id', postId).eq('user_id', currentUser.id);
    if (error) throw error;
    wrapper.innerHTML = `<div class="post-content">${renderMentions(newContent)}</div>`;
  } catch (err) {
    console.error('Edit error:', err);
    saveBtn.textContent = 'Save'; saveBtn.disabled = false;
  }
}

async function handleReaction(postId, type) {
  if (!currentUser) return;
  try {
    const { data: existing } = await window.db
      .from('reactions').select('*').eq('user_id', currentUser.id).eq('target_id', postId).eq('target_type', 'post').single();
    if (existing) {
      if (existing.reaction_type === type) {
        await window.db.from('reactions').delete().eq('id', existing.id);
      } else {
        await window.db.from('reactions').update({ reaction_type: type }).eq('id', existing.id);
      }
    } else {
      await window.db.from('reactions').insert({ user_id: currentUser.id, target_id: postId, target_type: 'post', reaction_type: type });
      const { data: post } = await window.db.from('posts').select('user_id').eq('id', postId).single();
      if (post && post.user_id !== currentUser.id) {
        await awardReputation(post.user_id, type === 'downvote' ? 'downvote_received' : 'reaction_received', postId, 'post', currentUser.id);
      }
    }
    await refreshPostReactions(postId);
  } catch (err) { console.error('Reaction error:', err); }
}

async function refreshPostReactions(postId) {
  const { data: reactions } = await window.db.from('reactions').select('reaction_type').eq('target_id', postId).eq('target_type', 'post');
  const card = document.querySelector(`.post-card[data-post-id="${postId}"]`);
  if (!card) return;
  const counts = {};
  if (reactions) reactions.forEach(r => { counts[r.reaction_type] = (counts[r.reaction_type] || 0) + 1; });
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const topEmojis = REACTIONS.filter(r => counts[r.type] > 0).sort((a, b) => (counts[b.type]||0) - (counts[a.type]||0)).slice(0,3).map(r => r.emoji).join('');
  let summary = card.querySelector('.reaction-summary');
  if (total > 0) {
    if (!summary) {
      const div = document.createElement('div');
      div.style.cssText = 'padding:4px 0 8px 0;display:flex;justify-content:space-between;align-items:center;';
      div.innerHTML = `<span class="reaction-summary" style="font-size:13px;color:var(--text-muted);cursor:pointer;"></span>`;
      card.querySelector('.post-content-wrapper').after(div);
      summary = card.querySelector('.reaction-summary');
    }
    summary.textContent = `${topEmojis} ${total}`;
  } else if (summary) { summary.parentElement.remove(); }
  const { data: myReaction } = await window.db.from('reactions').select('reaction_type').eq('target_id', postId).eq('target_type', 'post').eq('user_id', currentUser.id).single();
  const reactBtn = card.querySelector('.react-btn');
  if (reactBtn) {
    const myReactionObj = REACTIONS.find(r => r.type === myReaction?.reaction_type);
    reactBtn.textContent = myReactionObj ? `${myReactionObj.emoji} ${myReactionObj.label}` : '❤️ React';
    reactBtn.style.fontWeight = myReaction ? '700' : '';
    reactBtn.style.color = myReaction ? 'var(--primary)' : '';
  }
}

async function handleCreatePost() {
  if (!currentUser) return;
  const content = document.getElementById('post-content').value.trim();
  const hasPoll = pollVisible;
  if (!content && !hasPoll && selectedMediaFiles.length === 0) return;

  const btn = document.getElementById('post-btn');
  btn.textContent = 'Posting...'; btn.disabled = true;

  try {
    const postData = {
      user_id: currentUser.id, content,
      is_adult: currentProfile?.is_adult_creator || false
    };

    if (selectedCheckin) {
      postData.checkin_location = selectedCheckin.location;
      postData.checkin_lat = selectedCheckin.latitude;
      postData.checkin_lng = selectedCheckin.longitude;
    }

    if (linkPreviewData) postData.link_preview = linkPreviewData;

    const { data: post, error: postError } = await window.db.from('posts').insert(postData).select().single();
    if (postError) throw postError;

    if (selectedMediaFiles.length > 0 && post) {
      const mediaUrls = await uploadMediaFiles(post.id);
      if (mediaUrls.length > 0) {
        await window.db.from('posts').update({ media_urls: mediaUrls }).eq('id', post.id);
      }
      await savePhotoTags(post.id);
    }

    await awardReputation(currentUser.id, 'post_created', post.id, 'post', null);

    if (hasPoll && post) {
      const question = document.getElementById('poll-question').value.trim();
      const optionInputs = document.querySelectorAll('.poll-option');
      const options = Array.from(optionInputs).map(i => i.value.trim()).filter(v => v.length > 0);
      const duration = parseInt(document.getElementById('poll-duration').value);
      if (question && options.length >= 2) {
        const expiresAt = new Date();
        expiresAt.setHours(expiresAt.getHours() + duration);
        await window.db.from('polls').insert({ post_id: post.id, user_id: currentUser.id, question, options, duration_hours: duration, expires_at: expiresAt.toISOString() });
      }
    }

    await window.db.from('profiles').update({ post_count: (currentProfile?.post_count || 0) + 1 }).eq('user_id', currentUser.id);

    document.getElementById('post-content').value = '';
    selectedMediaFiles = [];
    selectedCheckin = null;
    linkPreviewData = null;
    photoTags = [];
    renderMediaPreview();
    renderLinkPreview(null);
    clearCheckin();

    if (hasPoll) {
      document.getElementById('poll-creator').style.display = 'none';
      document.getElementById('poll-question').value = '';
      document.querySelectorAll('.poll-option').forEach((el, i) => { if (i < 2) el.value = ''; else el.remove(); });
      pollVisible = false;
    }

    btn.textContent = 'Post'; btn.disabled = false;
    await loadFeed();
  } catch (err) {
    console.error('Post error:', err);
    btn.textContent = 'Post'; btn.disabled = false;
  }
}

async function handleDeletePost(postId) {
  if (!currentUser) return;
  if (!confirm('Delete this post?')) return;
  await window.db.from('posts').update({ is_removed: true }).eq('id', postId).eq('user_id', currentUser.id);
  await loadFeed();
}

async function loadSidebarCommunities() {
  const container = document.getElementById('sidebar-communities');
  if (!container) return;
  const { data: communities } = await window.db.from('communities').select('name, slug').eq('is_official', true).order('name').limit(8);
  if (!communities) return;
  container.innerHTML = communities.map(c => `
    <a href="/community.html?slug=${c.slug}" style="display:block;padding:8px 16px;border-radius:8px;color:var(--text-muted);font-size:14px;text-decoration:none;transition:all 0.15s ease;" onmouseover="this.style.background='var(--bg-hover)';this.style.color='var(--text)'" onmouseout="this.style.background='';this.style.color='var(--text-muted)'">${c.name}</a>
  `).join('');
}

async function loadTrendingCommunities() {
  const container = document.getElementById('trending-communities');
  if (!container) return;
  const { data: communities } = await window.db.from('communities').select('name, slug, member_count').eq('is_official', true).order('member_count', { ascending: false }).limit(5);
  if (!communities) return;
  container.innerHTML = communities.map(c => `
    <a href="/community.html?slug=${c.slug}" style="display:block;padding:12px;border-radius:8px;margin-bottom:8px;background:var(--bg-card);border:1px solid var(--border);text-decoration:none;">
      <div style="font-size:14px;font-weight:600;color:var(--text);margin-bottom:4px;">${c.name}</div>
      <div style="font-size:12px;color:var(--text-muted);">${c.member_count > 0 ? c.member_count.toLocaleString() + ' members' : 'New community'}</div>
    </a>
  `).join('');
}

async function loadEcosystemSidebar() {
  const container = document.getElementById('ecosystem-sidebar');
  if (!container) return;
  const { data: cards } = await window.db.from('ecosystem_cards').select('name, tagline, status').order('display_order');
  if (!cards) return;
  container.innerHTML = cards.map(card => `
    <div style="padding:12px;border-radius:8px;margin-bottom:8px;background:var(--bg-card);border:1px solid var(--border);">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
        <div style="font-size:14px;font-weight:700;color:var(--text);">${card.name}</div>
        <span style="font-size:11px;padding:2px 8px;border-radius:100px;font-weight:600;${card.status==='live'?'background:rgba(76,175,125,0.2);color:#4caf7d;':'background:rgba(245,166,35,0.2);color:#f5a623;'}">${card.status==='live'?'Live':'Soon'}</span>
      </div>
      <div style="font-size:12px;color:var(--text-muted);">${card.tagline || ''}</div>
    </div>
  `).join('');
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.appendChild(document.createTextNode(text));
  return div.innerHTML;
}
