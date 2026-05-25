async function waitForDb(timeout = 5000) {
  const start = Date.now();
  while (!window.db) {
    if (Date.now() - start > timeout) throw new Error('Supabase init timeout');
    await new Promise(r => setTimeout(r, 50));
  }
}

let currentUser = null;
let viewingProfile = null;
let isOwnProfile = false;
let isFollowing = false;
let mutedKeywords = [];

document.addEventListener('DOMContentLoaded', async () => {
  await waitForDb();

  currentUser = await window.auth.getUser();
  if (!currentUser) {
    window.location.href = '/login.html';
    return;
  }

  document.getElementById('logout-btn').addEventListener('click', async () => {
    await window.auth.signOut();
    window.location.href = '/';
  });

  const params = new URLSearchParams(window.location.search);
  const username = params.get('user') || params.get('u');

  if (username) {
    await loadProfileByUsername(username);
  } else {
    await loadOwnProfile();
  }
});

async function loadOwnProfile() {
  const { data: profile } = await window.db
    .from('profiles').select('*').eq('user_id', currentUser.id).single();

  if (!profile) {
    document.getElementById('profile-header').innerHTML = '<div class="loading">Profile not found.</div>';
    return;
  }

  viewingProfile = profile;
  isOwnProfile = true;
  mutedKeywords = profile.muted_keywords || [];
  renderProfile(profile);
  await Promise.all([
    loadProfilePosts(profile.user_id),
    loadProfileCommunities(),
    loadProfileAnalytics(profile.user_id)
  ]);
}

async function loadProfileByUsername(username) {
  const { data: profile } = await window.db
    .from('profiles').select('*').eq('username', username.toLowerCase()).single();

  if (!profile) {
    document.getElementById('profile-header').innerHTML = '<div class="loading">User not found.</div>';
    return;
  }

  viewingProfile = profile;
  isOwnProfile = profile.user_id === currentUser.id;
  mutedKeywords = profile.muted_keywords || [];

  if (!isOwnProfile) {
    const { data: followRow } = await window.db
      .from('follows').select('id')
      .eq('follower_id', currentUser.id).eq('following_id', profile.user_id).single();
    isFollowing = !!followRow;
  }

  renderProfile(profile);
  await Promise.all([
    loadProfilePosts(profile.user_id),
    loadProfileCommunities(),
    isOwnProfile ? loadProfileAnalytics(profile.user_id) : Promise.resolve()
  ]);
}

async function loadProfileAnalytics(userId) {
  const analyticsEl = document.getElementById('profile-analytics');
  if (!analyticsEl) return;

  try {
    const { data: posts } = await window.db
      .from('posts').select('id').eq('user_id', userId).eq('is_removed', false);

    if (!posts || posts.length === 0) {
      analyticsEl.style.display = 'block';
      document.getElementById('analytics-views').textContent = '0';
      document.getElementById('analytics-reactions').textContent = '0';
      document.getElementById('analytics-comments').textContent = '0';
      document.getElementById('analytics-engagement').textContent = '0%';
      return;
    }

    const postIds = posts.map(p => p.id);

    const [viewsRes, reactionsRes, commentsRes] = await Promise.all([
      window.db.from('post_views').select('post_id', { count: 'exact', head: true }).in('post_id', postIds),
      window.db.from('reactions').select('id', { count: 'exact', head: true }).in('target_id', postIds).eq('target_type', 'post'),
      window.db.from('comments').select('id', { count: 'exact', head: true }).in('post_id', postIds).eq('is_removed', false)
    ]);

    const totalViews = viewsRes.count || 0;
    const totalReactions = reactionsRes.count || 0;
    const totalComments = commentsRes.count || 0;
    const engagementRate = totalViews > 0
      ? ((totalReactions + totalComments) / totalViews * 100).toFixed(1)
      : '0.0';

    analyticsEl.style.display = 'block';
    document.getElementById('analytics-views').textContent = totalViews.toLocaleString();
    document.getElementById('analytics-reactions').textContent = totalReactions.toLocaleString();
    document.getElementById('analytics-comments').textContent = totalComments.toLocaleString();
    document.getElementById('analytics-engagement').textContent = engagementRate + '%';

  } catch (err) {
    console.error('Analytics error:', err);
  }
}

