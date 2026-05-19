async function waitForDb(timeout = 5000) {
  const start = Date.now();
  while (!window.db) {
    if (Date.now() - start > timeout) throw new Error('Supabase init timeout');
    await new Promise(r => setTimeout(r, 50));
  }
}

let currentUser = null;
let currentProfile = null;
let currentCommunity = null;

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
  const slug = params.get('slug');

  if (!slug) {
    window.location.href = '/communities.html';
    return;
  }

  const { data: profile } = await window.db
    .from('profiles')
    .select('*')
    .eq('user_id', currentUser.id)
    .single();

  currentProfile = profile;

  if (profile) {
    document.getElementById('user-avatar').textContent = profile.username.charAt(0).toUpperCase();
  }

  document.getElementById('post-btn').addEventListener('click', handleCreatePost);

  await loadCommunity(slug);
  await loadOtherCommunities(slug);
});

async function loadCommunity(slug) {
  const { data: community, error } = await window.db
    .from('communities')
    .select('*')
    .eq('slug', slug)
    .single();

  if (error || !community) {
    document.getElementById('community-header').innerHTML = '<div class="loading">Community not found.</div>';
    return;
  }

  currentCommunity = community;
  document.title = community.name + ' — XenChee';

  document.getElementById('community-name').textContent = community.name;
  document.getElementById('community-slug').textContent = 'xenchee.com/c/' + community.slug;
  document.getElementById('community-description').textContent = community.description || '';
  document.getElementById('community-member-count').textContent = community.member_count || 0;

  // Join button
  const joinBtn = document.getElementById('join-btn');
  joinBtn.style.display = 'block';

  const { data: membership } = await window.db
    .from('community_members')
    .select('id')
    .eq('community_id', community.id)
    .eq('user_id', currentUser.id)
    .single();

  if (membership) {
    joinBtn.textContent = 'Joined ✓';
    joinBtn.className = 'btn btn-ghost';
  } else {
    joinBtn.textContent = 'Join Community';
    joinBtn.addEventListener('click', () => handleJoin(community.id));
  }

  // Rules sidebar
  if (community.rules && community.rules.length > 0) {
    document.getElementById('community-rules-sidebar').innerHTML = `
      <div style="font-size:13px;font-weight:700;color:var(--text-secondary);text-transform:uppercase;letter-spacing:1px;margin-bottom:16px;">Community Rules</div>
      ${community.rules.map((rule, i) => `
        <div style="padding:10px 12px;background:var(--bg-card);border:1px solid var(--border);border-radius:8px;margin-bottom:8px;font-size:13px;color:var(--text-secondary);">
          <span style="font-weight:700;color:var(--text);">${i + 1}.</span> ${escapeHtml(rule)}
        </div>
      `).join('')}
    `;
  }

  await loadCommunityPosts(community.id);
}

async function loadCommunityPosts(communityId) {
  const container = document.getElementById('community-posts');
  container.innerHTML = '<div class="loading"><div class="spinner"></div>Loading posts...</div>';

  try {
    const { data: posts, error } = await window.db
      .from('posts')
      .select('*')
      .eq('community_id', communityId)
      .eq('is_removed', false)
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) throw error;

    document.getElementById('community-post-count').textContent = posts ? posts.length : 0;

    if (!posts || posts.length === 0) {
      container.innerHTML = '<div class="loading">No posts yet. Be the first to post in this community.</div>';
      return;
    }

    // Fetch author profiles
    const userIds = [...new Set(posts.map(p => p.user_id))];
    const { data: profiles } = await window.db
      .from('profiles')
      .select('user_id, username, display_name')
      .in('user_id', userIds);

    const profileMap = {};
    if (profiles) profiles.forEach(p => { profileMap[p.user_id] = p; });

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

    // Fetch current user's reactions
    const { data: myReactions } = await window.db
      .from('reactions')
      .select('target_id, reaction_type')
      .in('target_id', postIds)
      .eq('target_type', 'post')
      .eq('user_id', currentUser.id);

    const myReactionMap = {};
    if (myReactions) myReactions.forEach(r => { myReactionMap[r.target_id] = r.reaction_type; });

    container.innerHTML = posts.map(post =>
      renderPost(post, profileMap, reactionMap, commentCountMap, myReactionMap)
    ).join('');

    attachPostListeners(communityId);

  } catch (err) {
    console.error('Community posts error:', err);
    container.innerHTML = '<div class="loading">Could not load posts.</div>';
  }
}

