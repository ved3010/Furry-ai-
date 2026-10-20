const fs = require('fs');
const content = fs.readFileSync('c:/Users/mitka/OneDrive/Desktop/AE Codes/cattu3.0/comnyang_extracted/resources/app/renderer/renderer.js', 'utf8');

console.log('--- Last 3000 characters of EXTRACTED renderer.js ---');
console.log(content.substring(content.length - 3000));
