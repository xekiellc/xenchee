async function waitForDb(timeout = 5000) {
  const start = Date.now();
  while (!window.db) {
    if (Date.now() - start > timeout) throw new Error('Supabase init timeout');
    await new Promise(r => setTimeout(r, 50));
  }
}

let currentUser = null;
let currentProfile = null;
let feedMode = 'all';
let pollVisible = false;

const REACTIONS = [
  { type: 'like', emoji: '❤️', label: 'Like' },
  { type: 'haha', emoji: '😂', label: 'Haha' },
  { type: 'wow', emoji: '😮', label: 'Wow' },
  { type: 'sad', emoji: '😢', label: 'Sad' },
  { type: 'angry', emoji: '😡', label: 'Angry' },
  { type: 'downvote', emoji: '👎', label: 'Downvote' }
];

document.addEventListener('DOMContentLoaded', async () => {
  await waitForDb();

  currentUser = await window.auth.getUser();
  if (!currentUser) {
    window.location.href = '/login.html';
    return;
  }

  const { data: profile } = await window.db
    .from('profiles')
    .select('*')
    .eq('user_id', currentUser.id)
    .single();

  currentProfile = profile;

  if (profile) {
    const avatar = document.getElementById('current-user-avatar');
    if (avatar) avatar.textContent = profile.username.charAt(0).toUpperCase();
  }

  // Init mention autocomplete on post composer
  initMentionAutocomplete('post-content', 'post-mention-dropdown');

  await Promise.all([
    loadFeed(),
    loadSidebarCommunities(),
    loadTrendingCommunities(),
    loadEcosystemSidebar(),
    loadNotifBadge()
  ]);

  setupEventListeners();

  // Close reaction pickers on outside click
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.reaction-btn-wrapper')) {
      document.querySelectorAll('.reaction-picker').forEach(p => p.style.display = 'none');
    }
  });
});

async function loadNotifBadge() {
  const badge = document.getElementById('notif-badge');
  if (!badge || !currentUser) return;

  try {
    const { count } = await window.db
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', currentUser.id)
      .eq('is_read', false);

    if (count && count > 0) {
      badge.textContent = count > 99 ? '99+' : count;
      badge.style.display = 'inline-flex';
    } else {
      badge.style.display = 'none';
    }
  } catch (err) {
    console.error('Notif badge error:', err);
  }
}

function setupEventListeners() {
  document.getElementById('post-btn').addEventListener('click', handleCreatePost);

  document.getElementById('logout-btn').addEventListener('click', async () => {
    await window.auth.signOut();
    window.location.href = '/';
  });

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

  document.getElementById('poll-toggle-btn').addEventListener('click', () => {
    pollVisible = !pollVisible;
    document.getElementById('poll-creator').style.display = pollVisible ? 'block' : 'none';
  });

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
    let postsQuery = window.db
      .from('posts')
      .select('*')
      .eq('is_removed', false)
      .order('created_at', { ascending: false })
      .limit(50);

    if (feedMode === 'following' && currentUser) {
      const { data: follows } = await window.db
        .from('follows')
        .select('following_id')
        .eq('follower_id', currentUser.id);

      const followingIds = follows ? follows.map(f => f.following_id) : [];
      if (followingIds.length === 0) {
        container.innerHTML = '<div class="loading">Follow some people to see their posts here.</div>';
        return;
      }
      postsQuery = postsQuery.in('user_id', followingIds);
    }

    const { data: posts, error } = await postsQuery;
    if (error) throw error;

    if (!posts || posts.length === 0) {
      container.innerHTML = '<div class="loading">No posts yet. Be the first to say something.</div>';
      return;
    }

    const userIds = [...new Set(posts.map(p => p.user_id))];
    const { data: profiles } = await window.db
      .from('profiles')
      .select('user_id, username, display_name, avatar_url')
      .in('user_id', userIds);

    const profileMap = {};
    if (profiles) profiles.forEach(p => { profileMap[p.user_id] = p; });

    const communityIds = [...new Set(posts.filter(p => p.community_id).map(p => p.community_id))];
    let communityMap = {};
    if (communityIds.length > 0) {
      const { data: communities } = await window.db
        .from('communities')
        .select('id, name, slug')
        .in('id', communityIds);
      if (communities) communities.forEach(c => { communityMap[c.id] = c; });
    }

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

    let myReactionMap = {};
    if (currentUser) {
      const { data: myReactions } = await window.db
        .from('reactions')
        .select('target_id, reaction_type')
        .in('target_id', postIds)
        .eq('target_type', 'post')
        .eq('user_id', currentUser.id);
      if (myReactions) {
        myReactions.forEach(r => { myReactionMap[r.target_id] = r.reaction_type; });
      }
    }

    container.innerHTML = posts.map(post =>
      renderPost(post, profileMap, communityMap, reactionMap, commentCountMap, myReactionMap)
    ).join('');

    attachPostListeners();

  } catch (err) {
    console.error('Feed error:', err);
    container.innerHTML = '<div class="loading">Could not load feed. Please refresh.</div>';
  }
}

