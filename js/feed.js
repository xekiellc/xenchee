let currentUser = null;
let currentProfile = null;
let feedMode = 'all';
let pollVisible = false;

document.addEventListener('DOMContentLoaded', async () => {
  // Auth check
  currentUser = await auth.getUser();
  if (!currentUser) {
    window.location.href = '/login.html';
    return;
  }

  // Load profile
  const { data: profile } = await db
    .from('profiles')
    .select('*')
    .eq('user_id', currentUser.id)
    .single();

  currentProfile = profile;

  if (profile) {
    const avatar = document.getElementById('current-user-avatar');
    if (avatar) avatar.textContent = profile.username.charAt(0).toUpperCase();
  }

  // Setup
  await Promise.all([
    loadFeed(),
    loadSidebarCommunities(),
    loadTrendingCommunities(),
    loadEcosystemSidebar()
  ]);

  setupEventListeners();
});

function setupEventListeners() {
  // Post button
  document.getElementById('post-btn').addEventListener('click', handleCreatePost);

  // Logout
  document.getElementById('logout-btn').addEventListener('click', async () => {
    await auth.signOut();
    window.location.href = '/';
  });

  // Feed toggle
  document.getElementById('feed-all-btn').addEventListener('click', () => {
    feedMode = 'all';
    document.getElementById('feed-all-btn').className = 'btn btn-primary';
    document.getElementById('feed-following-btn').className = 'btn btn-ghost';
    loadFeed();
  });

  document.getElementById('feed-following-btn').addEventListener('click', () => {
    feedMode = 'following';
    document.getElementById('feed-all-btn').className = 'btn btn-ghost';
    document.getElementById('feed-following-btn').className = 'btn btn-primary';
    loadFeed();
  });

  // Poll toggle
  document.getElementById('poll-toggle-btn').addEventListener('click', () => {
    pollVisible = !pollVisible;
    document.getElementById('poll-creator').style.display = pollVisible ? 'block' : 'none';
  });

  // Add poll option
  document.getElementById('add-option-btn').addEventListener('click', () => {
    const container = document.getElementById('poll-options').querySelector('.form-group');
    const options = container.querySelectorAll('.poll-option');
    if (options.length >= 4) return;
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'form-input poll-option';
    input.placeholder = `Option ${options.length + 1}`;
    input.maxLength = 100;
    input.style.marginTop = '8px';
    container.appendChild(input);
  });
}

async function loadFeed() {
  const container = document.getElementById('feed-container');
  container.innerHTML = '<div class="loading"><div class="spinner"></div>Loading feed...</div>';

  try {
    let query = db
      .from('posts')
      .select(`
        *,
        profiles:user_id (username, display_name, avatar_url),
        communities:community_id (name, slug)
      `)
      .eq('is_removed', false)
      .order('created_at', { ascending: false })
      .limit(50);

    if (feedMode === 'following' && currentUser) {
      const { data: follows } = await db
        .from('follows')
        .select('following_id')
        .eq('follower_id', currentUser.id);

      const followingIds = follows ? follows.map(f => f.following_id) : [];
      if (followingIds.length === 0) {
        container.innerHTML = '<div class="loading">Follow some people to see their posts here.</div>';
        return;
      }
      query = query.in('user_id', followingIds);
    }

    const { data: posts, error } = await query;

    if (error) throw error;

    if (!posts || posts.length === 0) {
      container.innerHTML = '<div class="loading">No posts yet. Be the first to say something.</div>';
      return;
    }

    container.innerHTML = posts.map(post => renderPost(post)).join('');
    attachPostListeners();

  } catch (err) {
    console.error('Feed error:', err);
    container.innerHTML = '<div class="loading">Could not load feed. Please refresh.</div>';
  }
}

