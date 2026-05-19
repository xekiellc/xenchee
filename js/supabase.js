const SUPABASE_URL = 'https://vclvqbblcnimzbdwejzl.supabase.co';
const SUPABASE_ANON_KEY = window.ENV_SUPABASE_ANON_KEY || '';

const { createClient } = supabase;
const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Auth helpers
const auth = {
  async signUp(email, password, dateOfBirth) {
    const { data, error } = await db.auth.signUp({
      email,
      password,
      options: {
        data: { date_of_birth: dateOfBirth }
      }
    });
    return { data, error };
  },

  async signIn(email, password) {
    const { data, error } = await db.auth.signInWithPassword({
      email,
      password
    });
    return { data, error };
  },

  async signOut() {
    const { error } = await db.auth.signOut();
    return { error };
  },

  async getUser() {
    const { data: { user } } = await db.auth.getUser();
    return user;
  },

  async getSession() {
    const { data: { session } } = await db.auth.getSession();
    return session;
  },

  onAuthStateChange(callback) {
    return db.auth.onAuthStateChange(callback);
  }
};

// Age verification helper
function isOver18(dateOfBirth) {
  const dob = new Date(dateOfBirth);
  const today = new Date();
  const age = today.getFullYear() - dob.getFullYear();
  const monthDiff = today.getMonth() - dob.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < dob.getDate())) {
    return age - 1 >= 18;
  }
  return age >= 18;
}