function renderPost(post, profileMap, reactionMap, commentCountMap, myReactionMap) {
  const profile = profileMap[post.user_id];
  const username = profile?.username || 'unknown';
  const displayName = profile?.display_name || username;
  const initial = username.charAt(0).toUpperCase();
  const timestamp = new Date(post.created_at).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
  });

  const likes = reactionMap[post.id]?.like || 0;
  const downvotes = reactionMap[post.id]?.downvote || 0;
  const commentCount = commentCountMap[post.id] || 0;
  const myReaction = myReactionMap[post.id];

  const likeActive = myReaction === 'like' ? 'font-weight:700;' : '';
  const downvoteActive = myReaction === 'downvote' ? 'font-weight:700;' : '';

  return `
    <div class="post-card" data-post-id="${post.id}">
      <div class="post-header">
        <div class="post-avatar" style="cursor:pointer;" onclick="window.location.href='/profile.html?user=${encodeURIComponent(username)}'">${initial}</div>
        <div class="post-meta">
          <div class="post-username">
            <a href="/profile.html?user=${encodeURIComponent(username)}" style="text-decoration:none;color:inherit;">${escapeHtml(displayName)}</a>
            <span style="font-weight:400;color:var(--text-muted);font-size:13px;">@${escapeHtml(username)}</span>
          </div>
          <span class="post-timestamp">${timestamp}</span>
        </div>
      </div>
      <div class="post-content">${escapeHtml(post.content || '')}</div>
      <div class="post-actions">
        <button class="post-action-btn like-btn" data-post-id="${post.id}" style="${likeActive}">
          ❤️ <span class="like-count">${likes}</span>
        </button>
        <button class="post-action-btn comment-btn" data-post-id="${post.id}">
          💬 <span>${commentCount > 0 ? commentCount : ''} Comment${commentCount !== 1 ? 's' : ''}</span>
        </button>
        <button class="post-action-btn downvote-btn" data-post-id="${post.id}" style="${downvoteActive}">
          👎 <span class="downvote-count">${downvotes}</span>
        </button>
        <button class="post-action-btn share-btn" data-post-id="${post.id}">
          🔗 Share
        </button>
        ${post.user_id === currentUser.id ? `
          <button class="post-action-btn delete-btn" data-post-id="${post.id}" style="margin-left:auto;color:var(--danger);">
            🗑️
          </button>
        ` : ''}
      </div>
    </div>
  `;
}

function attachPostListeners(communityId) {
  document.querySelectorAll('.like-btn').forEach(btn => {
    btn.addEventListener('click', () => handleReaction(btn.dataset.postId, 'like'));
  });

  document.querySelectorAll('.downvote-btn').forEach(btn => {
    btn.addEventListener('click', () => handleReaction(btn.dataset.postId, 'downvote'));
  });

  document.querySelectorAll('.comment-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      window.location.href = `/comments.html?post=${btn.dataset.postId}`;
    });
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

  document.querySelectorAll('.delete-btn').forEach(btn => {
    btn.addEventListener('click', () => handleDeletePost(btn.dataset.postId, communityId));
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

  const likes = reactions ? reactions.filter(r => r.reaction_type === 'like').length : 0;
  const downvotes = reactions ? reactions.filter(r => r.reaction_type === 'downvote').length : 0;

  const card = document.querySelector(`.post-card[data-post-id="${postId}"]`);
  if (!card) return;

  const likeCount = card.querySelector('.like-count');
  const downvoteCount = card.querySelector('.downvote-count');
  if (likeCount) likeCount.textContent = likes;
  if (downvoteCount) downvoteCount.textContent = downvotes;

  const { data: myReaction } = await window.db
    .from('reactions')
    .select('reaction_type')
    .eq('target_id', postId)
    .eq('target_type', 'post')
    .eq('user_id', currentUser.id)
    .single();

  const likeBtn = card.querySelector('.like-btn');
  const downvoteBtn = card.querySelector('.downvote-btn');
  if (likeBtn) likeBtn.style.fontWeight = myReaction?.reaction_type === 'like' ? '700' : '';
  if (downvoteBtn) downvoteBtn.style.fontWeight = myReaction?.reaction_type === 'downvote' ? '700' : '';
}

async function handleCreatePost() {
  if (!currentCommunity) return;

  const content = document.getElementById('post-content').value.trim();
  if (!content) return;

  const btn = document.getElementById('post-btn');
  btn.textContent = 'Posting...';
  btn.disabled = true;

  try {
    const { error } = await window.db.from('posts').insert({
      user_id: currentUser.id,
      community_id: currentCommunity.id,
      content: content
    });

    if (error) throw error;

    document.getElementById('post-content').value = '';
    await loadCommunityPosts(currentCommunity.id);

  } catch (err) {
    console.error('Post error:', err);
  }

  btn.textContent = 'Post';
  btn.disabled = false;
}

async function handleDeletePost(postId, communityId) {
  if (!confirm('Delete this post?')) return;
  await window.db.from('posts').update({ is_removed: true }).eq('id', postId).eq('user_id', currentUser.id);
  await loadCommunityPosts(communityId);
}

async function handleJoin(communityId) {
  const btn = document.getElementById('join-btn');
  btn.textContent = 'Joining...';
  btn.disabled = true;

  try {
    await window.db.from('community_members').insert({
      community_id: communityId,
      user_id: currentUser.id,
      role: 'member'
    });

    await window.db.from('communities')
      .update({ member_count: (currentCommunity.member_count || 0) + 1 })
      .eq('id', communityId);

    currentCommunity.member_count = (currentCommunity.member_count || 0) + 1;
    document.getElementById('community-member-count').textContent = currentCommunity.member_count;

    btn.textContent = 'Joined ✓';
    btn.className = 'btn btn-ghost';
    btn.disabled = false;

  } catch (err) {
    console.error('Join error:', err);
    btn.textContent = 'Join Community';
    btn.disabled = false;
  }
}

async function loadOtherCommunities(currentSlug) {
  const container = document.getElementById('other-communities');

  const { data: communities } = await window.db
    .from('communities')
    .select('name, slug')
    .neq('slug', currentSlug)
    .eq('is_official', true)
    .order('name')
    .limit(8);

  if (!communities) return;

  container.innerHTML = communities.map(c => `
    <a href="/community.html?slug=${c.slug}" style="display:block;padding:10px 12px;border-radius:8px;margin-bottom:6px;background:var(--bg-card);border:1px solid var(--border);color:var(--text);font-size:14px;text-decoration:none;transition:all 0.15s ease;">
      ${escapeHtml(c.name)}
    </a>
  `).join('');
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.appendChild(document.createTextNode(text));
  return div.innerHTML;
}
