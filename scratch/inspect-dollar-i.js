const fs = require('fs');
const content = fs.readFileSync('c:/Users/mitka/OneDrive/Desktop/AE Codes/cattu3.0/renderer/renderer.js', 'utf8');

// Find function $i(
const searchStr = 'function $i(';
const index = content.indexOf(searchStr);
if (index !== -1) {
  console.log('--- Context around function $i( ---');
  console.log(content.substring(index, index + 1000));
} else {
  // search for $i = or $i=
  const searchStr2 = '$i=';
  const index2 = content.indexOf(searchStr2);
  if (index2 !== -1) {
    console.log('--- Context around $i= ---');
    console.log(content.substring(index2 - 200, index2 + 1000));
  } else {
    console.log('Could not find $i definition');
  }
}