function renderProfile(profile) {
  const initial = (profile.username || '?').charAt(0).toUpperCase();
  document.getElementById('profile-avatar-large').textContent = initial;
  document.getElementById('profile-display-name').textContent = profile.display_name || profile.username;
  document.getElementById('profile-username').textContent = '@' + profile.username;
  document.getElementById('profile-post-count').textContent = (profile.post_count || 0).toLocaleString();
  document.getElementById('profile-follower-count').textContent = (profile.follower_count || 0).toLocaleString();
  document.getElementById('profile-following-count').textContent = (profile.following_count || 0).toLocaleString();

  if (profile.bio) document.getElementById('profile-bio').textContent = profile.bio;

  const metaEl = document.getElementById('profile-meta');
  if (metaEl) {
    const parts = [];
    if (profile.location) parts.push(`📍 ${escapeHtml(profile.location)}`);
    if (profile.website) parts.push(`🔗 <a href="${escapeHtml(profile.website)}" target="_blank" rel="noopener" style="color:var(--primary);text-decoration:none;">${escapeHtml(profile.website.replace(/^https?:\/\//, ''))}</a>`);
    metaEl.innerHTML = parts.join('<span style="margin:0 4px;">·</span>');
  }

  const badge = document.getElementById('verified-badge');
  if (badge && profile.is_verified) badge.style.display = 'inline';

  const repEl = document.getElementById('profile-reputation');
  if (repEl) {
    const rep = profile.reputation || 0;
    const label = getRepLabel(rep);
    const color = getRepColor(rep);
    repEl.innerHTML = `
      <span style="font-size:15px;font-weight:700;color:${color};">${rep.toLocaleString()}</span>
      <span style="font-size:13px;color:var(--text-muted);margin-left:6px;">${label}</span>
    `;
  }

  if (profile.is_adult_creator && !isOwnProfile) {
    const nameEl = document.getElementById('profile-display-name');
    if (nameEl && !document.querySelector('.adult-badge')) {
      const span = document.createElement('span');
      span.className = 'adult-badge';
      span.style.cssText = 'font-size:11px;padding:2px 8px;border-radius:100px;background:rgba(239,68,68,0.15);color:#ef4444;font-weight:600;margin-left:8px;';
      span.textContent = '🔞 Adult Creator';
      nameEl.after(span);
    }
  }

  if (isOwnProfile) {
    const editBtn = document.getElementById('edit-profile-btn');
    if (editBtn) {
      editBtn.style.display = 'block';
      editBtn.addEventListener('click', () => showEditForm(profile));
    }
  } else {
    const followBtn = document.getElementById('follow-btn');
    if (followBtn) {
      followBtn.style.display = 'block';
      followBtn.textContent = isFollowing ? 'Unfollow' : 'Follow';
      followBtn.className = isFollowing ? 'btn btn-ghost' : 'btn btn-primary';
      followBtn.addEventListener('click', handleFollowToggle);
    }
  }
}

async function handleFollowToggle() {
  const btn = document.getElementById('follow-btn');
  btn.disabled = true;
  try {
    if (isFollowing) {
      await window.db.from('follows').delete()
        .eq('follower_id', currentUser.id).eq('following_id', viewingProfile.user_id);
      await window.db.from('profiles')
        .update({ follower_count: Math.max((viewingProfile.follower_count || 1) - 1, 0) })
        .eq('user_id', viewingProfile.user_id);
      await window.db.from('profiles')
        .update({ following_count: Math.max((viewingProfile.following_count || 1) - 1, 0) })
        .eq('user_id', currentUser.id);
      isFollowing = false;
      viewingProfile.follower_count = Math.max((viewingProfile.follower_count || 1) - 1, 0);
    } else {
      await window.db.from('follows').insert({
        follower_id: currentUser.id, following_id: viewingProfile.user_id
      });
      await window.db.from('profiles')
        .update({ follower_count: (viewingProfile.follower_count || 0) + 1 })
        .eq('user_id', viewingProfile.user_id);
      await window.db.from('profiles')
        .update({ following_count: (viewingProfile.following_count || 0) + 1 })
        .eq('user_id', currentUser.id);
      isFollowing = true;
      viewingProfile.follower_count = (viewingProfile.follower_count || 0) + 1;
    }
    btn.textContent = isFollowing ? 'Unfollow' : 'Follow';
    btn.className = isFollowing ? 'btn btn-ghost' : 'btn btn-primary';
    document.getElementById('profile-follower-count').textContent = viewingProfile.follower_count.toLocaleString();
  } catch (err) {
    console.error('Follow error:', err);
  }
  btn.disabled = false;
}