function renderPost(post) {
  const username = post.profiles?.username || 'unknown';
  const displayName = post.profiles?.display_name || username;
  const initial = username.charAt(0).toUpperCase();
  const community = post.communities ? `<span class="post-community">in ${post.communities.name}</span>` : '';
  const timestamp = new Date(post.created_at).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });

  return `
    <div class="post-card" data-post-id="${post.id}">
      <div class="post-header">
        <div class="post-avatar">${initial}</div>
        <div class="post-meta">
          <div class="post-username">${displayName} <span style="font-weight:400;color:var(--text-muted);font-size:13px;">@${username}</span></div>
          <div style="display:flex;gap:8px;align-items:center;">
            <span class="post-timestamp">${timestamp}</span>
            ${community}
          </div>
        </div>
      </div>
      <div class="post-content">${escapeHtml(post.content || '')}</div>
      <div class="post-actions">
        <button class="post-action-btn like-btn" data-post-id="${post.id}">
          ❤️ <span class="like-count">0</span>
        </button>
        <button class="post-action-btn comment-btn" data-post-id="${post.id}">
          💬 Comment
        </button>
        <button class="post-action-btn downvote-btn" data-post-id="${post.id}">
          👎 <span class="downvote-count">0</span>
        </button>
        <button class="post-action-btn share-btn" data-post-id="${post.id}">
          🔗 Share
        </button>
        ${post.user_id === currentUser?.id ? `
          <button class="post-action-btn delete-btn" data-post-id="${post.id}" style="margin-left:auto;color:var(--danger);">
            🗑️
          </button>
        ` : ''}
      </div>
    </div>
  `;
}

function attachPostListeners() {
  // Like buttons
  document.querySelectorAll('.like-btn').forEach(btn => {
    btn.addEventListener('click', () => handleReaction(btn.dataset.postId, 'like'));
  });

  // Downvote buttons
  document.querySelectorAll('.downvote-btn').forEach(btn => {
    btn.addEventListener('click', () => handleReaction(btn.dataset.postId, 'downvote'));
  });

  // Delete buttons
  document.querySelectorAll('.delete-btn').forEach(btn => {
    btn.addEventListener('click', () => handleDeletePost(btn.dataset.postId));
  });

  // Share buttons
  document.querySelectorAll('.share-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const url = `${window.location.origin}/post.html?id=${btn.dataset.postId}`;
      navigator.clipboard.writeText(url).then(() => {
        btn.textContent = '✅ Copied';
        setTimeout(() => { btn.textContent = '🔗 Share'; }, 2000);
      });
    });
  });
}

async function handleCreatePost() {
  if (!currentUser) return;

  const content = document.getElementById('post-content').value.trim();
  const hasPoll = pollVisible;

  if (!content && !hasPoll) {
    return;
  }

  const btn = document.getElementById('post-btn');
  btn.textContent = 'Posting...';
  btn.disabled = true;

  try {
    // Create post
    const { data: post, error: postError } = await db
      .from('posts')
      .insert({
        user_id: currentUser.id,
        content: content,
      })
      .select()
      .single();

    if (postError) throw postError;

    // Create poll if enabled
    if (hasPoll && post) {
      const question = document.getElementById('poll-question').value.trim();
      const optionInputs = document.querySelectorAll('.poll-option');
      const options = Array.from(optionInputs)
        .map(i => i.value.trim())
        .filter(v => v.length > 0);
      const duration = parseInt(document.getElementById('poll-duration').value);

      if (question && options.length >= 2) {
        const expiresAt = new Date();
        expiresAt.setHours(expiresAt.getHours() + duration);

        await db.from('polls').insert({
          post_id: post.id,
          user_id: currentUser.id,
          question: question,
          options: options,
          duration_hours: duration,
          expires_at: expiresAt.toISOString()
        });
      }
    }

    // Update post count
    await db
      .from('profiles')
      .update({ post_count: (currentProfile?.post_count || 0) + 1 })
      .eq('user_id', currentUser.id);

    // Reset form
    document.getElementById('post-content').value = '';
    document.getElementById('post-content').style.height = 'auto';
    if (hasPoll) {
      document.getElementById('poll-creator').style.display = 'none';
      document.getElementById('poll-question').value = '';
      document.querySelectorAll('.poll-option').forEach((el, i) => {
        if (i < 2) el.value = '';
        else el.remove();
      });
      pollVisible = false;
    }

    btn.textContent = 'Post';
    btn.disabled = false;

    // Reload feed
    await loadFeed();

  } catch (err) {
    console.error('Post error:', err);
    btn.textContent = 'Post';
    btn.disabled = false;
  }
}

