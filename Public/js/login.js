(() => {
  const form = document.getElementById('login-form');
  const message = document.getElementById('form-message');
  const submit = form.querySelector('[type="submit"]');
  const label = submit.querySelector('.submit-label');
  const username = document.getElementById('username');
  const password = document.getElementById('password');
  const togglePassword = document.getElementById('toggle-password');

  // Always start empty — defeat browser/password-manager autofill (Chrome ignores autocomplete="off")
  function clearLoginFields() {
    try { form.reset(); } catch {}
    if (username) username.value = '';
    if (password) password.value = '';
    // nudge managers that this isn't a saveable login form
    if (username) username.setAttribute('autocomplete', 'off');
    if (password) password.setAttribute('autocomplete', 'new-password');
  }
  clearLoginFields();
  // autofill often fires after DOMContentLoaded / on bfcache restore
  window.addEventListener('pageshow', clearLoginFields);
  window.addEventListener('load', () => setTimeout(clearLoginFields, 80));
  setTimeout(clearLoginFields, 120);
  setTimeout(clearLoginFields, 400);

  togglePassword.addEventListener('click', () => {
    const showing = password.type === 'text';
    password.type = showing ? 'password' : 'text';
    togglePassword.setAttribute('aria-label', showing ? 'Show password' : 'Hide password');
  });

  document.getElementById('forgot').addEventListener('click', () => {
    message.textContent = 'Password reset is managed by your dashboard administrator. Check your deployment credentials.';
    message.classList.add('visible');
  });

  form.addEventListener('submit', async event => {
    event.preventDefault();
    message.textContent = '';
    message.classList.remove('visible');
    submit.disabled = true;
    label.textContent = 'Checking credentials…';

    try {
      const response = await fetch('/api/login', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: document.getElementById('username').value.trim(),
          password: password.value,
          remember: document.getElementById('remember').checked,
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (response.status === 401) throw new Error('That username and password don’t match. Please try again.');
        if (response.status === 503) throw new Error('Dashboard sign-in is not configured yet. Ask your administrator to set the dashboard credentials.');
        throw new Error(result.error || 'We couldn’t sign you in. Please try again.');
      }
      const requested = new URLSearchParams(location.search).get('next') || '/';
      const destination = new URL(requested, location.origin);
      const safeDestination = destination.origin === location.origin && destination.pathname !== '/login.html'
        ? destination.href
        : '/';
      location.assign(safeDestination);
    } catch (error) {
      message.textContent = error.message || 'Could not reach the sign-in service. Check your connection and try again.';
      message.classList.add('visible');
      submit.disabled = false;
      label.textContent = 'Sign in';
    }
  });
})();
