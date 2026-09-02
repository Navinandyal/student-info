const fs = require('fs');
const path = require('path');

const file = path.resolve(process.cwd(), 'credentials', 'google-token.json');
if (!fs.existsSync(file)) {
  console.error('credentials/google-token.json was not found. Run this command from your OLD project folder where Google was already connected.');
  process.exit(1);
}

const token = JSON.parse(fs.readFileSync(file, 'utf8'));
if (!token.refresh_token) {
  console.error('The token file does not contain a refresh_token. Re-authorize Google once with offline access and prompt=consent.');
  process.exit(1);
}

console.log('\nCopy this value into your backend .env and Vercel Environment Variables:\n');
console.log(`GOOGLE_REFRESH_TOKEN=${token.refresh_token}`);
console.log('\nKeep this value private. Do not commit it to GitHub.\n');
