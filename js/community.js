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
let isModerator = false;
let callFrame = null;
let currentLiveSession = null;
let liveSessionSubscription = null;
let viewerCountInterval = null;

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
    .from('profiles').select('*').eq('user_id', currentUser.id).single();

  currentProfile = profile;

  if (profile) {
    document.getElementById('user-avatar').textContent = profile.username.charAt(0).toUpperCase();
  }

  document.getElementById('post-btn').addEventListener('click', handleCreatePost);

  setupLiveModalListeners();

  await loadCommunity(slug);
  await loadOtherCommunities(slug);
});

// ─── LIVE SESSION ────────────────────────────────────────────────────────────

function setupLiveModalListeners() {
  // Go Live button → open title modal
  document.getElementById('go-live-btn').addEventListener('click', () => {
    document.getElementById('golive-modal').classList.add('visible');
    document.getElementById('golive-title-input').value = '';
    document.getElementById('golive-title-input').focus();
  });

  // Cancel Go Live
  document.getElementById('golive-cancel-btn').addEventListener('click', () => {
    document.getElementById('golive-modal').classList.remove('visible');
  });

  // Start Stream
  document.getElementById('golive-start-btn').addEventListener('click', startLiveSession);

  // Join Live (viewer)
  document.getElementById('join-live-btn').addEventListener('click', () => {
    if (currentLiveSession) joinLiveSession(currentLiveSession, false);
  });

  // Leave Live
  document.getElementById('leave-live-btn').addEventListener('click', leaveLiveSession);

  // End Stream (host only)
  document.getElementById('end-live-btn').addEventListener('click', endLiveSession);

  // Close modal on backdrop click
  document.getElementById('golive-modal').addEventListener('click', (e) => {
    if (e.target === document.getElementById('golive-modal')) {
      document.getElementById('golive-modal').classList.remove('visible');
    }
  });
}

