async function waitForDb(timeout = 5000) {
  const start = Date.now();
  while (!window.db) {
    if (Date.now() - start > timeout) throw new Error('Supabase init timeout');
    await new Promise(r => setTimeout(r, 50));
  }
}

let currentUser = null;
let slugChecking = false;
let slugValid = false;

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

  // Auto-generate slug from name
  document.getElementById('community-name').addEventListener('input', (e) => {
    const name = e.target.value;
    const slug = name
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .slice(0, 50);
    document.getElementById('community-slug').value = slug;
    validateSlug(slug);
  });

  // Manual slug edit
  let slugTimeout;
  document.getElementById('community-slug').addEventListener('input', (e) => {
    let slug = e.target.value
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '')
      .replace(/-+/g, '-');
    e.target.value = slug;
    clearTimeout(slugTimeout);
    slugTimeout = setTimeout(() => validateSlug(slug), 400);
  });

  // Description character count
  document.getElementById('community-description').addEventListener('input', (e) => {
    document.getElementById('desc-count').textContent = e.target.value.length;
  });

  // Add rule
  document.getElementById('add-rule-btn').addEventListener('click', () => {
    const container = document.getElementById('rules-container');
    const rules = container.querySelectorAll('.rule-input');
    if (rules.length >= 10) return;
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'form-input rule-input';
    input.placeholder = `Rule ${rules.length + 1}`;
    input.maxLength = 150;
    input.style.marginBottom = '8px';
    container.appendChild(input);
  });

  document.getElementById('create-btn').addEventListener('click', handleCreate);
});

async function validateSlug(slug) {
  const statusEl = document.getElementById('slug-status');

  if (!slug || slug.length < 2) {
    statusEl.textContent = 'Slug must be at least 2 characters.';
    statusEl.style.color = 'var(--danger)';
    slugValid = false;
    return;
  }

  if (slug.startsWith('-') || slug.endsWith('-')) {
    statusEl.textContent = 'Slug cannot start or end with a hyphen.';
    statusEl.style.color = 'var(--danger)';
    slugValid = false;
    return;
  }

  statusEl.textContent = 'Checking availability...';
  statusEl.style.color = 'var(--text-muted)';
  slugChecking = true;

  const { data: existing } = await window.db
    .from('communities')
    .select('id')
    .eq('slug', slug)
    .single();

  slugChecking = false;

  if (existing) {
    statusEl.textContent = `v/${slug} is already taken.`;
    statusEl.style.color = 'var(--danger)';
    slugValid = false;
  } else {
    statusEl.textContent = `✓ v/${slug} is available!`;
    statusEl.style.color = '#4caf7d';
    slugValid = true;
  }
}

async function handleCreate() {
  const name = document.getElementById('community-name').value.trim();
  const slug = document.getElementById('community-slug').value.trim();
  const description = document.getElementById('community-description').value.trim();
  const type = document.querySelector('input[name="community-type"]:checked').value;
  const rules = Array.from(document.querySelectorAll('.rule-input'))
    .map(r => r.value.trim())
    .filter(r => r.length > 0);

  const errorEl = document.getElementById('create-error');
  errorEl.style.display = 'none';

  // Validate
  if (!name) return showError('Community name is required.');
  if (!slug || slug.length < 2) return showError('Community URL is required (min 2 characters).');
  if (!description) return showError('Description is required.');
  if (slugChecking) return showError('Still checking URL availability — please wait.');
  if (!slugValid) return showError('That community URL is already taken or invalid.');

  const btn = document.getElementById('create-btn');
  btn.textContent = 'Creating...';
  btn.disabled = true;

  try {
    // Double-check slug availability
    const { data: existing } = await window.db
      .from('communities')
      .select('id')
      .eq('slug', slug)
      .single();

    if (existing) {
      showError(`v/${slug} is already taken. Choose a different URL.`);
      btn.textContent = 'Create Community';
      btn.disabled = false;
      return;
    }

    // Insert community
    const { data: community, error } = await window.db
      .from('communities')
      .insert({
        name,
        slug,
        description,
        community_type: type,
        rules: rules.length > 0 ? rules : null,
        is_official: false,
        member_count: 1,
        post_count: 0,
        created_by: currentUser.id
      })
      .select()
      .single();

    if (error) throw error;

    // Auto-join as moderator
    await window.db
      .from('community_members')
      .insert({
        community_id: community.id,
        user_id: currentUser.id,
        role: 'moderator'
      });

    // Redirect to new community
    window.location.href = `/community.html?slug=${slug}`;

  } catch (err) {
    console.error('Create community error:', err);
    showError('Something went wrong. Please try again.');
    btn.textContent = 'Create Community';
    btn.disabled = false;
  }
}

function showError(msg) {
  const errorEl = document.getElementById('create-error');
  errorEl.textContent = msg;
  errorEl.style.display = 'block';
}
