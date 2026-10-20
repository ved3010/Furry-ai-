const fs = require('fs');
const content = fs.readFileSync('main.js', 'utf8');

const target = 'function startVoiceAssistant';
const idx = content.indexOf(target);
if (idx !== -1) {
  console.log(content.substring(idx, idx + 1500));
} else {
  console.log('Not found');
}
