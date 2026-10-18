const fs = require('node:fs');
const input = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const observations = JSON.parse(process.argv[3]);
const original = observations.map(ref => fs.readFileSync(ref.path).subarray(ref.start_byte, ref.end_byte).toString('utf8')).join('\n');
const key = /DECODING_KEY=(\d+)/.exec(original);
if (!key) throw new Error('required earlier raw output range missing');
const bytes = Buffer.from(input.bytes.map(value => value ^ Number(key[1])));
console.log('decoded=' + bytes.toString('utf8'));