async function startLiveSession() {
  if (!currentCommunity) return;
  if (!currentProfile?.is_verified) {
    alert('You must be a verified user to go live.');
    return;
  }

  const title = document.getElementById('golive-title-input').value.trim();
  const btn = document.getElementById('golive-start-btn');
  btn.textContent = 'Starting...';
  btn.disabled = true;

  try {
    // Check if user already has an active session
    const { data: existing } = await window.db
      .from('live_sessions')
      .select('id')
      .eq('host_user_id', currentUser.id)
      .eq('is_active', true)
      .single();

    if (existing) {
      alert('You already have an active live session.');
      btn.textContent = 'Start Stream';
      btn.disabled = false;
      return;
    }

    const roomName = `voxxee-${currentCommunity.slug}-${Date.now()}`;

    // Get auth token for function call
    const { data: { session } } = await window.db.auth.getSession();

    const response = await fetch('/.netlify/functions/create-room', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`
      },
      body: JSON.stringify({ room_name: roomName, title })
    });

    if (!response.ok) throw new Error('Failed to create room');

    const { room_url } = await response.json();

    // Insert live session into Supabase
    const { data: liveSession, error } = await window.db
      .from('live_sessions')
      .insert({
        host_user_id: currentUser.id,
        community_id: currentCommunity.id,
        room_name: roomName,
        room_url,
        title: title || null,
        is_active: true
      })
      .select()
      .single();

    if (error) throw error;

    currentLiveSession = liveSession;

    // Fire notification to community members
    await notifyLive(liveSession, title);

    document.getElementById('golive-modal').classList.remove('visible');
    await joinLiveSession(liveSession, true);

  } catch (err) {
    console.error('Start live error:', err);
    alert('Could not start live session. Please try again.');
  }

  btn.textContent = 'Start Stream';
  btn.disabled = false;
}

async function joinLiveSession(session, isHost) {
  const modal = document.getElementById('live-modal');
  const container = document.getElementById('daily-frame-container');
  const endBtn = document.getElementById('end-live-btn');
  const titleEl = document.getElementById('live-modal-title-text');

  titleEl.textContent = session.title
    ? `Live: ${session.title}`
    : 'Live Stream';

  endBtn.style.display = isHost ? 'block' : 'none';

  modal.classList.add('visible');
  container.innerHTML = '';

  callFrame = window.DailyIframe.createFrame(container, {
    showLeaveButton: false,
    showFullscreenButton: true,
    iframeStyle: {
      width: '100%',
      height: '100%',
      border: 'none'
    }
  });

  await callFrame.join({ url: session.room_url });

  callFrame.on('left-meeting', () => {
    if (isHost) {
      endLiveSession();
    } else {
      leaveLiveSession();
    }
  });

  // Update viewer count every 10 seconds
  updateViewerCount(session.id);
  viewerCountInterval = setInterval(() => updateViewerCount(session.id), 10000);
}

async function updateViewerCount(sessionId) {
  try {
    if (!callFrame) return;
    const participants = callFrame.participants();
    const count = Object.keys(participants).length;
    document.getElementById('live-viewer-count').textContent = `${count} viewer${count !== 1 ? 's' : ''}`;
    await window.db
      .from('live_sessions')
      .update({ viewer_count: count })
      .eq('id', sessionId);
  } catch (err) {
    console.error('Viewer count error:', err);
  }
}

async function leaveLiveSession() {
  if (callFrame) {
    await callFrame.leave();
    callFrame.destroy();
    callFrame = null;
  }
  if (viewerCountInterval) {
    clearInterval(viewerCountInterval);
    viewerCountInterval = null;
  }
  document.getElementById('live-modal').classList.remove('visible');
  document.getElementById('daily-frame-container').innerHTML = '';
}

async function endLiveSession() {
  if (!confirm('End your live stream?')) return;

  try {
    if (currentLiveSession) {
      await window.db
        .from('live_sessions')
        .update({ is_active: false, ended_at: new Date().toISOString() })
        .eq('id', currentLiveSession.id);
    }
  } catch (err) {
    console.error('End session error:', err);
  }

  await leaveLiveSession();
  currentLiveSession = null;
  hideLiveBanner();
}

async function notifyLive(session, title) {
  try {
    // Get community members to notify
    const { data: members } = await window.db
      .from('community_members')
      .select('user_id')
      .eq('community_id', currentCommunity.id)
      .neq('user_id', currentUser.id)
      .limit(100);

    if (!members || members.length === 0) return;

    const notifications = members.map(m => ({
      user_id: m.user_id,
      type: 'live_started',
      reference_id: session.id,
      reference_type: 'live_session',
      content: `${currentProfile?.display_name || currentProfile?.username || 'Someone'} is live in ${currentCommunity.name}${title ? ': ' + title : ''}`
    }));

    await window.db.from('notifications').insert(notifications);
  } catch (err) {
    console.error('Notify live error:', err);
  }
}

async function checkActiveLiveSession(communityId) {
  try {
    const { data: session } = await window.db
      .from('live_sessions')
      .select('*, profiles(username, display_name)')
      .eq('community_id', communityId)
      .eq('is_active', true)
      .order('started_at', { ascending: false })
      .limit(1)
      .single();

    if (session) {
      currentLiveSession = session;
      showLiveBanner(session);
    } else {
      hideLiveBanner();
    }
  } catch {
    hideLiveBanner();
  }
}

function showLiveBanner(session) {
  const banner = document.getElementById('live-banner');
  const hostName = session.profiles?.display_name || session.profiles?.username || 'Someone';
  document.getElementById('live-host-name').textContent = hostName;
  const titleEl = document.getElementById('live-session-title');
  titleEl.textContent = session.title ? `— ${session.title}` : '';
  banner.classList.add('visible');
}

function hideLiveBanner() {
  document.getElementById('live-banner').classList.remove('visible');
}

function subscribeToLiveSessions(communityId) {
  if (liveSessionSubscription) {
    liveSessionSubscription.unsubscribe();
  }
  liveSessionSubscription = window.db
    .channel(`live-sessions-${communityId}`)
    .on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'live_sessions',
      filter: `community_id=eq.${communityId}`
    }, async () => {
      await checkActiveLiveSession(communityId);
    })
    .subscribe();
}

// ─── COMMUNITY LOAD ───────────────────────────────────────────────────────────

async function loadCommunity(slug) {
  const { data: community, error } = await window.db
    .from('communities').select('*').eq('slug', slug).single();

  if (error || !community) {
    document.getElementById('community-header').innerHTML = '<div class="loading">Community not found.</div>';
    return;
  }

  currentCommunity = community;
  document.title = community.name + ' — Voxxee';

  document.getElementById('community-name').textContent = community.name;
  document.getElementById('community-slug').textContent = 'v/' + community.slug;
  document.getElementById('community-description').textContent = community.description || '';
  document.getElementById('community-member-count').textContent = (community.member_count || 0).toLocaleString();
  document.getElementById('community-post-count').textContent = (community.post_count || 0).toLocaleString();

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

  const joinBtn = document.getElementById('join-btn');
  joinBtn.style.display = 'block';

  const { data: membership } = await window.db
    .from('community_members').select('id, role')
    .eq('community_id', community.id).eq('user_id', currentUser.id).single();

  isModerator = membership?.role === 'moderator' || membership?.role === 'admin';
  if (community.created_by === currentUser.id) isModerator = true;

  if (membership) {
    joinBtn.textContent = 'Joined ✓';
    joinBtn.className = 'btn btn-ghost';
  } else {
    joinBtn.textContent = 'Join Community';
    joinBtn.addEventListener('click', () => handleJoin(community.id));
  }

  // Show Go Live button only for verified users
  if (currentProfile?.is_verified) {
    const goLiveBtn = document.getElementById('go-live-btn');
    if (goLiveBtn) goLiveBtn.style.display = 'block';
  }

  const wikiBtn = document.getElementById('wiki-btn');
  if (wikiBtn) {
    wikiBtn.style.display = 'block';
    wikiBtn.addEventListener('click', () => toggleWikiPanel(community));
  }

  renderRulesSidebar(community.rules || []);

  // Check for active live session and subscribe to changes
  await checkActiveLiveSession(community.id);
  subscribeToLiveSessions(community.id);

  await loadCommunityPosts(community.id);
}

function renderRulesSidebar(rules) {
  const container = document.getElementById('community-rules-sidebar');
  if (!container) return;
  if (!rules || rules.length === 0) {
    container.innerHTML = '';
    return;
  }
  container.innerHTML = `
    <div style="font-size:13px;font-weight:700;color:var(--text-secondary);text-transform:uppercase;letter-spacing:1px;margin-bottom:16px;">Community Rules</div>
    ${rules.map((rule, i) => `
      <div style="padding:10px 12px;background:var(--bg-card);border:1px solid var(--border);border-radius:8px;margin-bottom:8px;font-size:13px;color:var(--text-secondary);">
        <span style="font-weight:700;color:var(--text);">${i + 1}.</span> ${escapeHtml(rule)}
      </div>
    `).join('')}
  `;
}

function toggleWikiPanel(community) {
  const panel = document.getElementById('wiki-panel');
  const isVisible = panel.style.display !== 'none';
  if (isVisible) {
    panel.style.display = 'none';
    return;
  }
  panel.style.display = 'block';
  panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  renderWikiView(community);
  setupWikiListeners(community);
}

function renderWikiView(community) {
  const contentEl = document.getElementById('wiki-content');
  const emptyEl = document.getElementById('wiki-empty');
  const editBtn = document.getElementById('wiki-edit-btn');
  const rulesSection = document.getElementById('wiki-rules-section');
  const rulesList = document.getElementById('wiki-rules-list');

  document.getElementById('wiki-view').style.display = 'block';
  document.getElementById('wiki-edit').style.display = 'none';

  if (community.wiki && community.wiki.trim()) {
    contentEl.textContent = community.wiki;
    contentEl.style.display = 'block';
    emptyEl.style.display = 'none';
  } else {
    contentEl.style.display = 'none';
    emptyEl.style.display = 'block';
  }

  if (editBtn) editBtn.style.display = isModerator ? 'block' : 'none';

  const rules = community.rules || [];
  if (rules.length > 0 || isModerator) {
    rulesSection.style.display = 'block';
    const rulesEditor = document.getElementById('wiki-rules-editor');

    if (rules.length > 0) {
      rulesList.innerHTML = rules.map((rule, i) => `
        <div style="display:flex;gap:10px;padding:10px 12px;background:var(--bg-input);border:1px solid var(--border);border-radius:8px;margin-bottom:6px;font-size:14px;color:var(--text-secondary);">
          <span style="font-weight:700;color:var(--primary);flex-shrink:0;">${i + 1}.</span>
          <span>${escapeHtml(rule)}</span>
        </div>
      `).join('');
    } else {
      rulesList.innerHTML = '<div style="font-size:13px;color:var(--text-muted);font-style:italic;margin-bottom:8px;">No rules set yet.</div>';
    }

    if (isModerator) {
      if (!document.getElementById('edit-rules-btn')) {
        const editRulesBtn = document.createElement('button');
        editRulesBtn.id = 'edit-rules-btn';
        editRulesBtn.className = 'btn btn-ghost';
        editRulesBtn.style.cssText = 'font-size:13px;margin-top:8px;';
        editRulesBtn.textContent = '✏️ Edit Rules';
        rulesList.after(editRulesBtn);
        editRulesBtn.addEventListener('click', () => {
          rulesEditor.style.display = rulesEditor.style.display === 'none' ? 'block' : 'none';
          if (rulesEditor.style.display === 'block') {
            document.getElementById('rules-textarea').value = (community.rules || []).join('\n');
          }
        });
      }
      rulesEditor.style.display = 'none';
    }
  } else {
    rulesSection.style.display = 'none';
  }
}

function setupWikiListeners(community) {
  const panel = document.getElementById('wiki-panel');
  if (panel.dataset.listenersAttached) return;
  panel.dataset.listenersAttached = '1';

  document.getElementById('wiki-close-btn').addEventListener('click', () => {
    panel.style.display = 'none';
  });

  const editBtn = document.getElementById('wiki-edit-btn');
  if (editBtn) {
    editBtn.addEventListener('click', () => {
      document.getElementById('wiki-view').style.display = 'none';
      document.getElementById('wiki-edit').style.display = 'block';
      const textarea = document.getElementById('wiki-textarea');
      textarea.value = community.wiki || '';
      updateWikiCharCount();
      textarea.focus();
    });
  }

  document.getElementById('wiki-textarea').addEventListener('input', updateWikiCharCount);

  document.getElementById('wiki-cancel-edit-btn').addEventListener('click', () => {
    document.getElementById('wiki-view').style.display = 'block';
    document.getElementById('wiki-edit').style.display = 'none';
  });

  document.getElementById('wiki-save-btn').addEventListener('click', async () => {
    const content = document.getElementById('wiki-textarea').value.trim();
    const btn = document.getElementById('wiki-save-btn');
    btn.textContent = 'Saving...';
    btn.disabled = true;
    try {
      const { error } = await window.db
        .from('communities').update({ wiki: content }).eq('id', community.id);
      if (error) throw error;
      community.wiki = content;
      currentCommunity.wiki = content;
      document.getElementById('wiki-view').style.display = 'block';
      document.getElementById('wiki-edit').style.display = 'none';
      renderWikiView(community);
    } catch (err) {
      console.error('Wiki save error:', err);
    }
    btn.textContent = 'Save Wiki';
    btn.disabled = false;
  });

  document.getElementById('rules-cancel-btn').addEventListener('click', () => {
    document.getElementById('wiki-rules-editor').style.display = 'none';
  });

  document.getElementById('rules-save-btn').addEventListener('click', async () => {
    const rawText = document.getElementById('rules-textarea').value;
    const rules = rawText.split('\n').map(r => r.trim()).filter(r => r.length > 0);
    const btn = document.getElementById('rules-save-btn');
    btn.textContent = 'Saving...';
    btn.disabled = true;
    try {
      const { error } = await window.db
        .from('communities').update({ rules }).eq('id', community.id);
      if (error) throw error;
      community.rules = rules;
      currentCommunity.rules = rules;
      document.getElementById('wiki-rules-editor').style.display = 'none';
      renderWikiView(community);
      renderRulesSidebar(rules);
    } catch (err) {
      console.error('Rules save error:', err);
    }
    btn.textContent = 'Save Rules';
    btn.disabled = false;
  });
}

function updateWikiCharCount() {
  const textarea = document.getElementById('wiki-textarea');
  const counter = document.getElementById('wiki-char-count');
  if (!textarea || !counter) return;
  const count = textarea.value.length;
  counter.textContent = `${count.toLocaleString()} / 10,000`;
  counter.style.color = count > 9000 ? 'var(--danger)' : 'var(--text-muted)';
}

async function loadCommunityPosts(communityId) {
  const container = document.getElementById('community-posts');
  container.innerHTML = '<div class="loading"><div class="spinner"></div>Loading posts...</div>';

  try {
    const { data: posts, error } = await window.db
      .from('posts').select('*')
      .eq('community_id', communityId).eq('is_removed', false)
      .order('created_at', { ascending: false }).limit(50);

    if (error) throw error;

    if (!posts || posts.length === 0) {
      container.innerHTML = '<div class="loading">No posts yet. Be the first to post in this community.</div>';
      return;
    }

    const userIds = [...new Set(posts.map(p => p.user_id))];
    const { data: profiles } = await window.db
      .from('profiles').select('user_id, username, display_name, is_verified, verified_type, reputation')
      .in('user_id', userIds);

    const profileMap = {};
    if (profiles) profiles.forEach(p => { profileMap[p.user_id] = p; });

    const postIds = posts.map(p => p.id);

    const { data: reactions } = await window.db
      .from('reactions').select('target_id, reaction_type')
      .in('target_id', postIds).eq('target_type', 'post');

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
    if (comments) {
      comments.forEach(c => { commentCountMap[c.post_id] = (commentCountMap[c.post_id] || 0) + 1; });
    }

    const { data: myReactions } = await window.db
      .from('reactions').select('target_id, reaction_type')
      .in('target_id', postIds).eq('target_type', 'post').eq('user_id', currentUser.id);

    const myReactionMap = {};
    if (myReactions) myReactions.forEach(r => { myReactionMap[r.target_id] = r.reaction_type; });

    const { data: polls } = await window.db
      .from('polls').select('*').in('post_id', postIds);

    const pollMap = {};
    if (polls) polls.forEach(p => { pollMap[p.post_id] = p; });

    if (polls && polls.length > 0) {
      const pollIds = polls.map(p => p.id);

      const { data: myVotes } = await window.db
        .from('poll_votes').select('poll_id, option_index')
        .in('poll_id', pollIds).eq('user_id', currentUser.id);
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

    container.innerHTML = posts.map(post =>
      renderPost(post, profileMap, reactionMap, commentCountMap, myReactionMap, pollMap)
    ).join('');

    attachPostListeners(communityId);

  } catch (err) {
    console.error('Community posts error:', err);
    container.innerHTML = '<div class="loading">Could not load posts.</div>';
  }
}

function getVerifiedBadge(profile) {
  if (!profile?.is_verified) return '';
  const badges = {
    staff:    '<span title="Voxxee Staff" style="font-size:14px;cursor:default;">🟣</span>',
    notable:  '<span title="Notable Account" style="font-size:14px;cursor:default;">⭐</span>',
    identity: '<span title="ID Verified" style="font-size:14px;cursor:default;">🔵</span>',
  };
  return badges[profile.verified_type] || badges.identity;
}

function renderPost(post, profileMap, reactionMap, commentCountMap, myReactionMap, pollMap) {
  const profile = profileMap[post.user_id];
  const username = profile?.username || 'unknown';
  const displayName = profile?.display_name || username;
  const initial = username.charAt(0).toUpperCase();
  const verifiedBadge = getVerifiedBadge(profile);
  const repBadge = repBadgeHtml(profile?.reputation);
  const timestamp = new Date(post.created_at).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
  });

  const postReactions = reactionMap[post.id] || {};
  const commentCount = commentCountMap[post.id] || 0;
  const myReaction = myReactionMap[post.id];

  const totalReactions = Object.values(postReactions).reduce((a, b) => a + b, 0);
  const topEmojis = REACTIONS
    .filter(r => postReactions[r.type] > 0)
    .sort((a, b) => (postReactions[b.type] || 0) - (postReactions[a.type] || 0))
    .slice(0, 3).map(r => r.emoji).join('');

  const myReactionObj = REACTIONS.find(r => r.type === myReaction);
  const reactBtnLabel = myReactionObj ? `${myReactionObj.emoji} ${myReactionObj.label}` : '❤️ React';
  const reactBtnStyle = myReaction ? 'font-weight:700;color:var(--primary);' : '';
  const isOwnPost = post.user_id === currentUser?.id;

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
                    <span style="color:var(--text);${isMyVote ? 'font-weight:700;' : ''}">${isMyVote ? '✓ ' : ''}${escapeHtml(opt)}</span>
                    <span style="color:var(--text-muted);">${pct}%</span>
                  </div>
                  <div style="height:6px;background:var(--border);border-radius:100px;overflow:hidden;">
                    <div style="height:100%;width:${pct}%;background:${isMyVote ? 'var(--primary)' : 'var(--text-muted)'};border-radius:100px;transition:width 0.3s ease;"></div>
                  </div>
                </div>
              `;
            } else {
              return `
                <button class="poll-vote-btn" data-poll-id="${poll.id}" data-option-index="${idx}"
                  style="display:block;width:100%;text-align:left;padding:10px 14px;margin-bottom:6px;background:var(--bg-card);border:1px solid var(--border);border-radius:8px;cursor:pointer;font-size:14px;color:var(--text);transition:all 0.15s ease;"
                  onmouseover="this.style.borderColor='var(--primary)';this.style.background='var(--bg-hover)'"
                  onmouseout="this.style.borderColor='var(--border)';this.style.background='var(--bg-card)'">
                  ${escapeHtml(opt)}
                </button>
              `;
            }
          }).join('')}
        </div>
        <div class="poll-vote-count" style="font-size:12px;color:var(--text-muted);margin-top:8px;">
          ${totalVotes} vote${totalVotes !== 1 ? 's' : ''}
          ${isExpired ? ' · Closed' : poll.expires_at ? ` · Ends ${new Date(poll.expires_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : ''}
        </div>
      </div>
    `;
  }

  return `
    <div class="post-card" data-post-id="${post.id}">
      <div class="post-header">
        <div class="post-avatar" style="cursor:pointer;"
          onclick="window.location.href='/profile.html?user=${encodeURIComponent(username)}'">${initial}</div>
        <div class="post-meta">
          <div class="post-username">
            <a href="/profile.html?user=${encodeURIComponent(username)}" style="text-decoration:none;color:inherit;">${escapeHtml(displayName)}</a>
            ${verifiedBadge}
            <span style="font-weight:400;color:var(--text-muted);font-size:13px;">@${escapeHtml(username)}</span>
            ${repBadge}
            ${isModerator && !isOwnPost ? `<span style="font-size:11px;padding:2px 8px;border-radius:100px;background:rgba(99,102,241,0.15);color:var(--primary);font-weight:600;margin-left:6px;">MOD</span>` : ''}
          </div>
          <span class="post-timestamp">${timestamp}</span>
        </div>
        <div class="post-menu-wrapper" style="position:relative;margin-left:auto;">
          <button class="post-menu-btn" data-post-id="${post.id}"
            style="background:none;border:none;cursor:pointer;color:var(--text-muted);font-size:18px;padding:4px 8px;border-radius:6px;line-height:1;">•••</button>
          <div class="post-menu-dropdown" data-post-id="${post.id}"
            style="display:none;position:absolute;top:28px;right:0;background:var(--bg-card);border:1px solid var(--border);border-radius:10px;box-shadow:0 4px 20px rgba(0,0,0,0.3);z-index:200;min-width:150px;overflow:hidden;">
            ${isOwnPost || isModerator ? `
              <button class="delete-btn" data-post-id="${post.id}" data-post-owner="${post.user_id}"
                style="display:block;width:100%;text-align:left;padding:10px 16px;background:none;border:none;cursor:pointer;font-size:14px;color:var(--danger);">
                🗑️ Delete
              </button>
            ` : `
              <button class="report-btn" data-post-id="${post.id}"
                style="display:block;width:100%;text-align:left;padding:10px 16px;background:none;border:none;cursor:pointer;font-size:14px;color:var(--danger);">
                🚩 Report Post
              </button>
            `}
          </div>
        </div>
      </div>

      <div class="post-content">${escapeHtml(post.content || '')}</div>

      ${pollHtml}

      ${totalReactions > 0 ? `
        <div style="padding:4px 0 8px 0;">
          <span class="reaction-summary" style="font-size:13px;color:var(--text-muted);">${topEmojis} ${totalReactions}</span>
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
      handleDeletePost(btn.dataset.postId, btn.dataset.postOwner, communityId);
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

  document.querySelectorAll('.poll-vote-btn').forEach(btn => {
    btn.addEventListener('click', () => handlePollVote(btn.dataset.pollId, parseInt(btn.dataset.optionIndex)));
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.reaction-btn-wrapper')) {
      document.querySelectorAll('.reaction-picker').forEach(p => p.style.display = 'none');
    }
    if (!e.target.closest('.post-menu-wrapper')) {
      document.querySelectorAll('.post-menu-dropdown').forEach(m => m.style.display = 'none');
    }
  });

  // Report modal
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
            ${[
              ['spam', '🚫 Spam or advertising'],
              ['harassment', '😡 Harassment or bullying'],
              ['hate_speech', '🤬 Hate speech or discrimination'],
              ['misinformation', '📰 Misinformation or false content'],
              ['illegal', '⚖️ Illegal content'],
              ['adult', '🔞 Adult content shown to minors'],
              ['violence', '💢 Violence or threats'],
              ['other', '❓ Other']
            ].map(([value, label]) => `
              <label style="display:flex;align-items:center;gap:10px;padding:10px 14px;border:1px solid var(--border);border-radius:8px;cursor:pointer;"
                onmouseover="this.style.borderColor='var(--primary)'" onmouseout="this.style.borderColor='var(--border)'">
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
  if (!reason) {
    errorEl.textContent = 'Please select a reason.';
    errorEl.style.display = 'block';
    return;
  }
  const submitBtn = document.getElementById('report-modal-submit');
  submitBtn.textContent = 'Submitting...';
  submitBtn.disabled = true;
  try {
    const { data: existing } = await window.db
      .from('reports').select('id')
      .eq('reporter_id', currentUser.id).eq('target_id', postId).eq('target_type', 'post').single();
    if (existing) {
      errorEl.textContent = 'You have already reported this post.';
      errorEl.style.display = 'block';
      submitBtn.textContent = 'Submit Report';
      submitBtn.disabled = false;
      return;
    }
    const { error } = await window.db.from('reports').insert({
      reporter_id: currentUser.id, target_id: postId,
      target_type: 'post', reason, status: 'pending'
    });
    if (error) throw error;
    closeReportModal();
    const menuBtn = document.querySelector(`.post-menu-btn[data-post-id="${postId}"]`);
    if (menuBtn) {
      menuBtn.textContent = '✅';
      setTimeout(() => { menuBtn.textContent = '•••'; }, 2000);
    }
  } catch (err) {
    console.error('Report error:', err);
    errorEl.textContent = 'Something went wrong. Please try again.';
    errorEl.style.display = 'block';
  }
  submitBtn.textContent = 'Submit Report';
  submitBtn.disabled = false;
}

async function handlePollVote(pollId, optionIndex) {
  if (!currentUser) return;
  try {
    const { data: existing } = await window.db
      .from('poll_votes').select('id')
      .eq('poll_id', pollId).eq('user_id', currentUser.id).single();
    if (existing) return;
    const { error } = await window.db.from('poll_votes').insert({
      poll_id: pollId, user_id: currentUser.id, option_index: optionIndex
    });
    if (error) throw error;
    await refreshPollResults(pollId);
  } catch (err) {
    console.error('Poll vote error:', err);
  }
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
  const { data: myVoteRow } = await window.db.from('poll_votes').select('option_index')
    .eq('poll_id', pollId).eq('user_id', currentUser.id).single();
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
            <span style="color:var(--text);${isMyVote ? 'font-weight:700;' : ''}">${isMyVote ? '✓ ' : ''}${escapeHtml(opt)}</span>
            <span style="color:var(--text-muted);">${pct}%</span>
          </div>
          <div style="height:6px;background:var(--border);border-radius:100px;overflow:hidden;">
            <div style="height:100%;width:${pct}%;background:${isMyVote ? 'var(--primary)' : 'var(--text-muted)'};border-radius:100px;transition:width 0.3s ease;"></div>
          </div>
        </div>
      `;
    }).join('');
  }
  const voteCountEl = pollCard.querySelector('.poll-vote-count');
  if (voteCountEl) {
    voteCountEl.textContent = `${totalVotes} vote${totalVotes !== 1 ? 's' : ''}${isExpired ? ' · Closed' : ''}`;
  }
}

