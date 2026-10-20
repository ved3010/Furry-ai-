const fs = require('fs');
const content = fs.readFileSync('c:/Users/mitka/OneDrive/Desktop/AE Codes/cattu3.0/renderer/renderer.js', 'utf8');
const target = '||ye&&getComputedStyle(ye).display!=="none"&&U(ye.getBoundingClientRect(),e,t)||Ze&&getComputedStyle(Ze).display!=="none"&&U(Ze.getBoundingClientRect(),e,t)';
const index = content.indexOf(target);
if (index === -1) {
  console.log('Target string NOT found!');
} else {
  console.log('Target string found at index:', index);
  // check if there is another occurrence
  const nextIndex = content.indexOf(target, index + 1);
  console.log('Second occurrence index (should be -1):', nextIndex);
}