function initToggle(checkboxId, trackId) {
  const checkbox = document.getElementById(checkboxId);
  const track = document.getElementById(trackId);
  if (!checkbox || !track || track.querySelector('span')) return;
  const knob = document.createElement('span');
  knob.style.cssText = 'position:absolute;height:18px;width:18px;left:3px;bottom:3px;background:#fff;border-radius:50%;transition:0.2s;pointer-events:none;';
  track.appendChild(knob);
  function update() {
    track.style.background = checkbox.checked ? 'var(--primary)' : 'var(--border)';
    knob.style.transform = checkbox.checked ? 'translateX(20px)' : 'translateX(0)';
  }
  track.addEventListener('click', () => { checkbox.checked = !checkbox.checked; update(); });
  update();
}

function setToggle(checkboxId, trackId, value) {
  const checkbox = document.getElementById(checkboxId);
  const track = document.getElementById(trackId);
  if (!checkbox || !track) return;
  checkbox.checked = value;
  track.style.background = value ? 'var(--primary)' : 'var(--border)';
  const knob = track.querySelector('span');
  if (knob) knob.style.transform = value ? 'translateX(20px)' : 'translateX(0)';
}

function renderKeywordTags() {
  const container = document.getElementById('muted-keywords-list');
  if (!container) return;
  if (mutedKeywords.length === 0) {
    container.innerHTML = '<span style="font-size:13px;color:var(--text-muted);font-style:italic;">No muted keywords yet.</span>';
    return;
  }
  container.innerHTML = mutedKeywords.map((kw, idx) => `
    <span style="display:inline-flex;align-items:center;gap:6px;padding:4px 10px;background:var(--bg-input);border:1px solid var(--border);border-radius:100px;font-size:13px;color:var(--text);">
      ${escapeHtml(kw)}
      <button data-idx="${idx}" class="remove-keyword-btn" style="background:none;border:none;cursor:pointer;color:var(--text-muted);font-size:14px;line-height:1;padding:0;">×</button>
    </span>
  `).join('');
  container.querySelectorAll('.remove-keyword-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      mutedKeywords.splice(parseInt(btn.dataset.idx), 1);
      renderKeywordTags();
    });
  });
}

function showEditForm(profile) {
  document.getElementById('edit-profile-form').style.display = 'block';
  document.getElementById('edit-display-name').value = profile.display_name || '';
  document.getElementById('edit-bio').value = profile.bio || '';
  document.getElementById('edit-location').value = profile.location || '';
  document.getElementById('edit-website').value = profile.website || '';
  mutedKeywords = [...(profile.muted_keywords || [])];
  renderKeywordTags();
  initToggle('toggle-show-adult', 'toggle-show-adult-track');
  initToggle('toggle-is-adult-creator', 'toggle-is-adult-creator-track');
  setToggle('toggle-show-adult', 'toggle-show-adult-track', !!profile.show_adult_content);
  setToggle('toggle-is-adult-creator', 'toggle-is-adult-creator-track', !!profile.is_adult_creator);
  const addBtn = document.getElementById('add-keyword-btn');
  const keywordInput = document.getElementById('keyword-input');
  addBtn.onclick = () => addKeyword();
  keywordInput.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); addKeyword(); } };
  document.getElementById('save-profile-btn').onclick = saveProfile;
  document.getElementById('cancel-edit-btn').onclick = () => {
    document.getElementById('edit-profile-form').style.display = 'none';
  };
}

function addKeyword() {
  const input = document.getElementById('keyword-input');
  const kw = input.value.trim().toLowerCase();
  if (!kw) return;
  if (mutedKeywords.length >= 50) { alert('Maximum 50 muted keywords.'); return; }
  if (mutedKeywords.includes(kw)) { input.value = ''; return; }
  mutedKeywords.push(kw);
  input.value = '';
  renderKeywordTags();
}

