document.addEventListener('DOMContentLoaded', async () => {
  // If already logged in redirect to feed
  const user = await auth.getUser();
  if (user) {
    window.location.href = '/feed.html';
    return;
  }

  const loginBtn = document.getElementById('login-btn');
  loginBtn.addEventListener('click', handleLogin);

  // Allow enter key to submit
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
    const { data, error } = await auth.signIn(email, password);

    if (error) {
      showAlert('Invalid email or password. Please try again.', 'error');
      btn.textContent = 'Log In';
      btn.disabled = false;
      return;
    }

    if (data?.user) {
      // Update last login
      await db
        .from('users')
        .update({ last_login: new Date().toISOString() })
        .eq('id', data.user.id);

      window.location.href = '/feed.html';
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
  const container = document.getElementById('alert-container');
  container.innerHTML = '';
}
