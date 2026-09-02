const crypto = require('crypto');

const COOKIE_NAME = 'student_admin_auth';
const COOKIE_MAX_AGE_MS = 8 * 60 * 60 * 1000;

function getSessionSecret() {
  const secret = String(process.env.SESSION_SECRET || '').trim();
  if (!secret) {
    throw new Error('SESSION_SECRET must be configured.');
  }
  return secret;
}

function sign(value) {
  return crypto.createHmac('sha256', getSessionSecret()).update(value).digest('base64url');
}

function createAuthToken(username) {
  const payload = Buffer.from(
    JSON.stringify({ username, exp: Date.now() + COOKIE_MAX_AGE_MS }),
    'utf8'
  ).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

function verifyAuthToken(token) {
  if (!token || !token.includes('.')) return null;
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return null;

  const expected = sign(payload);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  try {
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!decoded.username || !decoded.exp || Date.now() > Number(decoded.exp)) return null;
    return decoded;
  } catch (_) {
    return null;
  }
}

function parseCookies(req) {
  const raw = String(req.headers.cookie || '');
  return raw.split(';').reduce((cookies, entry) => {
    const index = entry.indexOf('=');
    if (index === -1) return cookies;
    const key = entry.slice(0, index).trim();
    const value = entry.slice(index + 1).trim();
    if (key) cookies[key] = decodeURIComponent(value);
    return cookies;
  }, {});
}

function getAuthenticatedUser(req) {
  try {
    const token = parseCookies(req)[COOKIE_NAME];
    return verifyAuthToken(token);
  } catch (_) {
    return null;
  }
}

function isRequestAuthenticated(req) {
  return Boolean(getAuthenticatedUser(req));
}

function setAuthCookie(res, username) {
  const token = createAuthToken(username);
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production' || Boolean(process.env.VERCEL),
    maxAge: COOKIE_MAX_AGE_MS,
    path: '/',
  });
}

function clearAuthCookie(res) {
  res.clearCookie(COOKIE_NAME, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production' || Boolean(process.env.VERCEL),
    path: '/',
  });
}

function requireAuth(req, res, next) {
  const user = getAuthenticatedUser(req);
  if (!user) {
    if (req.path && !req.path.startsWith('/api/')) {
      return res.redirect('/');
    }
    return res.status(401).json({ message: 'Please log in first.' });
  }
  req.adminUser = user;
  next();
}

module.exports = {
  setAuthCookie,
  clearAuthCookie,
  requireAuth,
  isRequestAuthenticated,
};
