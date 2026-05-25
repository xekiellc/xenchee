// ─── MENTION AUTOCOMPLETE ────────────────────────────────────────────────────

function initMentionAutocomplete(textareaId, dropdownId) {
  const textarea = document.getElementById(textareaId);
  const dropdown = document.getElementById(dropdownId);
  if (!textarea || !dropdown) return;

  let mentionStart = -1;
  let mentionQuery = '';

  textarea.addEventListener('input', async () => {
    const val = textarea.value;
    const cursor = textarea.selectionStart;

    // Find @ before cursor
    let atPos = -1;
    for (let i = cursor - 1; i >= 0; i--) {
      if (val[i] === '@') { atPos = i; break; }
      if (val[i] === ' ' || val[i] === '\n') break;
    }

    if (atPos === -1) {
      closeMentionDropdown(dropdown);
      return;
    }

    mentionStart = atPos;
    mentionQuery = val.slice(atPos + 1, cursor);

    if (mentionQuery.length < 1) {
      closeMentionDropdown(dropdown);
      return;
    }

    await searchMentions(mentionQuery, dropdown, textarea, mentionStart);
  });

  textarea.addEventListener('keydown', (e) => {
    if (dropdown.style.display === 'none') return;
    const items = dropdown.querySelectorAll('.mention-item');
    const active = dropdown.querySelector('.mention-item.active');
    let idx = Array.from(items).indexOf(active);

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (idx < items.length - 1) {
        if (active) active.classList.remove('active');
        items[idx + 1].classList.add('active');
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (idx > 0) {
        if (active) active.classList.remove('active');
        items[idx - 1].classList.add('active');
      }
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      if (active) {
        e.preventDefault();
        insertMention(textarea, active.dataset.username, mentionStart, dropdown);
      }
    } else if (e.key === 'Escape') {
      closeMentionDropdown(dropdown);
    }
  });

  document.addEventListener('click', (e) => {
    if (!dropdown.contains(e.target) && e.target !== textarea) {
      closeMentionDropdown(dropdown);
    }
  });
}

async function searchMentions(query, dropdown, textarea, mentionStart) {
  if (!window.db) return;
  try {
    const { data: profiles } = await window.db
      .from('profiles')
      .select('user_id, username, display_name')
      .ilike('username', `${query}%`)
      .limit(6);

    if (!profiles || profiles.length === 0) {
      closeMentionDropdown(dropdown);
      return;
    }

    dropdown.style.display = 'block';
    dropdown.innerHTML = profiles.map((p, idx) => `
      <div class="mention-item${idx === 0 ? ' active' : ''}"
        data-username="${p.username}"
        data-user-id="${p.user_id}"
        style="display:flex;align-items:center;gap:10px;padding:8px 12px;cursor:pointer;border-radius:8px;transition:background 0.1s;">
        <div style="width:28px;height:28px;border-radius:50%;background:var(--primary-dim);color:var(--primary);display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;flex-shrink:0;">
          ${p.username.charAt(0).toUpperCase()}
        </div>
        <div>
          <div style="font-size:14px;font-weight:600;color:var(--text);">${escapeHtmlMention(p.display_name || p.username)}</div>
          <div style="font-size:12px;color:var(--text-muted);">@${escapeHtmlMention(p.username)}</div>
        </div>
      </div>
    `).join('');

    dropdown.querySelectorAll('.mention-item').forEach(item => {
      item.addEventListener('mouseenter', () => {
        dropdown.querySelectorAll('.mention-item').forEach(i => i.classList.remove('active'));
        item.classList.add('active');
      });
      item.addEventListener('mousedown', (e) => {
        e.preventDefault();
        insertMention(textarea, item.dataset.username, mentionStart, dropdown);
      });
    });

  } catch (err) {
    closeMentionDropdown(dropdown);
  }
}

function insertMention(textarea, username, mentionStart, dropdown) {
  const val = textarea.value;
  const cursor = textarea.selectionStart;
  const before = val.slice(0, mentionStart);
  const after = val.slice(cursor);
  textarea.value = `${before}@${username} ${after}`;
  const newCursor = mentionStart + username.length + 2;
  textarea.setSelectionRange(newCursor, newCursor);
  textarea.focus();
  closeMentionDropdown(dropdown);
}

function closeMentionDropdown(dropdown) {
  if (dropdown) { dropdown.style.display = 'none'; dropdown.innerHTML = ''; }
}

// ─── MENTION RENDERING ───────────────────────────────────────────────────────

function renderMentions(text) {
  if (!text) return '';
  const escaped = escapeHtmlMention(text);
  return escaped.replace(/@([a-zA-Z0-9_]+)/g, (match, username) => {
    return `<a href="/profile.html?user=${username}" style="color:var(--primary);font-weight:600;text-decoration:none;">@${username}</a>`;
  });
}

// ─── MENTION NOTIFICATIONS ───────────────────────────────────────────────────

async function fireMentionNotifications(content, postId, authorUserId) {
  if (!window.db || !content) return;

  const mentions = [...new Set(content.match(/@([a-zA-Z0-9_]+)/g) || [])];
  if (mentions.length === 0) return;

  const usernames = mentions.map(m => m.slice(1).toLowerCase());

  try {
    const { data: profiles } = await window.db
      .from('profiles')
      .select('user_id, username')
      .in('username', usernames);

    if (!profiles || profiles.length === 0) return;

    const notifications = profiles
      .filter(p => p.user_id !== authorUserId)
      .map(p => ({
        user_id: p.user_id,
        type: 'mention',
        reference_id: postId,
        reference_type: 'post',
        content: 'mentioned you in a post',
        is_read: false
      }));

    if (notifications.length > 0) {
      await window.db.from('notifications').insert(notifications);
    }
  } catch (err) {
    console.error('Mention notification error:', err);
  }
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function escapeHtmlMention(text) {
  const div = document.createElement('div');
  div.appendChild(document.createTextNode(text || ''));
  return div.innerHTML;
}
