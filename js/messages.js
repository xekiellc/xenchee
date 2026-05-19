async function waitForDb(timeout = 5000) {
  const start = Date.now();
  while (!window.db) {
    if (Date.now() - start > timeout) throw new Error('Supabase init timeout');
    await new Promise(r => setTimeout(r, 50));
  }
}

let currentUser = null;
let currentProfile = null;
let activeConversationUserId = null;
let activeConversationUsername = null;
let pollInterval = null;

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

  document.getElementById('logout-btn').addEventListener('click', async () => {
    await window.auth.signOut();
    window.location.href = '/';
  });

  document.getElementById('new-message-btn').addEventListener('click', () => {
    document.getElementById('new-message-modal').style.display = 'flex';
    document.getElementById('new-message-username').value = '';
    document.getElementById('new-message-content').value = '';
    document.getElementById('username-error').style.display = 'none';
    document.getElementById('new-message-username').focus();
  });

  document.getElementById('cancel-new-message-btn').addEventListener('click', () => {
    document.getElementById('new-message-modal').style.display = 'none';
  });

  document.getElementById('new-message-modal').addEventListener('click', (e) => {
    if (e.target === document.getElementById('new-message-modal')) {
      document.getElementById('new-message-modal').style.display = 'none';
    }
  });

  document.getElementById('send-new-message-btn').addEventListener('click', handleSendNewMessage);

  document.getElementById('send-btn').addEventListener('click', handleSendReply);

  document.getElementById('message-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendReply();
    }
  });

  // Check if opened with a specific user
  const params = new URLSearchParams(window.location.search);
  const toUser = params.get('user');
  if (toUser) {
    await openConversationByUsername(toUser);
  }

  await loadConversations();

  // Poll for new messages every 10 seconds
  pollInterval = setInterval(async () => {
    await loadConversations();
    if (activeConversationUserId) {
      await loadThread(activeConversationUserId, false);
    }
  }, 10000);
});

async function loadConversations() {
  const container = document.getElementById('conversations-list');

  try {
    // Get all messages involving current user
    const { data: messages, error } = await window.db
      .from('messages')
      .select('*')
      .or(`sender_id.eq.${currentUser.id},recipient_id.eq.${currentUser.id}`)
      .order('created_at', { ascending: false });

    if (error) throw error;

    if (!messages || messages.length === 0) {
      container.innerHTML = '<div style="padding:16px;color:var(--text-muted);font-size:14px;text-align:center;">No messages yet.</div>';
      return;
    }

    // Build unique conversation partners
    const partnerIds = new Set();
    const latestByPartner = {};

    messages.forEach(m => {
      const partnerId = m.sender_id === currentUser.id ? m.recipient_id : m.sender_id;
      if (!latestByPartner[partnerId]) {
        latestByPartner[partnerId] = m;
        partnerIds.add(partnerId);
      }
    });

    // Fetch partner profiles
    const { data: profiles } = await window.db
      .from('profiles')
      .select('user_id, username, display_name')
      .in('user_id', [...partnerIds]);

    const profileMap = {};
    if (profiles) profiles.forEach(p => { profileMap[p.user_id] = p; });

    // Count unread per partner
    const unreadMap = {};
    messages.forEach(m => {
      if (m.recipient_id === currentUser.id && !m.is_read) {
        const partnerId = m.sender_id;
        unreadMap[partnerId] = (unreadMap[partnerId] || 0) + 1;
      }
    });

    container.innerHTML = [...partnerIds].map(partnerId => {
      const profile = profileMap[partnerId];
      const username = profile?.username || 'unknown';
      const displayName = profile?.display_name || username;
      const latest = latestByPartner[partnerId];
      const unread = unreadMap[partnerId] || 0;
      const initial = username.charAt(0).toUpperCase();
      const isActive = partnerId === activeConversationUserId;
      const preview = latest.content.length > 40 ? latest.content.substring(0, 40) + '...' : latest.content;
      const timestamp = new Date(latest.created_at).toLocaleDateString('en-US', {
        month: 'short', day: 'numeric'
      });

      return `
        <div class="conversation-item" data-user-id="${partnerId}" data-username="${escapeHtml(username)}"
          style="padding:12px;border-radius:8px;cursor:pointer;margin-bottom:4px;display:flex;gap:10px;align-items:center;
          background:${isActive ? 'var(--bg-hover)' : 'transparent'};transition:background 0.15s ease;">
          <div class="post-avatar" style="width:40px;height:40px;font-size:16px;flex-shrink:0;">${initial}</div>
          <div style="flex:1;min-width:0;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:2px;">
              <div style="font-size:14px;font-weight:${unread > 0 ? '700' : '600'};color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(displayName)}</div>
              <div style="font-size:11px;color:var(--text-muted);flex-shrink:0;margin-left:8px;">${timestamp}</div>
            </div>
            <div style="display:flex;justify-content:space-between;align-items:center;">
              <div style="font-size:13px;color:var(--text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(preview)}</div>
              ${unread > 0 ? `<span style="background:var(--primary);color:#fff;font-size:11px;font-weight:700;min-width:18px;height:18px;border-radius:100px;display:inline-flex;align-items:center;justify-content:center;padding:0 4px;flex-shrink:0;margin-left:8px;">${unread}</span>` : ''}
            </div>
          </div>
        </div>
      `;
    }).join('');

    // Attach click listeners
    container.querySelectorAll('.conversation-item').forEach(item => {
      item.addEventListener('click', async () => {
        const userId = item.dataset.userId;
        const username = item.dataset.username;
        await openConversation(userId, username);
      });
    });

  } catch (err) {
    console.error('Conversations error:', err);
    container.innerHTML = '<div style="padding:16px;color:var(--text-muted);font-size:14px;">Could not load messages.</div>';
  }
}

