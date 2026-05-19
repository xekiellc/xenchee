async function waitForDb(timeout = 5000) {
  const start = Date.now();
  while (!window.db) {
    if (Date.now() - start > timeout) throw new Error('Supabase init timeout');
    await new Promise(r => setTimeout(r, 50));
  }
}

let currentUser = null;

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

  document.getElementById('mark-all-read-btn').addEventListener('click', handleMarkAllRead);

  await loadNotifications();
});

async function loadNotifications() {
  const container = document.getElementById('notifications-container');
  container.innerHTML = '<div class="loading"><div class="spinner"></div>Loading notifications...</div>';

  try {
    const { data: notifications, error } = await window.db
      .from('notifications')
      .select('*')
      .eq('user_id', currentUser.id)
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) throw error;

    if (!notifications || notifications.length === 0) {
      container.innerHTML = '<div class="loading">No notifications yet.</div>';
      return;
    }

    // Fetch actor profiles (who triggered the notification)
    const actorIds = [...new Set(notifications.filter(n => n.actor_id).map(n => n.actor_id))];
    let actorMap = {};
    if (actorIds.length > 0) {
      const { data: actors } = await window.db
        .from('profiles')
        .select('user_id, username, display_name')
        .in('user_id', actorIds);
      if (actors) actors.forEach(a => { actorMap[a.user_id] = a; });
    }

    container.innerHTML = notifications.map(n => renderNotification(n, actorMap)).join('');
    attachNotificationListeners();

  } catch (err) {
    console.error('Notifications error:', err);
    container.innerHTML = '<div class="loading">Could not load notifications.</div>';
  }
}

function renderNotification(notification, actorMap) {
  const actor = actorMap[notification.actor_id];
  const actorName = actor ? (actor.display_name || actor.username) : 'Someone';
  const actorUsername = actor?.username || '';
  const isRead = notification.is_read;
  const timestamp = new Date(notification.created_at).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
  });

  const icon = getNotificationIcon(notification.type);
  const message = getNotificationMessage(notification.type, actorName);
  const link = getNotificationLink(notification);

  return `
    <div class="post-card notification-item" 
         data-notification-id="${notification.id}"
         data-link="${link}"
         style="cursor:pointer;${!isRead ? 'border-left:3px solid var(--primary);' : 'opacity:0.75;'}">
      <div style="display:flex;align-items:center;gap:12px;">
        <div style="font-size:24px;width:40px;text-align:center;flex-shrink:0;">${icon}</div>
        <div style="flex:1;">
          <div style="font-size:14px;color:var(--text);">
            ${actor ? `<a href="/profile.html?user=${encodeURIComponent(actorUsername)}" style="font-weight:600;color:var(--text);text-decoration:none;" onclick="event.stopPropagation();">${escapeHtml(actorName)}</a>` : `<span style="font-weight:600;">${escapeHtml(actorName)}</span>`}
            ${message}
          </div>
          ${notification.preview ? `<div style="font-size:13px;color:var(--text-muted);margin-top:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:500px;">${escapeHtml(notification.preview)}</div>` : ''}
          <div style="font-size:12px;color:var(--text-muted);margin-top:4px;">${timestamp}</div>
        </div>
        ${!isRead ? `<div style="width:8px;height:8px;border-radius:50%;background:var(--primary);flex-shrink:0;"></div>` : ''}
      </div>
    </div>
  `;
}

function getNotificationIcon(type) {
  const icons = {
    like: '❤️',
    downvote: '👎',
    comment: '💬',
    follow: '👤',
    mention: '📣',
    reply: '↩️',
  };
  return icons[type] || '🔔';
}

function getNotificationMessage(type, actorName) {
  const messages = {
    like: 'liked your post',
    downvote: 'downvoted your post',
    comment: 'commented on your post',
    follow: 'started following you',
    mention: 'mentioned you in a post',
    reply: 'replied to your comment',
  };
  return messages[type] || 'interacted with you';
}

function getNotificationLink(notification) {
  if (notification.type === 'follow' && notification.actor_id) {
    return `/profile.html?user=${notification.actor_id}`;
  }
  if (notification.post_id) {
    return `/comments.html?post=${notification.post_id}`;
  }
  return '/feed.html';
}

function attachNotificationListeners() {
  document.querySelectorAll('.notification-item').forEach(item => {
    item.addEventListener('click', async () => {
      const id = item.dataset.notificationId;
      const link = item.dataset.link;

      // Mark as read
      await window.db
        .from('notifications')
        .update({ is_read: true })
        .eq('id', id)
        .eq('user_id', currentUser.id);

      if (link) window.location.href = link;
    });
  });
}

async function handleMarkAllRead() {
  const btn = document.getElementById('mark-all-read-btn');
  btn.textContent = 'Marking...';
  btn.disabled = true;

  try {
    await window.db
      .from('notifications')
      .update({ is_read: true })
      .eq('user_id', currentUser.id)
      .eq('is_read', false);

    await loadNotifications();

  } catch (err) {
    console.error('Mark all read error:', err);
  }

  btn.textContent = 'Mark all read';
  btn.disabled = false;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.appendChild(document.createTextNode(text));
  return div.innerHTML;
}
