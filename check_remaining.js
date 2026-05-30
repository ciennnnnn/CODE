const fs = require('fs');

function showCodes(label, str) {
  var parts = [];
  for (var i = 0; i < str.length && i < 30; i++) {
    var c = str.charCodeAt(i);
    if (c > 127) parts.push('[U+' + c.toString(16).toUpperCase() + ']');
    else parts.push(str[i]);
  }
  console.log(label + ': ' + parts.join(''));
}

var f = fs.readFileSync('c:/xampp/htdocs/CODE/FIELD/field.html', 'utf8').split('\n');
var c = fs.readFileSync('c:/xampp/htdocs/CODE/CITIZEN/civilian.html', 'utf8').split('\n');

console.log('=== field.html ===');
[205, 207, 221, 389].forEach(function(idx) {
  var l = f[idx];
  if (!l) return;
  var m = l.match(/>([^<]+)</);
  if (m && m[1].trim()) showCodes('L'+(idx+1), m[1].trim());
  else showCodes('L'+(idx+1), l.trim().substring(0, 40));
});

console.log('\n=== civilian.html ===');
[210, 274, 293, 475, 520, 524, 528, 551].forEach(function(idx) {
  var l = c[idx];
  if (!l) return;
  var m = l.match(/>([^<]+)</);
  if (m && m[1].trim()) showCodes('L'+(idx+1), m[1].trim());
  else showCodes('L'+(idx+1), l.trim().substring(0, 40));
});
