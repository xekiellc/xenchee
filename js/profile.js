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

  // Check if viewing own profile or another user's
  const params = new URLSearchParams(window.location.search);
  const username = params.get('u');

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
  renderProfile(profile);
  await loadProfilePosts(profile.user_id);
  await loadProfileCommunities();
}

function renderProfile(profile) {
  const initial = (profile.username || '?').charAt(0).toUpperCase();
  document.getElementById('profile-avatar-large').textContent = initial;
  document.getElementById('profile-display-name').textContent = profile.display_name || profile.username;
  document.getElementById('profile-username').textContent = '@' + profile.username;
  document.getElementById('profile-post-count').textContent = profile.post_count || 0;
  document.getElementById('profile-follower-count').textContent = profile.follower_count || 0;
  document.getElementById('profile-following-count').textContent = profile.following_count || 0;

  if (profile.bio) {
    document.getElementById('profile-bio').textContent = profile.bio;
  }

  if (isOwnProfile) {
    const editBtn = document.getElementById('edit-profile-btn');
    editBtn.style.display = 'block';
    editBtn.addEventListener('click', () => showEditForm(profile));
  }
}

function showEditForm(profile) {
  document.getElementById('edit-profile-form').style.display = 'block';
  document.getElementById('edit-display-name').value = profile.display_name || '';
  document.getElementById('edit-bio').value = profile.bio || '';
  document.getElementById('edit-location').value = profile.location || '';
  document.getElementById('edit-website').value = profile.website || '';

  document.getElementById('save-profile-btn').addEventListener('click', saveProfile);
  document.getElementById('cancel-edit-btn').addEventListener('click', () => {
    document.getElementById('edit-profile-form').style.display = 'none';
  });
}

async function saveProfile() {
  const displayName = document.getElementById('edit-display-name').value.trim();
  const bio = document.getElementById('edit-bio').value.trim();
  const location = document.getElementById('edit-location').value.trim();
  const website = document.getElementById('edit-website').value.trim();

  const btn = document.getElementById('save-profile-btn');
  btn.textContent = 'Saving...';
  btn.disabled = true;

  try {
    const { error } = await window.db
      .from('profiles')
      .update({ display_name: displayName, bio, location, website })
      .eq('user_id', currentUser.id);

    if (error) throw error;

    document.getElementById('profile-display-name').textContent = displayName || viewingProfile.username;
    document.getElementById('profile-bio').textContent = bio;
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

  container.innerHTML = posts.map(post => {
    const username = profile?.username || 'unknown';
    const displayName = profile?.display_name || username;
    const initial = username.charAt(0).toUpperCase();
    const timestamp = new Date(post.created_at).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
    });

    return `
      <div class="post-card">
        <div class="post-header">
          <div class="post-avatar">${initial}</div>
          <div class="post-meta">
            <div class="post-username">${escapeHtml(displayName)} <span style="font-weight:400;color:var(--text-muted);font-size:13px;">@${escapeHtml(username)}</span></div>
            <span class="post-timestamp">${timestamp}</span>
          </div>
        </div>
        <div class="post-content">${escapeHtml(post.content || '')}</div>
        <div class="post-actions">
          <button class="post-action-btn">❤️ 0</button>
          <button class="post-action-btn">💬 Comment</button>
          <button class="post-action-btn">👎 0</button>
          <button class="post-action-btn">🔗 Share</button>
          ${isOwnProfile ? `<button class="post-action-btn" onclick="deletePost('${post.id}')" style="margin-left:auto;color:var(--danger);">🗑️</button>` : ''}
        </div>
      </div>
    `;
  }).join('');
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
    .select('name, slug')
    .eq('is_official', true)
    .order('name')
    .limit(8);

  if (!communities) return;

  container.innerHTML = communities.map(c => `
    <a href="/community.html?slug=${c.slug}" style="display:block;padding:10px 12px;border-radius:8px;margin-bottom:6px;background:var(--bg-card);border:1px solid var(--border);color:var(--text);font-size:14px;text-decoration:none;transition:all 0.15s ease;">
      ${c.name}
    </a>
  `).join('');
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.appendChild(document.createTextNode(text));
  return div.innerHTML;
}
