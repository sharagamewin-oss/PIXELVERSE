import {
  auth, db, createUserWithEmailAndPassword, signInWithEmailAndPassword,
  signOut, onAuthStateChanged, updateProfile, doc, setDoc, getDoc, serverTimestamp
} from './firebase.js';

const $ = (id) => document.getElementById(id);
let mode = 'login'; // 'login' | 'register'

/* ---------- modal ---------- */
function openAuth(m) {
  setMode(m);
  $('authError').textContent = '';
  $('authModal').classList.add('open');
  $('authEmail').focus();
}
function closeAuth() {
  $('authModal').classList.remove('open');
}
function setMode(m) {
  mode = m;
  const reg = m === 'register';
  $('authTitle').textContent = reg ? 'Create your creator account' : 'Welcome back';
  $('authSubmit').textContent = reg ? 'Register' : 'Log in';
  $('authSwitch').textContent = reg ? 'Already have an account? Log in' : 'New here? Create an account';
  $('authUsernameWrap').style.display = reg ? '' : 'none';
  $('authUsername').required = reg;
  $('authPassword').autocomplete = reg ? 'new-password' : 'current-password';
}

$('openLogin').addEventListener('click', () => openAuth('login'));
$('openRegister').addEventListener('click', () => openAuth('register'));
$('authClose').addEventListener('click', closeAuth);
$('authSwitch').addEventListener('click', () => setMode(mode === 'login' ? 'register' : 'login'));
$('authModal').addEventListener('pointerdown', (e) => { if (e.target === $('authModal')) closeAuth(); });
$('logoutBtn').addEventListener('click', () => signOut(auth));

/* ---------- errors ---------- */
function friendly(err) {
  const map = {
    'auth/email-already-in-use': 'That email is already registered. Try logging in.',
    'auth/invalid-email': 'Please enter a valid email address.',
    'auth/weak-password': 'Password must be at least 6 characters.',
    'auth/invalid-credential': 'Incorrect email or password.',
    'auth/user-not-found': 'Incorrect email or password.',
    'auth/wrong-password': 'Incorrect email or password.',
    'auth/too-many-requests': 'Too many attempts. Please wait a moment and try again.',
    'auth/network-request-failed': 'Network problem. Check your connection.',
    'permission-denied': 'Account created, but saving your profile was blocked by the database rules.'
  };
  return map[err.code] || 'Something went wrong. Please try again.';
}

/* ---------- submit ---------- */
$('authForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = $('authEmail').value.trim();
  const password = $('authPassword').value;
  const username = $('authUsername').value.trim();
  const btn = $('authSubmit');
  const err = $('authError');
  err.textContent = '';

  if (mode === 'register' && !/^[A-Za-z0-9_ .-]{3,24}$/.test(username)) {
    err.textContent = 'Username: 3–24 characters (letters, numbers, spaces, . _ -).';
    return;
  }

  btn.disabled = true;
  try {
    if (mode === 'register') {
      const cred = await createUserWithEmailAndPassword(auth, email, password);
      await updateProfile(cred.user, { displayName: username });
      await setDoc(doc(db, 'users', cred.user.uid), {
        username,
        photoURL: '',
        bio: '',
        createdAt: serverTimestamp()
      });
    } else {
      await signInWithEmailAndPassword(auth, email, password);
    }
    $('authForm').reset();
    closeAuth();
  } catch (error) {
    console.error(error);
    err.textContent = friendly(error);
  } finally {
    btn.disabled = false;
  }
});

/* ---------- auth state ---------- */
onAuthStateChanged(auth, async (user) => {
  const chip = $('userChip');
  const links = $('authLinks');
  if (user) {
    $('userName').textContent = user.displayName || user.email;
    chip.classList.add('show');
    links.style.display = 'none';

    // Database test: read the profile back (also repairs a missing profile)
    try {
      const ref = doc(db, 'users', user.uid);
      const snap = await getDoc(ref);
      if (!snap.exists()) {
        await setDoc(ref, {
          username: user.displayName || 'Creator',
          photoURL: '',
          bio: '',
          createdAt: serverTimestamp()
        });
      }
      console.log('Firestore OK. Profile:', (await getDoc(ref)).data());
    } catch (e) {
      console.error('Firestore test failed:', e);
    }
  } else {
    chip.classList.remove('show');
    links.style.display = '';
  }
});
