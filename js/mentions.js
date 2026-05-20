// Shared @mention autocomplete for post and comment composers

async function initMentionAutocomplete(textareaId, dropdownId) {
  const textarea = document.getElementById(textareaId);
  const dropdown = document.getElementById(dropdownId);
  if (!textarea || !dropdown) return;

  let mentionStart = -1;
  let mentionActive = false;

  textarea.addEventListener('keydown', (e) => {
    if (mentionActive) {
      if (e.key === 'Escape') {
        closeMentionDropdown(dropdown);
        mentionActive = false;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        moveMentionSelection(dropdown, 1);
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        moveMentionSelection(dropdown, -1);
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        const selected = dropdown.querySelector('.mention-option.selected');
        if (selected) {
          e.preventDefault();
          insertMention(textarea, selected.dataset.username, mentionStart);
          closeMentionDropdown(dropdown);
          mentionActive = false;
        }
      }
    }
  });

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
      mentionActive = false;
      return;
    }

    const query = val.slice(atPos + 1, cursor);
    if (query.length === 0) {
      closeMentionDropdown(dropdown);
      mentionActive = false;
      return;
    }

    mentionStart = atPos;
    mentionActive = true;

    // Search users
    const { data: users } = await window.db
      .from('profiles')
      .select('username, display_name')
      .ilike('username', `${query}%`)
      .limit(6);

    if (!users || users.length === 0) {
      closeMentionDropdown(dropdown);
      return;
    }

    dropdown.innerHTML = users.map((u, i) => `
      <div class="mention-option${i === 0 ? ' selected' : ''}" data-username="${u.username}"
        style="padding:8px 12px;cursor:pointer;display:flex;align-items:center;gap:8px;font-size:14px;border-radius:6px;transition:background 0.1s ease;">
        <div style="width:28px;height:28px;border-radius:50%;background:var(--primary);color:#fff;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;flex-shrink:0;">
          ${u.username.charAt(0).toUpperCase()}
        </div>
        <div>
          <div style="font-weight:600;color:var(--text);">${escapeHtml(u.display_name || u.username)}</div>
          <div style="font-size:12px;color:var(--text-muted);">@${escapeHtml(u.username)}</div>
        </div>
      </div>
    `).join('');

    dropdown.style.display = 'block';

    // Click to select
    dropdown.querySelectorAll('.mention-option').forEach(opt => {
      opt.addEventListener('mousedown', (e) => {
        e.preventDefault();
        insertMention(textarea, opt.dataset.username, mentionStart);
        closeMentionDropdown(dropdown);
        mentionActive = false;
      });
      opt.addEventListener('mouseover', () => {
        dropdown.querySelectorAll('.mention-option').forEach(o => o.classList.remove('selected'));
        opt.classList.add('selected');
      });
    });
  });

  // Close on outside click
  document.addEventListener('click', (e) => {
    if (!dropdown.contains(e.target) && e.target !== textarea) {
      closeMentionDropdown(dropdown);
      mentionActive = false;
    }
  });
}

function insertMention(textarea, username, atPos) {
  const val = textarea.value;
  const cursor = textarea.selectionStart;
  const before = val.slice(0, atPos);
  const after = val.slice(cursor);
  const mention = `@${username} `;
  textarea.value = before + mention + after;
  const newCursor = atPos + mention.length;
  textarea.setSelectionRange(newCursor, newCursor);
  textarea.focus();
}

function closeMentionDropdown(dropdown) {
  dropdown.style.display = 'none';
  dropdown.innerHTML = '';
}

function moveMentionSelection(dropdown, direction) {
  const options = [...dropdown.querySelectorAll('.mention-option')];
  const currentIndex = options.findIndex(o => o.classList.contains('selected'));
  options.forEach(o => o.classList.remove('selected'));
  let newIndex = currentIndex + direction;
  if (newIndex < 0) newIndex = options.length - 1;
  if (newIndex >= options.length) newIndex = 0;
  options[newIndex].classList.add('selected');
  options[newIndex].scrollIntoView({ block: 'nearest' });
}

function renderMentions(text) {
  // Convert @username to clickable links
  return escapeHtml(text).replace(/@([a-zA-Z0-9_]+)/g, (match, username) => {
    return `<a href="/profile.html?user=${encodeURIComponent(username)}" style="color:var(--primary);font-weight:600;text-decoration:none;">@${username}</a>`;
  });
}
