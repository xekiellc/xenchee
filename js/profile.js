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
    .from('profiles')
    .select('*')
    .eq('user_id', currentUser.id)
    .single();

  if (!profile) {
    document.getElementById('profile-header').innerHTML = '<div class="loading">Profile not found.</div>';
    return;
  }

  viewingProfile = profile;
  isOwnProfile = true;
  renderProfile(profile);
  await loadProfilePosts(profile.user_id);
  await loadProfileCommunities();
}

async function loadProfileByUsername(username) {
  const { data: profile } = await window.db
    .from('profiles')
    .select('*')
    .eq('username', username.toLowerCase())
    .single();

  if (!profile) {
    document.getElementById('profile-header').innerHTML = '<div class="loading">User not found.</div>';
    return;
  }

  viewingProfile = profile;
  isOwnProfile = profile.user_id === currentUser.id;

  if (!isOwnProfile) {
    const { data: followRow } = await window.db
      .from('follows')
      .select('id')
      .eq('follower_id', currentUser.id)
      .eq('following_id', profile.user_id)
      .single();
    isFollowing = !!followRow;
  }

  renderProfile(profile);
  await loadProfilePosts(profile.user_id);
  await loadProfileCommunities();
}

function renderProfile(profile) {
  const initial = (profile.username || '?').charAt(0).toUpperCase();
  document.getElementById('profile-avatar-large').textContent = initial;
  document.getElementById('profile-display-name').textContent = profile.display_name || profile.username;
  document.getElementById('profile-username').textContent = '@' + profile.username;
  document.getElementById('profile-post-count').textContent = (profile.post_count || 0).toLocaleString();
  document.getElementById('profile-follower-count').textContent = (profile.follower_count || 0).toLocaleString();
  document.getElementById('profile-following-count').textContent = (profile.following_count || 0).toLocaleString();

  if (profile.bio) {
    document.getElementById('profile-bio').textContent = profile.bio;
  }

  // Meta row — location and website
  const metaEl = document.getElementById('profile-meta');
  if (metaEl) {
    const parts = [];
    if (profile.location) parts.push(`📍 ${escapeHtml(profile.location)}`);
    if (profile.website) parts.push(`🔗 <a href="${escapeHtml(profile.website)}" target="_blank" rel="noopener" style="color:var(--primary);text-decoration:none;">${escapeHtml(profile.website.replace(/^https?:\/\//, ''))}</a>`);
    metaEl.innerHTML = parts.join('<span style="margin:0 4px;">·</span>');
  }

  // Verified badge
  const badge = document.getElementById('verified-badge');
  if (badge && profile.is_verified) badge.style.display = 'inline';

  // Adult creator badge
  if (profile.is_adult_creator && !isOwnProfile) {
    const nameEl = document.getElementById('profile-display-name');
    if (nameEl && !nameEl.nextElementSibling?.classList?.contains('adult-badge')) {
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
      await window.db
        .from('follows')
        .delete()
        .eq('follower_id', currentUser.id)
        .eq('following_id', viewingProfile.user_id);

      await window.db
        .from('profiles')
        .update({ follower_count: Math.max((viewingProfile.follower_count || 1) - 1, 0) })
        .eq('user_id', viewingProfile.user_id);

      await window.db
        .from('profiles')
        .update({ following_count: Math.max((viewingProfile.following_count || 1) - 1, 0) })
        .eq('user_id', currentUser.id);

      isFollowing = false;
      viewingProfile.follower_count = Math.max((viewingProfile.follower_count || 1) - 1, 0);

    } else {
      await window.db
        .from('follows')
        .insert({ follower_id: currentUser.id, following_id: viewingProfile.user_id });

      await window.db
        .from('profiles')
        .update({ follower_count: (viewingProfile.follower_count || 0) + 1 })
        .eq('user_id', viewingProfile.user_id);

      await window.db
        .from('profiles')
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

function setToggle(checkboxId, trackId, value) {
  const checkbox = document.getElementById(checkboxId);
  const track = document.getElementById(trackId);
  if (!checkbox || !track) return;
  checkbox.checked = value;
  track.style.background = value ? 'var(--primary)' : 'var(--border)';
  if (value) {
    track.style.setProperty('--toggle-x', '20px');
  }
}

function initToggle(checkboxId, trackId) {
  const checkbox = document.getElementById(checkboxId);
  const track = document.getElementById(trackId);
  if (!checkbox || !track) return;

  // Create the knob
  const knob = document.createElement('span');
  knob.style.cssText = `
    position:absolute;
    height:18px;width:18px;
    left:3px;bottom:3px;
    background:#fff;
    border-radius:50%;
    transition:0.2s;
    pointer-events:none;
  `;
  track.appendChild(knob);

  function update() {
    track.style.background = checkbox.checked ? 'var(--primary)' : 'var(--border)';
    knob.style.transform = checkbox.checked ? 'translateX(20px)' : 'translateX(0)';
  }

  track.addEventListener('click', () => {
    checkbox.checked = !checkbox.checked;
    update();
  });

  update();
}

function showEditForm(profile) {
  document.getElementById('edit-profile-form').style.display = 'block';
  document.getElementById('edit-display-name').value = profile.display_name || '';
  document.getElementById('edit-bio').value = profile.bio || '';
  document.getElementById('edit-location').value = profile.location || '';
  document.getElementById('edit-website').value = profile.website || '';

  // Init toggles
  initToggle('toggle-show-adult', 'toggle-show-adult-track');
  initToggle('toggle-is-adult-creator', 'toggle-is-adult-creator-track');

  // Set current values
  const showAdult = document.getElementById('toggle-show-adult');
  const isCreator = document.getElementById('toggle-is-adult-creator');
  const showAdultTrack = document.getElementById('toggle-show-adult-track');
  const isCreatorTrack = document.getElementById('toggle-is-adult-creator-track');

  if (showAdult) {
    showAdult.checked = !!profile.show_adult_content;
    showAdultTrack.style.background = profile.show_adult_content ? 'var(--primary)' : 'var(--border)';
    const knob = showAdultTrack.querySelector('span');
    if (knob) knob.style.transform = profile.show_adult_content ? 'translateX(20px)' : 'translateX(0)';
  }

  if (isCreator) {
    isCreator.checked = !!profile.is_adult_creator;
    isCreatorTrack.style.background = profile.is_adult_creator ? 'var(--primary)' : 'var(--border)';
    const knob = isCreatorTrack.querySelector('span');
    if (knob) knob.style.transform = profile.is_adult_creator ? 'translateX(20px)' : 'translateX(0)';
  }

  document.getElementById('save-profile-btn').onclick = saveProfile;
  document.getElementById('cancel-edit-btn').onclick = () => {
    document.getElementById('edit-profile-form').style.display = 'none';
  };
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
    const { error } = await window.db
      .from('profiles')
      .update({
        display_name: displayName,
        bio,
        location,
        website,
        show_adult_content: showAdultContent,
        is_adult_creator: isAdultCreator
      })
      .eq('user_id', currentUser.id);

    if (error) throw error;

    // Update local profile
    viewingProfile.display_name = displayName;
    viewingProfile.bio = bio;
    viewingProfile.location = location;
    viewingProfile.website = website;
    viewingProfile.show_adult_content = showAdultContent;
    viewingProfile.is_adult_creator = isAdultCreator;

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

    btn.textContent = 'Save Profile';
    btn.disabled = false;

  } catch (err) {
    console.error('Save profile error:', err);
    btn.textContent = 'Save Profile';
    btn.disabled = false;
  }
}

async function loadProfilePosts(userId) {
  const container = document.getElementById('profile-posts');

  const { data: posts } = await window.db
    .from('posts')
    .select('*')
    .eq('user_id', userId)
    .eq('is_removed', false)
    .order('created_at', { ascending: false })
    .limit(20);

  if (!posts || posts.length === 0) {
    container.innerHTML = '<div class="loading">No posts yet.</div>';
    return;
  }

  const { data: profile } = await window.db
    .from('profiles')
    .select('username, display_name')
    .eq('user_id', userId)
    .single();

  const postIds = posts.map(p => p.id);

  const { data: reactions } = await window.db
    .from('reactions')
    .select('target_id, reaction_type')
    .in('target_id', postIds)
    .eq('target_type', 'post');

  const reactionMap = {};
  if (reactions) {
    reactions.forEach(r => {
      if (!reactionMap[r.target_id]) reactionMap[r.target_id] = {};
      reactionMap[r.target_id][r.reaction_type] = (reactionMap[r.target_id][r.reaction_type] || 0) + 1;
    });
  }

  const { data: comments } = await window.db
    .from('comments')
    .select('post_id')
    .in('post_id', postIds)
    .eq('is_removed', false);

  const commentCountMap = {};
  if (comments) {
    comments.forEach(c => {
      commentCountMap[c.post_id] = (commentCountMap[c.post_id] || 0) + 1;
    });
  }

  const username = profile?.username || 'unknown';
  const displayName = profile?.display_name || username;
  const initial = username.charAt(0).toUpperCase();

  container.innerHTML = posts.map(post => {
    const timestamp = new Date(post.created_at).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
    });

    const postReactions = reactionMap[post.id] || {};
    const totalReactions = Object.values(postReactions).reduce((a, b) => a + b, 0);
    const likes = postReactions.like || 0;
    const commentCount = commentCountMap[post.id] || 0;

    const adultBadge = post.is_adult
      ? `<span style="font-size:11px;padding:2px 8px;border-radius:100px;background:rgba(239,68,68,0.15);color:#ef4444;font-weight:600;margin-left:8px;">🔞</span>`
      : '';

    return `
      <div class="post-card" data-post-id="${post.id}">
        <div class="post-header">
          <div class="post-avatar">${initial}</div>
          <div class="post-meta">
            <div class="post-username">
              ${escapeHtml(displayName)}
              <span style="font-weight:400;color:var(--text-muted);font-size:13px;">@${escapeHtml(username)}</span>
              ${adultBadge}
            </div>
            <span class="post-timestamp">${timestamp}</span>
          </div>
        </div>
        <div class="post-content">${escapeHtml(post.content || '')}</div>
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
    btn.addEventListener('click', () => {
      window.location.href = `/comments.html?post=${btn.dataset.postId}`;
    });
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
    .from('communities')
    .select('name, slug, logo_url')
    .eq('is_official', true)
    .order('name')
    .limit(8);

  if (!communities) return;

  container.innerHTML = communities.map(c => {
    const logoHtml = c.logo_url
      ? `<img src="${c.logo_url}" alt="${escapeHtml(c.name)}" style="width:24px;height:24px;border-radius:4px;object-fit:cover;flex-shrink:0;" onerror="this.style.display='none'" />`
      : `<div style="width:24px;height:24px;border-radius:4px;background:var(--primary);color:#fff;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;flex-shrink:0;">${c.name.charAt(0)}</div>`;
    return `
      <a href="/community.html?slug=${c.slug}" style="display:flex;align-items:center;gap:8px;padding:10px 12px;border-radius:8px;margin-bottom:6px;background:var(--bg-card);border:1px solid var(--border);color:var(--text);font-size:14px;text-decoration:none;transition:all 0.15s ease;">
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
