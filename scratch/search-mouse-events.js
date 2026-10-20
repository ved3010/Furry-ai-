const fs = require('fs');
const content = fs.readFileSync('c:/Users/mitka/OneDrive/Desktop/AE Codes/cattu3.0/renderer/renderer.js', 'utf8');
const search = 'mouse';
let pos = content.toLowerCase().indexOf(search);
while (pos !== -1) {
  console.log(`Match at index ${pos}:`);
  console.log(content.substring(Math.max(0, pos - 100), Math.min(content.length, pos + 200)));
  pos = content.toLowerCase().indexOf(search, pos + 1);
}