async function openConversationByUsername(username) {
  const { data: profile } = await window.db
    .from('profiles')
    .select('user_id, username, display_name')
    .eq('username', username.toLowerCase())
    .single();

  if (profile) {
    await openConversation(profile.user_id, profile.username);
  }
}

async function openConversation(userId, username) {
  activeConversationUserId = userId;
  activeConversationUsername = username;

  // Update header
  const { data: profile } = await window.db
    .from('profiles')
    .select('username, display_name')
    .eq('user_id', userId)
    .single();

  const displayName = profile?.display_name || profile?.username || username;
  document.getElementById('thread-header').innerHTML = `
    <div style="display:flex;align-items:center;gap:10px;">
      <div class="post-avatar" style="width:36px;height:36px;font-size:14px;">${displayName.charAt(0).toUpperCase()}</div>
      <div>
        <div style="font-size:15px;font-weight:700;color:var(--text);">${escapeHtml(displayName)}</div>
        <a href="/profile.html?user=${encodeURIComponent(username)}" style="font-size:12px;color:var(--text-muted);text-decoration:none;">@${escapeHtml(username)}</a>
      </div>
    </div>
  `;

  document.getElementById('thread-compose').style.display = 'block';
  document.getElementById('message-input').focus();

  // Mark conversation items active
  document.querySelectorAll('.conversation-item').forEach(item => {
    item.style.background = item.dataset.userId === userId ? 'var(--bg-hover)' : 'transparent';
  });

  await loadThread(userId, true);
}