async function handleReaction(postId, type) {
  if (!currentUser) return;

  try {
    const { data: existing } = await db
      .from('reactions')
      .select('*')
      .eq('user_id', currentUser.id)
      .eq('target_id', postId)
      .eq('target_type', 'post')
      .single();

    if (existing) {
      if (existing.reaction_type === type) {
        await db.from('reactions').delete().eq('id', existing.id);
      } else {
        await db.from('reactions').update({ reaction_type: type }).eq('id', existing.id);
      }
    } else {
      await db.from('reactions').insert({
        user_id: currentUser.id,
        target_id: postId,
        target_type: 'post',
        reaction_type: type
      });
    }
  } catch (err) {
    console.error('Reaction error:', err);
  }
}

async function handleDeletePost(postId) {
  if (!currentUser) return;
  if (!confirm('Delete this post?')) return;

  await db.from('posts').update({ is_removed: true }).eq('id', postId).eq('user_id', currentUser.id);
  await loadFeed();
}

async function loadSidebarCommunities() {
  const container = document.getElementById('sidebar-communities');
  if (!container) return;

  const { data: communities } = await db
    .from('communities')
    .select('name, slug')
    .eq('is_official', true)
    .order('name')
    .limit(8);

  if (!communities) return;

  container.innerHTML = communities.map(c => `
    <a href="/community.html?slug=${c.slug}" style="display:block;padding:8px 16px;border-radius:8px;color:var(--text-secondary);font-size:14px;text-decoration:none;transition:all 0.15s ease;">
      ${c.name}
    </a>
  `).join('');

  container.querySelectorAll('a').forEach(a => {
    a.addEventListener('mouseover', () => { a.style.background = 'var(--bg-hover)'; a.style.color = 'var(--text)'; });
    a.addEventListener('mouseout', () => { a.style.background = ''; a.style.color = 'var(--text-secondary)'; });
  });
}

async function loadTrendingCommunities() {
  const container = document.getElementById('trending-communities');
  if (!container) return;

  const { data: communities } = await db
    .from('communities')
    .select('name, slug, member_count, description')
    .eq('is_official', true)
    .order('member_count', { ascending: false })
    .limit(5);

  if (!communities) return;

  container.innerHTML = communities.map(c => `
    <a href="/community.html?slug=${c.slug}" style="display:block;padding:12px;border-radius:8px;margin-bottom:8px;background:var(--bg-card);border:1px solid var(--border);text-decoration:none;transition:all 0.15s ease;">
      <div style="font-size:14px;font-weight:600;color:var(--text);margin-bottom:4px;">${c.name}</div>
      <div style="font-size:12px;color:var(--text-muted);">${c.member_count > 0 ? c.member_count.toLocaleString() + ' members' : 'New community'}</div>
    </a>
  `).join('');
}

async function loadEcosystemSidebar() {
  const container = document.getElementById('ecosystem-sidebar');
  if (!container) return;

  const { data: cards } = await db
    .from('ecosystem_cards')
    .select('name, tagline, status, external_url')
    .order('display_order');

  if (!cards) return;

  container.innerHTML = cards.map(card => `
    <div style="padding:12px;border-radius:8px;margin-bottom:8px;background:var(--bg-card);border:1px solid var(--border);">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
        <div style="font-size:14px;font-weight:700;color:var(--text);">${card.name}</div>
        <span style="font-size:11px;padding:2px 8px;border-radius:100px;font-weight:600;${card.status === 'live' ? 'background:rgba(76,175,125,0.2);color:#4caf7d;' : 'background:rgba(245,166,35,0.2);color:#f5a623;'}">
          ${card.status === 'live' ? 'Live' : 'Soon'}
        </span>
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
