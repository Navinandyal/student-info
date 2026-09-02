const form = document.getElementById('loginForm');
const statusBox = document.getElementById('status');

(async () => {
  const res = await fetch('/api/me');
  const data = await res.json();
  if (data.authenticated) window.location.href = '/student';
})();

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  statusBox.className = 'status info';
  statusBox.textContent = 'Logging in...';

  const payload = {
    username: form.username.value.trim(),
    password: form.password.value,
  };

  try {
    const response = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await response.json();

    if (!response.ok) throw new Error(data.message || 'Login failed.');
    window.location.href = '/student';
  } catch (error) {
    statusBox.className = 'status error';
    statusBox.textContent = error.message;
  }
});
