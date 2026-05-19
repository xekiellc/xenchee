async function waitForDb(timeout = 5000) {
  const start = Date.now();
  while (!window.db) {
    if (Date.now() - start > timeout) throw new Error('Supabase init timeout');
    await new Promise(r => setTimeout(r, 50));
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  await waitForDb();
  const signupBtn = document.getElementById('signup-btn');
  signupBtn.addEventListener('click', handleSignup);
});

async function handleSignup() {
  const email = document.getElementById('email').value.trim();
  const username = document.getElementById('username').value.trim();
  const password = document.getElementById('password').value;
  const dob = document.getElementById('dob').value;
  const terms = document.getElementById('terms').checked;

  clearAlert();

  if (!email || !username || !password || !dob) {
    showAlert('Please fill in all fields.', 'error');
    return;
  }

  if (!terms) {
    showAlert('You must agree to the Terms of Service to join.', 'error');
    return;
  }

  if (!window.isOver18(dob)) {
    showAlert('You must be 18 or older to join XenChee.', 'error');
    return;
  }

  if (password.length < 8) {
    showAlert('Password must be at least 8 characters.', 'error');
    return;
  }

  const usernameRegex = /^[a-zA-Z0-9_]+$/;
  if (!usernameRegex.test(username)) {
    showAlert('Username can only contain letters, numbers, and underscores.', 'error');
    return;
  }

  const btn = document.getElementById('signup-btn');
  btn.textContent = 'Creating account...';
  btn.disabled = true;

  try {
    const { data: existing } = await window.db
      .from('profiles')
      .select('username')
      .eq('username', username.toLowerCase())
      .single();

    if (existing) {
      showAlert('That username is already taken. Please choose another.', 'error');
      btn.textContent = 'Create Account';
      btn.disabled = false;
      return;
    }

    const { data, error } = await window.auth.signUp(email, password, dob);

    if (error) {
      showAlert(error.message, 'error');
      btn.textContent = 'Create Account';
      btn.disabled = false;
      return;
    }

    if (data?.user) {
      await window.db.from('profiles').insert({
        user_id: data.user.id,
        username: username.toLowerCase(),
        display_name: username,
      });

      await window.db.from('users').insert({
        id: data.user.id,
        email: email,
        date_of_birth: dob,
        is_18_verified: true,
      });

      showAlert('Account created! Please check your email to confirm your account.', 'success');
      btn.textContent = 'Account Created';

      setTimeout(() => {
        window.location.href = '/login.html';
      }, 3000);
    }

  } catch (err) {
    console.error('Signup error:', err);
    showAlert('Something went wrong. Please try again.', 'error');
    btn.textContent = 'Create Account';
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
