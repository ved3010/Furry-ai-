const fs = require('fs');
const content = fs.readFileSync('main.js', 'utf8');

const targets = ['requestSingleInstanceLock', 'SingleInstance', 'lock'];
for (const target of targets) {
  let idx = 0;
  while ((idx = content.indexOf(target, idx)) !== -1) {
    console.log(`Found "${target}" at index ${idx}:`);
    console.log(content.substring(Math.max(0, idx - 150), Math.min(content.length, idx + 250)));
    console.log('--------------------------------------------------\n');
    idx += target.length;
  }
}
