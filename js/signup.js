async function waitForDb(timeout = 5000) {
  const start = Date.now();
  while (!window.db) {
    if (Date.now() - start > timeout) throw new Error('Supabase init timeout');
    await new Promise(r => setTimeout(r, 50));
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  await waitForDb();

  // Redirect if already logged in
  const { data: { session } } = await window.db.auth.getSession();
  if (session?.user) {
    window.location.href = '/feed.html';
    return;
  }

  document.getElementById('signup-btn').addEventListener('click', handleSignup);

  document.getElementById('password-toggle').addEventListener('click', () => {
    const input = document.getElementById('password');
    input.type = input.type === 'password' ? 'text' : 'password';
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleSignup();
  });
});

async function handleSignup() {
  const email = document.getElementById('email').value.trim();
  const username = document.getElementById('username').value.trim().toLowerCase();
  const password = document.getElementById('password').value;
  const dob = document.getElementById('dob').value;
  const termsChecked = document.getElementById('terms').checked;

  clearAlert();

  if (!email || !username || !password || !dob) {
    showAlert('Please fill in all fields.', 'error');
    return;
  }

  if (!/^[a-zA-Z0-9_]+$/.test(username)) {
    showAlert('Username can only contain letters, numbers, and underscores.', 'error');
    return;
  }

  if (username.length < 3) {
    showAlert('Username must be at least 3 characters.', 'error');
    return;
  }

  if (password.length < 8) {
    showAlert('Password must be at least 8 characters.', 'error');
    return;
  }

  if (!window.isOver18(dob)) {
    showAlert('You must be 18 or older to join Voxxee.', 'error');
    return;
  }

  if (!termsChecked) {
    showAlert('Please agree to the Terms of Service and Privacy Policy.', 'error');
    return;
  }

  const recaptchaResponse = grecaptcha.getResponse();
  if (!recaptchaResponse) {
    showAlert('Please complete the reCAPTCHA verification.', 'error');
    return;
  }

  const btn = document.getElementById('signup-btn');
  btn.textContent = 'Creating account...';
  btn.disabled = true;

  try {
    // Check username availability
    const { data: existing } = await window.db
      .from('profiles')
      .select('username')
      .eq('username', username)
      .single();

    if (existing) {
      showAlert('That username is already taken. Please choose another.', 'error');
      btn.textContent = 'Create Account';
      btn.disabled = false;
      return;
    }

    // Sign up with Supabase Auth
    const { data, error } = await window.auth.signUp(email, password, dob);

    if (error) {
      if (error.message.includes('already registered')) {
        showAlert('An account with this email already exists.', 'error');
      } else {
        showAlert(error.message || 'Signup failed. Please try again.', 'error');
      }
      btn.textContent = 'Create Account';
      btn.disabled = false;
      return;
    }

    if (data?.user) {
      // Create profile
      await window.db.from('profiles').insert({
        user_id: data.user.id,
        username,
        display_name: username,
        onboarding_complete: false
      });

      // Create users record
      await window.db.from('users').insert({
        id: data.user.id,
        email,
        date_of_birth: dob,
        username
      });

      window.location.href = '/onboarding.html';
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
