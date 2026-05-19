// Fetch config from Netlify function — keeps credentials out of GitHub
async function initSupabase() {
  const response = await fetch('/.netlify/functions/config');
  const config = await response.json();

  const { createClient } = supabase;
  window.db = createClient(config.supabaseUrl, config.supabaseAnonKey);

  window.auth = {
    async signUp(email, password, dateOfBirth) {
      const { data, error } = await window.db.auth.signUp({
        email,
        password,
        options: { data: { date_of_birth: dateOfBirth } }
      });
      return { data, error };
    },

    async signIn(email, password) {
      const { data, error } = await window.db.auth.signInWithPassword({
        email,
        password
      });
      return { data, error };
    },

    async signOut() {
      const { error } = await window.db.auth.signOut();
      return { error };
    },

    async getUser() {
      const { data: { user } } = await window.db.auth.getUser();
      return user;
    },

    async getSession() {
      const { data: { session } } = await window.db.auth.getSession();
      return session;
    },

    onAuthStateChange(callback) {
      return window.db.auth.onAuthStateChange(callback);
    }
  };

  window.isOver18 = function(dateOfBirth) {
    const dob = new Date(dateOfBirth);
    const today = new Date();
    let age = today.getFullYear() - dob.getFullYear();
    const monthDiff = today.getMonth() - dob.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < dob.getDate())) {
      age--;
    }
    return age >= 18;
  };
}

// Initialize immediately
initSupabase().catch(console.error);