async function handleReaction(postId, type) {
  if (!currentUser) return;
  try {
    const { data: existing } = await window.db
      .from('reactions').select('*')
      .eq('user_id', currentUser.id).eq('target_id', postId).eq('target_type', 'post').single();

    if (existing) {
      if (existing.reaction_type === type) {
        await window.db.from('reactions').delete().eq('id', existing.id);
        const { data: post } = await window.db.from('posts').select('user_id').eq('id', postId).single();
        if (post && post.user_id !== currentUser.id) {
          const reversePoints = existing.reaction_type === 'downvote' ? 1 : -1;
          await window.db.from('reputation_events').insert({
            user_id: post.user_id, source_user_id: currentUser.id,
            event_type: 'reaction_removed', points: reversePoints,
            target_id: postId, target_type: 'post'
          });
          const { data: ownerProfile } = await window.db
            .from('profiles').select('reputation').eq('user_id', post.user_id).single();
          const newRep = Math.max(0, (ownerProfile?.reputation || 0) + reversePoints);
          await window.db.from('profiles').update({ reputation: newRep }).eq('user_id', post.user_id);
        }
      } else {
        await window.db.from('reactions').update({ reaction_type: type }).eq('id', existing.id);
      }
    } else {
      await window.db.from('reactions').insert({
        user_id: currentUser.id, target_id: postId, target_type: 'post', reaction_type: type
      });
      const { data: post } = await window.db.from('posts').select('user_id').eq('id', postId).single();
      if (post && post.user_id !== currentUser.id) {
        const eventType = type === 'downvote' ? 'downvote_received' : 'reaction_received';
        await awardReputation(post.user_id, eventType, postId, 'post', currentUser.id);
      }
    }
    await refreshPostReactions(postId);
  } catch (err) {
    console.error('Reaction error:', err);
  }
}