function renderPost(post, profileMap, communityMap, reactionMap, commentCountMap, myReactionMap) {
  const profile = profileMap[post.user_id];
  const username = profile?.username || 'unknown';
  const displayName = profile?.display_name || username;
  const initial = username.charAt(0).toUpperCase();
  const community = post.community_id && communityMap[post.community_id]
    ? `<span class="post-community">in ${communityMap[post.community_id].name}</span>`
    : '';
  const timestamp = new Date(post.created_at).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
  });

  const commentCount = commentCountMap[post.id] || 0;
  const myReaction = myReactionMap[post.id];
  const postReactions = reactionMap[post.id] || {};

  const totalReactions = Object.values(postReactions).reduce((a, b) => a + b, 0);
  const topEmojis = REACTIONS
    .filter(r => postReactions[r.type] > 0)
    .sort((a, b) => (postReactions[b.type] || 0) - (postReactions[a.type] || 0))
    .slice(0, 3)
    .map(r => r.emoji)
    .join('');

  const reactionSummary = totalReactions > 0
    ? `<span class="reaction-summary" style="font-size:13px;color:var(--text-muted);cursor:pointer;">${topEmojis} ${totalReactions}</span>`
    : '';

  const myReactionObj = REACTIONS.find(r => r.type === myReaction);
  const reactBtnLabel = myReactionObj ? `${myReactionObj.emoji} ${myReactionObj.label}` : '❤️ React';
  const reactBtnStyle = myReaction ? 'font-weight:700;color:var(--primary);' : '';

  return `
    <div class="post-card" data-post-id="${post.id}">
      <div class="post-header">
        <div class="post-avatar" style="cursor:pointer;" onclick="window.location.href='/profile.html?user=${encodeURIComponent(username)}'">${initial}</div>
        <div class="post-meta">
          <div class="post-username">
            <a href="/profile.html?user=${encodeURIComponent(username)}" style="text-decoration:none;color:inherit;">${escapeHtml(displayName)}</a>
            <span style="font-weight:400;color:var(--text-muted);font-size:13px;">@${escapeHtml(username)}</span>
          </div>
          <div style="display:flex;gap:8px;align-items:center;">
            <span class="post-timestamp">${timestamp}</span>
            ${community}
          </div>
        </div>
      </div>
      <div class="post-content">${renderMentions(post.content || '')}</div>
      ${reactionSummary ? `<div style="padding:4px 0 8px 0;">${reactionSummary}</div>` : ''}
      <div class="post-actions">
        <div class="reaction-btn-wrapper" style="position:relative;">
          <button class="post-action-btn react-btn" data-post-id="${post.id}" style="${reactBtnStyle}">
            ${reactBtnLabel}
          </button>
          <div class="reaction-picker" data-post-id="${post.id}" style="display:none;position:absolute;bottom:36px;left:0;background:var(--bg-card);border:1px solid var(--border);border-radius:100px;padding:6px 10px;gap:4px;z-index:100;box-shadow:0 4px 20px rgba(0,0,0,0.3);">
            ${REACTIONS.map(r => `
              <button class="reaction-option" data-post-id="${post.id}" data-type="${r.type}" title="${r.label}"
                style="background:none;border:none;cursor:pointer;font-size:22px;padding:2px 4px;border-radius:50%;transition:transform 0.1s ease;${myReaction === r.type ? 'transform:scale(1.3);' : ''}"
                onmouseover="this.style.transform='scale(1.3)'"
                onmouseout="this.style.transform='${myReaction === r.type ? 'scale(1.3)' : 'scale(1)'}'">
                ${r.emoji}
              </button>
            `).join('')}
          </div>
        </div>
        <button class="post-action-btn comment-btn" data-post-id="${post.id}">
          💬 <span>${commentCount > 0 ? commentCount : ''} Comment${commentCount !== 1 ? 's' : ''}</span>
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
      const picker = document.querySelector(`.reaction-picker[data-post-id="${postId}"]`);
      picker.style.display = 'none';
      handleReaction(postId, type);
    });
  });

  document.querySelectorAll('.delete-btn').forEach(btn => {
    btn.addEventListener('click', () => handleDeletePost(btn.dataset.postId));
  });

  document.querySelectorAll('.share-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const url = `${window.location.origin}/post.html?id=${btn.dataset.postId}`;
      navigator.clipboard.writeText(url).then(() => {
        btn.textContent = '✅ Copied';
        setTimeout(() => { btn.textContent = '🔗 Share'; }, 2000);
      });
    });
  });

  document.querySelectorAll('.comment-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      window.location.href = `/comments.html?post=${btn.dataset.postId}`;
    });
  });
}

async function handleReaction(postId, type) {
  if (!currentUser) return;

  try {
    const { data: existing } = await window.db
      .from('reactions')
      .select('*')
      .eq('user_id', currentUser.id)
      .eq('target_id', postId)
      .eq('target_type', 'post')
      .single();

    if (existing) {
      if (existing.reaction_type === type) {
        await window.db.from('reactions').delete().eq('id', existing.id);
      } else {
        await window.db.from('reactions').update({ reaction_type: type }).eq('id', existing.id);
      }
    } else {
      await window.db.from('reactions').insert({
        user_id: currentUser.id,
        target_id: postId,
        target_type: 'post',
        reaction_type: type
      });
    }

    await refreshPostReactions(postId);

  } catch (err) {
    console.error('Reaction error:', err);
  }
}

async function refreshPostReactions(postId) {
  const { data: reactions } = await window.db
    .from('reactions')
    .select('reaction_type')
    .eq('target_id', postId)
    .eq('target_type', 'post');

  const card = document.querySelector(`.post-card[data-post-id="${postId}"]`);
  if (!card) return;

  const counts = {};
  if (reactions) {
    reactions.forEach(r => {
      counts[r.reaction_type] = (counts[r.reaction_type] || 0) + 1;
    });
  }

  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const topEmojis = REACTIONS
    .filter(r => counts[r.type] > 0)
    .sort((a, b) => (counts[b.type] || 0) - (counts[a.type] || 0))
    .slice(0, 3)
    .map(r => r.emoji)
    .join('');

  let summary = card.querySelector('.reaction-summary');
  if (total > 0) {
    if (!summary) {
      const summaryDiv = document.createElement('div');
      summaryDiv.style.cssText = 'padding:4px 0 8px 0;';
      summaryDiv.innerHTML = `<span class="reaction-summary" style="font-size:13px;color:var(--text-muted);cursor:pointer;"></span>`;
      card.querySelector('.post-content').after(summaryDiv);
      summary = card.querySelector('.reaction-summary');
    }
    summary.textContent = `${topEmojis} ${total}`;
  } else if (summary) {
    summary.parentElement.remove();
  }

  const { data: myReaction } = await window.db
    .from('reactions')
    .select('reaction_type')
    .eq('target_id', postId)
    .eq('target_type', 'post')
    .eq('user_id', currentUser.id)
    .single();

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

  if (!content && !hasPoll) return;

  const btn = document.getElementById('post-btn');
  btn.textContent = 'Posting...';
  btn.disabled = true;

  try {
    const { data: post, error: postError } = await window.db
      .from('posts')
      .insert({ user_id: currentUser.id, content: content })
      .select()
      .single();

    if (postError) throw postError;

    if (hasPoll && post) {
      const question = document.getElementById('poll-question').value.trim();
      const optionInputs = document.querySelectorAll('.poll-option');
      const options = Array.from(optionInputs).map(i => i.value.trim()).filter(v => v.length > 0);
      const duration = parseInt(document.getElementById('poll-duration').value);

      if (question && options.length >= 2) {
        const expiresAt = new Date();
        expiresAt.setHours(expiresAt.getHours() + duration);
        await window.db.from('polls').insert({
          post_id: post.id,
          user_id: currentUser.id,
          question,
          options,
          duration_hours: duration,
          expires_at: expiresAt.toISOString()
        });
      }
    }

    await window.db
      .from('profiles')
      .update({ post_count: (currentProfile?.post_count || 0) + 1 })
      .eq('user_id', currentUser.id);

    document.getElementById('post-content').value = '';
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
    await loadFeed();

  } catch (err) {
    console.error('Post error:', err);
    btn.textContent = 'Post';
    btn.disabled = false;
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

  const { data: communities } = await window.db
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

  const { data: communities } = await window.db
    .from('communities')
    .select('name, slug, member_count')
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

  const { data: cards } = await window.db
    .from('ecosystem_cards')
    .select('name, tagline, status')
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
