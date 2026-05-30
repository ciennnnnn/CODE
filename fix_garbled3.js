const fs = require('fs');

function ch() {
  return String.fromCharCode.apply(null, Array.prototype.slice.call(arguments));
}

// ── Shared sequences ─────────────────────────────────────────
var enDash   = ch(0xe2, 0x20ac, 0x201c); // U+2013 en-dash garbled
var leftArr  = ch(0xe2, 0x2020, 0x90);   // U+2190 ← left arrow garbled
var midDot   = ch(0xc2, 0xb7);           // U+00B7 · middle dot garbled
var clearX   = ch(0xe2, 0x153, 0x2022);  // U+2715 ✕ garbled
var eyeIcon  = ch(0xf0, 0x178, 0x2018, 0x81); // U+1F441 👁 garbled
var bell     = ch(0xf0, 0x178, 0x201d, 0x201d); // U+1F514 🔔 garbled
var antennaPfx = ch(0xf0, 0x178, 0x201c, 0xa1) + ' '; // 📡 prefix to remove
var lockPfx  = ch(0xf0, 0x178, 0x201d, 0x2018) + ' '; // 🔒 prefix to remove
var pinIcon  = ch(0xf0, 0x178, 0x201d, 0x8d);  // 📍 U+1F4CD garbled
var searchPfx = ch(0xf0, 0x178, 0x2022, 0x94) + ' '; // 🔍 prefix
var alertPin = ch(0xf0, 0x178, 0x201c, 0x8d) + ' '; // 📌 or similar prefix in alerts
var mapEmoji = ch(0xf0, 0x178, 0x2014, 0xba);  // 🗺 garbled (without variation selector)
var mapVS    = ch(0xef, 0xb8, 0x8f);            // variation selector U+FE0F garbled
var timer    = ch(0xe2, 0x8f, 0xb1);            // ⏱ U+23F1 garbled
var siren    = ch(0xf0, 0x178, 0x161, 0xa8);    // 🚨 U+1F6A8 garbled
var gpsPin   = ch(0xf0, 0x178, 0x201d, 0x8d);   // 📍 in GPS check-in button
var chat     = ch(0xf0, 0x178, 0x2019, 0xac);   // 💬 U+1F4AC garbled
var testTube = ch(0xf0, 0x178, 0x2022, 0xaa);   // 🧪 U+1F9EA garbled
var camera   = ch(0xf0, 0x178, 0x201d, 0xb8);   // 📸 U+1F4F8 garbled

// ── dispatch.html ──────────────────────────────────────────
var dPath = 'c:/xampp/htdocs/CODE/DISPATCH/dispatch.html';
var d = fs.readFileSync(dPath, 'utf8');
d = d.split(bell).join('&#128276;'); // notification bell
fs.writeFileSync(dPath, d, 'utf8');
console.log('Saved dispatch.html');

// ── field.html ────────────────────────────────────────────
var fPath = 'c:/xampp/htdocs/CODE/FIELD/field.html';
var f = fs.readFileSync(fPath, 'utf8');

// Middle dots (separators)
f = f.split(midDot).join('&middot;');

// Notification bell
f = f.split(bell).join('&#128276;');

// Timer emoji prefix
f = f.split(timer + ' ').join('');
f = f.split(timer).join('');

// Active job emojis - remove prefix from action buttons
f = f.split(siren + ' ').join('');
f = f.split(siren).join('');
f = f.split(gpsPin + ' ').join('&#128204; ');
f = f.split(chat + ' ').join('');
f = f.split(chat).join('');
f = f.split(testTube + ' ').join('');
f = f.split(testTube).join('');
f = f.split(camera + ' ').join('');
f = f.split(camera).join('');

// Map emoji (with variation selector)
f = f.split(mapEmoji + mapVS + ' ').join('');
f = f.split(mapEmoji + mapVS).join('');
f = f.split(mapEmoji + ' ').join('');
f = f.split(mapEmoji).join('');
f = f.split(mapVS).join('');

fs.writeFileSync(fPath, f, 'utf8');
console.log('Saved field.html');

// ── civilian.html ─────────────────────────────────────────
var cPath = 'c:/xampp/htdocs/CODE/CITIZEN/civilian.html';
var c = fs.readFileSync(cPath, 'utf8');

// En-dash in Security heading
c = c.split(enDash).join('&ndash;');

// Left arrows in Back buttons
c = c.split(leftArr).join('&#8592;');

// Middle dot in subtitle
c = c.split(midDot).join('&middot;');

// CLEAR button X mark
c = c.split(clearX + ' ').join('');
c = c.split(clearX).join('');

// Eye icon in password toggles
c = c.split(eyeIcon).join('&#128065;');

// Notification bell
c = c.split(bell).join('&#128276;');

// GPS button
c = c.split(antennaPfx).join('');
c = c.split(ch(0xf0, 0x178, 0x201c, 0xa1)).join('');

// Lock emoji in alert
c = c.split(lockPfx).join('');
c = c.split(ch(0xf0, 0x178, 0x201d, 0x2018)).join('');

// Pin icon in alert
var pin2 = ch(0xf0, 0x178, 0x201c, 0x8d);
c = c.split(pin2 + ' ').join('');
c = c.split(pin2).join('');

// Pin in map label
c = c.split(pinIcon + ' ').join('');
c = c.split(pinIcon).join('');

// Map emoji
c = c.split(mapEmoji + mapVS + ' ').join('');
c = c.split(mapEmoji + mapVS).join('');
c = c.split(mapEmoji + ' ').join('');
c = c.split(mapEmoji).join('');
c = c.split(mapVS).join('');

// Search/magnifier icon
c = c.split(searchPfx).join('');
c = c.split(ch(0xf0, 0x178, 0x2022, 0x94)).join('');

// Rocket, gem, target for About page
var rocket = ch(0xf0, 0x178, 0x161, 0x80);
var gem    = ch(0xf0, 0x178, 0x2019, 0x8e);
var target = ch(0xf0, 0x178, 0x17e, 0xaf);
var person = ch(0xf0, 0x178, 0x2019, 0xa4);
c = c.split(rocket + ' ').join('');
c = c.split(gem + ' ').join('');
c = c.split(target + ' ').join('');
c = c.split(person).join('&#128100;');

fs.writeFileSync(cPath, c, 'utf8');
console.log('Saved civilian.html');

console.log('Done.');
