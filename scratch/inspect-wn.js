const fs = require('fs');
const content = fs.readFileSync('c:/Users/mitka/OneDrive/Desktop/AE Codes/cattu3.0/renderer/renderer.js', 'utf8');

// Find function Wn(
const searchStr = 'function Wn(';
const index = content.indexOf(searchStr);
if (index !== -1) {
  console.log('--- Context around function Wn( ---');
  console.log(content.substring(index, index + 1500));
} else {
  // Let's search for Wn = or Wn=
  const searchStr2 = 'Wn=';
  const index2 = content.indexOf(searchStr2);
  if (index2 !== -1) {
    console.log('--- Context around Wn= ---');
    console.log(content.substring(index2 - 200, index2 + 1000));
  } else {
    console.log('Could not find Wn definition');
  }
}