async function saveProfile() {
  const displayName = document.getElementById('edit-display-name').value.trim();
  const bio = document.getElementById('edit-bio').value.trim();
  const location = document.getElementById('edit-location').value.trim();
  const website = document.getElementById('edit-website').value.trim();
  const showAdultContent = document.getElementById('toggle-show-adult')?.checked || false;
  const isAdultCreator = document.getElementById('toggle-is-adult-creator')?.checked || false;
  const btn = document.getElementById('save-profile-btn');
  btn.textContent = 'Saving...';
  btn.disabled = true;
  try {
    const { error } = await window.db.from('profiles').update({
      display_name: displayName, bio, location, website,
      show_adult_content: showAdultContent,
      is_adult_creator: isAdultCreator,
      muted_keywords: mutedKeywords
    }).eq('user_id', currentUser.id);
    if (error) throw error;
    viewingProfile = { ...viewingProfile, display_name: displayName, bio, location, website, show_adult_content: showAdultContent, is_adult_creator: isAdultCreator, muted_keywords: mutedKeywords };
    document.getElementById('profile-display-name').textContent = displayName || viewingProfile.username;
    document.getElementById('profile-bio').textContent = bio;
    const metaEl = document.getElementById('profile-meta');
    if (metaEl) {
      const parts = [];
      if (location) parts.push(`📍 ${escapeHtml(location)}`);
      if (website) parts.push(`🔗 <a href="${escapeHtml(website)}" target="_blank" rel="noopener" style="color:var(--primary);text-decoration:none;">${escapeHtml(website.replace(/^https?:\/\//, ''))}</a>`);
      metaEl.innerHTML = parts.join('<span style="margin:0 4px;">·</span>');
    }
    document.getElementById('edit-profile-form').style.display = 'none';
  } catch (err) {
    console.error('Save profile error:', err);
  }
  btn.textContent = 'Save Profile';
  btn.disabled = false;
}