async function loadThread(userId, scrollToBottom = true) {
  const container = document.getElementById('thread-messages');

  try {
    const { data: messages, error } = await window.db
      .from('messages')
      .select('*')
      .or(`and(sender_id.eq.${currentUser.id},recipient_id.eq.${userId}),and(sender_id.eq.${userId},recipient_id.eq.${currentUser.id})`)
      .order('created_at', { ascending: true });

    if (error) throw error;

    if (!messages || messages.length === 0) {
      container.innerHTML = '<div style="text-align:center;color:var(--text-muted);font-size:14px;padding:32px;">No messages yet. Say something!</div>';
      return;
    }

    // Mark unread messages as read
    const unreadIds = messages
      .filter(m => m.recipient_id === currentUser.id && !m.is_read)
      .map(m => m.id);

    if (unreadIds.length > 0) {
      await window.db
        .from('messages')
        .update({ is_read: true })
        .in('id', unreadIds);
    }

    container.innerHTML = messages.map(m => {
      const isMine = m.sender_id === currentUser.id;
      const timestamp = new Date(m.created_at).toLocaleDateString('en-US', {
        month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
      });

      return `
        <div style="display:flex;flex-direction:column;align-items:${isMine ? 'flex-end' : 'flex-start'};">
          <div style="max-width:70%;padding:10px 14px;border-radius:${isMine ? '16px 16px 4px 16px' : '16px 16px 16px 4px'};
            background:${isMine ? 'var(--primary)' : 'var(--bg-input)'};
            color:${isMine ? '#fff' : 'var(--text)'};
            font-size:14px;line-height:1.5;word-break:break-word;">
            ${escapeHtml(m.content)}
          </div>
          <div style="font-size:11px;color:var(--text-muted);margin-top:3px;padding:0 4px;">${timestamp}</div>
        </div>
      `;
    }).join('');

    if (scrollToBottom) {
      container.scrollTop = container.scrollHeight;
    }

  } catch (err) {
    console.error('Thread error:', err);
  }
}

async function handleSendReply() {
  if (!activeConversationUserId) return;

  const input = document.getElementById('message-input');
  const content = input.value.trim();
  if (!content) return;

  const btn = document.getElementById('send-btn');
  btn.disabled = true;

  try {
    const { error } = await window.db
      .from('messages')
      .insert({
        sender_id: currentUser.id,
        recipient_id: activeConversationUserId,
        content: content,
        is_read: false
      });

    if (error) throw error;

    input.value = '';
    await loadThread(activeConversationUserId, true);
    await loadConversations();

  } catch (err) {
    console.error('Send error:', err);
  }

  btn.disabled = false;
  input.focus();
}

async function handleSendNewMessage() {
  const usernameInput = document.getElementById('new-message-username').value.trim().replace('@', '');
  const content = document.getElementById('new-message-content').value.trim();
  const errorEl = document.getElementById('username-error');

  errorEl.style.display = 'none';

  if (!usernameInput) {
    errorEl.textContent = 'Enter a username.';
    errorEl.style.display = 'block';
    return;
  }

  if (!content) {
    errorEl.textContent = 'Enter a message.';
    errorEl.style.display = 'block';
    return;
  }

  const btn = document.getElementById('send-new-message-btn');
  btn.textContent = 'Sending...';
  btn.disabled = true;

  try {
    // Look up recipient
    const { data: recipient } = await window.db
      .from('profiles')
      .select('user_id, username')
      .eq('username', usernameInput.toLowerCase())
      .single();

    if (!recipient) {
      errorEl.textContent = 'User not found.';
      errorEl.style.display = 'block';
      btn.textContent = 'Send';
      btn.disabled = false;
      return;
    }

    if (recipient.user_id === currentUser.id) {
      errorEl.textContent = 'You cannot message yourself.';
      errorEl.style.display = 'block';
      btn.textContent = 'Send';
      btn.disabled = false;
      return;
    }

    const { error } = await window.db
      .from('messages')
      .insert({
        sender_id: currentUser.id,
        recipient_id: recipient.user_id,
        content: content,
        is_read: false
      });

    if (error) throw error;

    document.getElementById('new-message-modal').style.display = 'none';
    btn.textContent = 'Send';
    btn.disabled = false;

    await loadConversations();
    await openConversation(recipient.user_id, recipient.username);

  } catch (err) {
    console.error('New message error:', err);
    errorEl.textContent = 'Something went wrong. Try again.';
    errorEl.style.display = 'block';
    btn.textContent = 'Send';
    btn.disabled = false;
  }
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.appendChild(document.createTextNode(text));
  return div.innerHTML;
}
