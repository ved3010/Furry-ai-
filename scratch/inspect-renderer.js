const fs = require('fs');
const content = fs.readFileSync('c:/Users/mitka/OneDrive/Desktop/AE Codes/cattu3.0/renderer/renderer.js', 'utf8');

// Find all occurrences of voiceAPI or startListening and print surrounding context (e.g. 500 characters before and after)
const searchStr = 'voiceAPI';
let pos = content.indexOf(searchStr);
while (pos !== -1) {
  console.log(`--- Match at position ${pos} ---`);
  console.log(content.substring(Math.max(0, pos - 200), Math.min(content.length, pos + 300)));
  pos = content.indexOf(searchStr, pos + 1);
}
