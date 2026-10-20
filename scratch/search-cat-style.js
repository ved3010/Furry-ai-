const fs = require('fs');
const content = fs.readFileSync('c:/Users/mitka/OneDrive/Desktop/AE Codes/cattu3.0/renderer/styles.css', 'utf8');
const regex = /#cat\b/g;
let match;
while ((match = regex.exec(content)) !== null) {
  console.log(`Match at index ${match.index}:`);
  console.log(content.substring(Math.max(0, match.index - 50), Math.min(content.length, match.index + 200)));
}