async function refreshPostReactions(postId) {
  const { data: reactions } = await window.db
    .from('reactions').select('reaction_type')
    .eq('target_id', postId).eq('target_type', 'post');
  const card = document.querySelector(`.post-card[data-post-id="${postId}"]`);
  if (!card) return;
  const counts = {};
  if (reactions) reactions.forEach(r => { counts[r.reaction_type] = (counts[r.reaction_type] || 0) + 1; });
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const topEmojis = REACTIONS
    .filter(r => counts[r.type] > 0)
    .sort((a, b) => (counts[b.type] || 0) - (counts[a.type] || 0))
    .slice(0, 3).map(r => r.emoji).join('');
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
    .from('reactions').select('reaction_type')
    .eq('target_id', postId).eq('target_type', 'post').eq('user_id', currentUser.id).single();
  const reactBtn = card.querySelector('.react-btn');
  if (reactBtn) {
    const myReactionObj = REACTIONS.find(r => r.type === myReaction?.reaction_type);
    reactBtn.textContent = myReactionObj ? `${myReactionObj.emoji} ${myReactionObj.label}` : '❤️ React';
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
    const { data: post, error } = await window.db.from('posts').insert({
      user_id: currentUser.id, community_id: currentCommunity.id, content
    }).select().single();
    if (error) throw error;
    await awardReputation(currentUser.id, 'post_created', post.id, 'post', null);
    document.getElementById('post-content').value = '';
    await loadCommunityPosts(currentCommunity.id);
  } catch (err) {
    console.error('Post error:', err);
  }
  btn.textContent = 'Post';
  btn.disabled = false;
}

async function handleDeletePost(postId, postOwnerId, communityId) {
  if (!confirm('Delete this post?')) return;
  await window.db.from('posts').update({ is_removed: true }).eq('id', postId);
  if (postOwnerId) {
    await awardReputation(postOwnerId, 'post_removed', postId, 'post', currentUser.id);
  }
  await loadCommunityPosts(communityId);
}

async function handleJoin(communityId) {
  const btn = document.getElementById('join-btn');
  btn.textContent = 'Joining...';
  btn.disabled = true;
  try {
    await window.db.from('community_members').insert({
      community_id: communityId, user_id: currentUser.id, role: 'member'
    });
    await window.db.from('communities')
      .update({ member_count: (currentCommunity.member_count || 0) + 1 })
      .eq('id', communityId);
    currentCommunity.member_count = (currentCommunity.member_count || 0) + 1;
    document.getElementById('community-member-count').textContent = currentCommunity.member_count.toLocaleString();
    await awardReputation(currentUser.id, 'joined_community', communityId, 'community', null);
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
    .from('communities').select('name, slug, logo_url')
    .neq('slug', currentSlug).eq('is_official', true).order('name').limit(8);
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