async function loadProfilePosts(userId) {
  const container = document.getElementById('profile-posts');
  const { data: posts } = await window.db
    .from('posts').select('*').eq('user_id', userId).eq('is_removed', false)
    .order('created_at', { ascending: false }).limit(20);

  if (!posts || posts.length === 0) {
    container.innerHTML = '<div class="loading">No posts yet.</div>';
    return;
  }

  const { data: profile } = await window.db
    .from('profiles').select('username, display_name, is_verified, verified_type, reputation')
    .eq('user_id', userId).single();

  const postIds = posts.map(p => p.id);

  const [reactionsRes, commentsRes] = await Promise.all([
    window.db.from('reactions').select('target_id, reaction_type').in('target_id', postIds).eq('target_type', 'post'),
    window.db.from('comments').select('post_id').in('post_id', postIds).eq('is_removed', false)
  ]);

  const reactionMap = {};
  if (reactionsRes.data) {
    reactionsRes.data.forEach(r => {
      if (!reactionMap[r.target_id]) reactionMap[r.target_id] = {};
      reactionMap[r.target_id][r.reaction_type] = (reactionMap[r.target_id][r.reaction_type] || 0) + 1;
    });
  }

  const commentCountMap = {};
  if (commentsRes.data) {
    commentsRes.data.forEach(c => { commentCountMap[c.post_id] = (commentCountMap[c.post_id] || 0) + 1; });
  }

  const username = profile?.username || 'unknown';
  const displayName = profile?.display_name || username;
  const initial = username.charAt(0).toUpperCase();
  const verifiedBadge = profile?.is_verified ? (() => {
    const badges = { staff: '🟣', notable: '⭐', identity: '🔵' };
    return `<span style="font-size:14px;">${badges[profile.verified_type] || '🔵'}</span>`;
  })() : '';
  const repBadge = repBadgeHtml(profile?.reputation);

  container.innerHTML = posts.map(post => {
    const timestamp = new Date(post.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    const postReactions = reactionMap[post.id] || {};
    const likes = postReactions.like || 0;
    const commentCount = commentCountMap[post.id] || 0;
    const adultBadge = post.is_adult
      ? `<span style="font-size:11px;padding:2px 8px;border-radius:100px;background:rgba(239,68,68,0.15);color:#ef4444;font-weight:600;margin-left:8px;">🔞</span>`
      : '';

    // Media display
    const mediaUrls = post.media_urls || [];
    let mediaHtml = '';
    if (mediaUrls.length > 0) {
      const grid = mediaUrls.length === 1 ? '1fr' : 'repeat(2,1fr)';
      mediaHtml = `<div style="display:grid;grid-template-columns:${grid};gap:6px;margin-top:10px;border-radius:10px;overflow:hidden;">
        ${mediaUrls.map(url => {
          const isVideo = url.match(/\.(mp4|mov|webm)(\?|$)/i);
          return isVideo
            ? `<video src="${url}" controls style="width:100%;max-height:300px;object-fit:cover;" playsinline></video>`
            : `<img src="${url}" style="width:100%;${mediaUrls.length===1?'max-height:300px;':'aspect-ratio:1;'}object-fit:cover;cursor:pointer;" onclick="window.open('${url}','_blank')" />`;
        }).join('')}
      </div>`;
    }

    const checkinHtml = post.checkin_location
      ? `<div style="font-size:13px;color:var(--text-muted);margin-top:6px;">📍 ${escapeHtml(post.checkin_location)}</div>`
      : '';

    return `
      <div class="post-card" data-post-id="${post.id}">
        <div class="post-header">
          <div class="post-avatar">${initial}</div>
          <div class="post-meta">
            <div class="post-username">
              ${escapeHtml(displayName)}
              ${verifiedBadge}
              <span style="font-weight:400;color:var(--text-muted);font-size:13px;">@${escapeHtml(username)}</span>
              ${repBadge}
              ${adultBadge}
            </div>
            <span class="post-timestamp">${timestamp}</span>
          </div>
        </div>
        <div class="post-content">${escapeHtml(post.content || '')}</div>
        ${checkinHtml}
        ${mediaHtml}
        <div class="post-actions">
          <button class="post-action-btn">❤️ ${likes > 0 ? likes : ''}</button>
          <button class="post-action-btn comment-link-btn" data-post-id="${post.id}">
            💬 ${commentCount > 0 ? commentCount : ''} Comment${commentCount !== 1 ? 's' : ''}
          </button>
          <button class="post-action-btn share-link-btn" data-post-id="${post.id}">🔗 Share</button>
          ${isOwnProfile ? `
            <button class="post-action-btn delete-btn" data-post-id="${post.id}" style="margin-left:auto;color:var(--danger);">🗑️</button>
          ` : ''}
        </div>
      </div>
    `;
  }).join('');

  container.querySelectorAll('.comment-link-btn').forEach(btn => {
    btn.addEventListener('click', () => { window.location.href = `/comments.html?post=${btn.dataset.postId}`; });
  });
  container.querySelectorAll('.share-link-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const url = `${window.location.origin}/comments.html?post=${btn.dataset.postId}`;
      navigator.clipboard.writeText(url).then(() => {
        btn.textContent = '✅ Copied';
        setTimeout(() => { btn.textContent = '🔗 Share'; }, 2000);
      });
    });
  });
  container.querySelectorAll('.delete-btn').forEach(btn => {
    btn.addEventListener('click', () => deletePost(btn.dataset.postId));
  });
}

async function deletePost(postId) {
  if (!confirm('Delete this post?')) return;
  await window.db.from('posts').update({ is_removed: true }).eq('id', postId);
  await loadProfilePosts(currentUser.id);
}

async function loadProfileCommunities() {
  const container = document.getElementById('profile-communities');
  if (!container) return;
  const { data: communities } = await window.db
    .from('communities').select('name, slug, logo_url').eq('is_official', true).order('name').limit(8);
  if (!communities) return;
  container.innerHTML = communities.map(c => {
    const logoHtml = c.logo_url
      ? `<img src="${c.logo_url}" alt="${escapeHtml(c.name)}" style="width:24px;height:24px;border-radius:4px;object-fit:cover;flex-shrink:0;" onerror="this.style.display='none'" />`
      : `<div style="width:24px;height:24px;border-radius:4px;background:var(--primary-dim);color:var(--primary);display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;flex-shrink:0;">${c.name.charAt(0)}</div>`;
    return `
      <a href="/community.html?slug=${c.slug}" style="display:flex;align-items:center;gap:8px;padding:10px 12px;border-radius:8px;margin-bottom:6px;background:var(--bg-card);border:1px solid var(--border);color:var(--text);font-size:14px;text-decoration:none;">
        ${logoHtml}
        <span style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(c.name)}</span>
      </a>
    `;
  }).join('');
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.appendChild(document.createTextNode(text));
  return div.innerHTML;
}
