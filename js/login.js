async function waitForDb(timeout = 5000) {
  const start = Date.now();
  while (!window.db) {
    if (Date.now() - start > timeout) throw new Error('Supabase init timeout');
    await new Promise(r => setTimeout(r, 50));
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  await waitForDb();

  const { data: { session } } = await window.db.auth.getSession();
  if (session?.user) {
    window.location.href = '/feed.html';
    return;
  }

  const loginBtn = document.getElementById('login-btn');
  loginBtn.addEventListener('click', handleLogin);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleLogin();
  });
});

async function handleLogin() {
  const email = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value;

  clearAlert();

  if (!email || !password) {
    showAlert('Please enter your email and password.', 'error');
    return;
  }

  const btn = document.getElementById('login-btn');
  btn.textContent = 'Logging in...';
  btn.disabled = true;

  try {
    const { data, error } = await window.auth.signIn(email, password);

    if (error) {
      showAlert('Invalid email or password. Please try again.', 'error');
      btn.textContent = 'Log In';
      btn.disabled = false;
      return;
    }

    if (data?.user) {
      await window.db
        .from('users')
        .update({ last_login: new Date().toISOString() })
        .eq('id', data.user.id);

      const { data: profile } = await window.db
        .from('profiles')
        .select('onboarding_complete')
        .eq('user_id', data.user.id)
        .single();

      if (profile?.onboarding_complete) {
        window.location.href = '/feed.html';
      } else {
        window.location.href = '/onboarding.html';
      }
    }

  } catch (err) {
    console.error('Login error:', err);
    showAlert('Something went wrong. Please try again.', 'error');
    btn.textContent = 'Log In';
    btn.disabled = false;
  }
}

function showAlert(message, type) {
  const container = document.getElementById('alert-container');
  container.innerHTML = `<div class="alert alert-${type}">${message}</div>`;
}

function clearAlert() {
  document.getElementById('alert-container').innerHTML = '';
}
