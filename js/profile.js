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
    // Check if already following
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
  document.getElementById('profile-post-count').textContent = profile.post_count || 0;
  document.getElementById('profile-follower-count').textContent = profile.follower_count || 0;
  document.getElementById('profile-following-count').textContent = profile.following_count || 0;

  if (profile.bio) {
    document.getElementById('profile-bio').textContent = profile.bio;
  }

  if (isOwnProfile) {
    const editBtn = document.getElementById('edit-profile-btn');
    if (editBtn) {
      editBtn.style.display = 'block';
      editBtn.addEventListener('click', () => showEditForm(profile));
    }
  } else {
    // Show follow/unfollow button on other profiles
    const editBtn = document.getElementById('edit-profile-btn');
    if (editBtn) {
      editBtn.style.display = 'block';
      editBtn.textContent = isFollowing ? 'Unfollow' : 'Follow';
      editBtn.className = isFollowing ? 'btn btn-ghost' : 'btn btn-primary';
      editBtn.addEventListener('click', handleFollowToggle);
    }
  }
}

async function handleFollowToggle() {
  const btn = document.getElementById('edit-profile-btn');
  btn.disabled = true;

  try {
    if (isFollowing) {
      // Unfollow
      await window.db
        .from('follows')
        .delete()
        .eq('follower_id', currentUser.id)
        .eq('following_id', viewingProfile.user_id);

      // Decrement counts
      await window.db
        .from('profiles')
        .update({ follower_count: Math.max((viewingProfile.follower_count || 1) - 1, 0) })
        .eq('user_id', viewingProfile.user_id);

      await window.db
        .from('profiles')
        .update({ following_count: Math.max((currentUser.following_count || 1) - 1, 0) })
        .eq('user_id', currentUser.id);

      isFollowing = false;
      viewingProfile.follower_count = Math.max((viewingProfile.follower_count || 1) - 1, 0);

    } else {
      // Follow
      await window.db
        .from('follows')
        .insert({ follower_id: currentUser.id, following_id: viewingProfile.user_id });

      // Increment counts
      await window.db
        .from('profiles')
        .update({ follower_count: (viewingProfile.follower_count || 0) + 1 })
        .eq('user_id', viewingProfile.user_id);

      await window.db
        .from('profiles')
        .update({ following_count: (currentUser.following_count || 0) + 1 })
        .eq('user_id', currentUser.id);

      isFollowing = true;
      viewingProfile.follower_count = (viewingProfile.follower_count || 0) + 1;
    }

    // Update UI
    btn.textContent = isFollowing ? 'Unfollow' : 'Follow';
    btn.className = isFollowing ? 'btn btn-ghost' : 'btn btn-primary';
    document.getElementById('profile-follower-count').textContent = viewingProfile.follower_count;

  } catch (err) {
    console.error('Follow error:', err);
  }

  btn.disabled = false;
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

  // Fetch reaction counts
  const postIds = posts.map(p => p.id);
  const { data: reactions } = await window.db
    .from('reactions')
    .select('target_id, reaction_type')
    .in('target_id', postIds)
    .eq('target_type', 'post');

  const reactionMap = {};
  if (reactions) {
    reactions.forEach(r => {
      if (!reactionMap[r.target_id]) reactionMap[r.target_id] = { like: 0, downvote: 0 };
      reactionMap[r.target_id][r.reaction_type]++;
    });
  }

  // Fetch comment counts
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

  container.innerHTML = posts.map(post => {
    const username = profile?.username || 'unknown';
    const displayName = profile?.display_name || username;
    const initial = username.charAt(0).toUpperCase();
    const timestamp = new Date(post.created_at).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
    });
    const likes = reactionMap[post.id]?.like || 0;
    const downvotes = reactionMap[post.id]?.downvote || 0;
    const commentCount = commentCountMap[post.id] || 0;

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
          <button class="post-action-btn">❤️ ${likes}</button>
          <button class="post-action-btn comment-link-btn" data-post-id="${post.id}">💬 ${commentCount > 0 ? commentCount : ''} Comment${commentCount !== 1 ? 's' : ''}</button>
          <button class="post-action-btn">👎 ${downvotes}</button>
          <button class="post-action-btn share-btn" data-post-id="${post.id}">🔗 Share</button>
          ${isOwnProfile ? `<button class="post-action-btn delete-btn" data-post-id="${post.id}" style="margin-left:auto;color:var(--danger);">🗑️</button>` : ''}
        </div>
      </div>
    `;
  }).join('');

  // Attach listeners
  container.querySelectorAll('.comment-link-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      window.location.href = `/comments.html?post=${btn.dataset.postId}`;
    });
  });

  container.querySelectorAll('.share-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const url = `${window.location.origin}/post.html?id=${btn.dataset.postId}`;
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
