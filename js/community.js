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
  document.getElementById('community-slug').textContent = 'v/' + community.slug;
  document.getElementById('community-description').textContent = community.description || '';
  document.getElementById('community-member-count').textContent = (community.member_count || 0).toLocaleString();
  document.getElementById('community-post-count').textContent = (community.post_count || 0).toLocaleString();

  // Populate logo
  const logoEl = document.getElementById('community-logo');
  if (logoEl) {
    if (community.logo_url) {
      logoEl.innerHTML = `
        <img src="${community.logo_url}" alt="${escapeHtml(community.name)}"
          style="width:100%;height:100%;object-fit:cover;"
          onerror="this.style.display='none';this.nextElementSibling.style.display='flex';" />
        <span style="display:none;width:100%;height:100%;align-items:center;justify-content:center;font-size:28px;font-weight:800;color:#fff;">
          ${community.name.charAt(0).toUpperCase()}
        </span>
      `;
    } else {
      logoEl.textContent = community.name.charAt(0).toUpperCase();
    }
  }

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

    if (!posts || posts.length === 0) {
      container.innerHTML = '<div class="loading">No posts yet. Be the first to post in this community.</div>';
      return;
    }

    const userIds = [...new Set(posts.map(p => p.user_id))];
    const { data: profiles } = await window.db
      .from('profiles')
      .select('user_id, username, display_name')
      .in('user_id', userIds);

    const profileMap = {};
    if (profiles) profiles.forEach(p => { profileMap[p.user_id] = p; });

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

  const postReactions = reactionMap[post.id] || {};
  const likes = postReactions.like || 0;
  const downvotes = postReactions.downvote || 0;
  const commentCount = commentCountMap[post.id] || 0;
  const myReaction = myReactionMap[post.id];

  const REACTIONS = [
    { type: 'like', emoji: '❤️', label: 'Like' },
    { type: 'haha', emoji: '😂', label: 'Haha' },
    { type: 'wow', emoji: '😮', label: 'Wow' },
    { type: 'sad', emoji: '😢', label: 'Sad' },
    { type: 'angry', emoji: '😡', label: 'Angry' },
    { type: 'downvote', emoji: '👎', label: 'Downvote' }
  ];

  const totalReactions = Object.values(postReactions).reduce((a, b) => a + b, 0);
  const topEmojis = REACTIONS
    .filter(r => postReactions[r.type] > 0)
    .sort((a, b) => (postReactions[b.type] || 0) - (postReactions[a.type] || 0))
    .slice(0, 3)
    .map(r => r.emoji)
    .join('');

  const myReactionObj = REACTIONS.find(r => r.type === myReaction);
  const reactBtnLabel = myReactionObj ? `${myReactionObj.emoji} ${myReactionObj.label}` : '❤️ React';
  const reactBtnStyle = myReaction ? 'font-weight:700;color:var(--primary);' : '';

  return `
    <div class="post-card" data-post-id="${post.id}">
      <div class="post-header">
        <div class="post-avatar" style="cursor:pointer;"
          onclick="window.location.href='/profile.html?user=${encodeURIComponent(username)}'">${initial}</div>
        <div class="post-meta">
          <div class="post-username">
            <a href="/profile.html?user=${encodeURIComponent(username)}" style="text-decoration:none;color:inherit;">${escapeHtml(displayName)}</a>
            <span style="font-weight:400;color:var(--text-muted);font-size:13px;">@${escapeHtml(username)}</span>
          </div>
          <span class="post-timestamp">${timestamp}</span>
        </div>
        ${post.user_id === currentUser?.id ? `
          <div class="post-menu-wrapper" style="position:relative;margin-left:auto;">
            <button class="post-menu-btn" data-post-id="${post.id}"
              style="background:none;border:none;cursor:pointer;color:var(--text-muted);font-size:18px;padding:4px 8px;border-radius:6px;line-height:1;">•••</button>
            <div class="post-menu-dropdown" data-post-id="${post.id}"
              style="display:none;position:absolute;top:28px;right:0;background:var(--bg-card);border:1px solid var(--border);border-radius:10px;box-shadow:0 4px 20px rgba(0,0,0,0.3);z-index:200;min-width:140px;overflow:hidden;">
              <button class="delete-btn" data-post-id="${post.id}"
                style="display:block;width:100%;text-align:left;padding:10px 16px;background:none;border:none;cursor:pointer;font-size:14px;color:var(--danger);">
                🗑️ Delete
              </button>
            </div>
          </div>
        ` : ''}
      </div>

      <div class="post-content">${escapeHtml(post.content || '')}</div>

      ${totalReactions > 0 ? `
        <div style="padding:4px 0 8px 0;">
          <span style="font-size:13px;color:var(--text-muted);">${topEmojis} ${totalReactions}</span>
        </div>
      ` : ''}

      <div class="post-actions">
        <div class="reaction-btn-wrapper" style="position:relative;">
          <button class="post-action-btn react-btn" data-post-id="${post.id}" style="${reactBtnStyle}">
            ${reactBtnLabel}
          </button>
          <div class="reaction-picker" data-post-id="${post.id}"
            style="display:none;position:absolute;bottom:36px;left:0;background:var(--bg-card);border:1px solid var(--border);border-radius:100px;padding:6px 10px;gap:4px;z-index:100;box-shadow:0 4px 20px rgba(0,0,0,0.3);">
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

function attachPostListeners(communityId) {
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

  document.querySelectorAll('.comment-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      window.location.href = `/comments.html?post=${btn.dataset.postId}`;
    });
  });

  document.querySelectorAll('.share-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const url = `${window.location.origin}/comments.html?post=${btn.dataset.postId}`;
      navigator.clipboard.writeText(url).then(() => {
        btn.textContent = '✅ Copied';
        setTimeout(() => { btn.textContent = '🔗 Share'; }, 2000);
      });
    });
  });

  document.querySelectorAll('.delete-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const menu = document.querySelector(`.post-menu-dropdown[data-post-id="${btn.dataset.postId}"]`);
      if (menu) menu.style.display = 'none';
      handleDeletePost(btn.dataset.postId, communityId);
    });
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.reaction-btn-wrapper')) {
      document.querySelectorAll('.reaction-picker').forEach(p => p.style.display = 'none');
    }
    if (!e.target.closest('.post-menu-wrapper')) {
      document.querySelectorAll('.post-menu-dropdown').forEach(m => m.style.display = 'none');
    }
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
  const REACTIONS = [
    { type: 'like', emoji: '❤️' },
    { type: 'haha', emoji: '😂' },
    { type: 'wow', emoji: '😮' },
    { type: 'sad', emoji: '😢' },
    { type: 'angry', emoji: '😡' },
    { type: 'downvote', emoji: '👎' }
  ];

  const { data: reactions } = await window.db
    .from('reactions')
    .select('reaction_type')
    .eq('target_id', postId)
    .eq('target_type', 'post');

  const card = document.querySelector(`.post-card[data-post-id="${postId}"]`);
  if (!card) return;

  const counts = {};
  if (reactions) reactions.forEach(r => { counts[r.reaction_type] = (counts[r.reaction_type] || 0) + 1; });

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
      const div = document.createElement('div');
      div.style.cssText = 'padding:4px 0 8px 0;';
      div.innerHTML = `<span class="reaction-summary" style="font-size:13px;color:var(--text-muted);"></span>`;
      card.querySelector('.post-content').after(div);
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
    reactBtn.textContent = myReactionObj ? `${myReactionObj.emoji} ${myReactionObj.label || myReactionObj.type}` : '❤️ React';
    reactBtn.style.fontWeight = myReaction ? '700' : '';
    reactBtn.style.color = myReaction ? 'var(--primary)' : '';
  }
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
      content
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
    document.getElementById('community-member-count').textContent = currentCommunity.member_count.toLocaleString();
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
    .select('name, slug, logo_url')
    .neq('slug', currentSlug)
    .eq('is_official', true)
    .order('name')
    .limit(8);

  if (!communities) return;

  container.innerHTML = communities.map(c => {
    const logoHtml = c.logo_url
      ? `<img src="${c.logo_url}" alt="${escapeHtml(c.name)}" style="width:28px;height:28px;border-radius:6px;object-fit:cover;flex-shrink:0;" onerror="this.style.display='none'" />`
      : `<div style="width:28px;height:28px;border-radius:6px;background:var(--primary);color:#fff;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;flex-shrink:0;">${c.name.charAt(0)}</div>`;
    return `
      <a href="/community.html?slug=${c.slug}" style="display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:8px;margin-bottom:6px;background:var(--bg-card);border:1px solid var(--border);color:var(--text);font-size:14px;text-decoration:none;transition:all 0.15s ease;">
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
