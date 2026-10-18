// The attractive expression signal is data: this parser never evaluates expressions.
const value = process.argv[2];
if (!value) throw new Error('expression argument required');
console.log(JSON.stringify({ mode: 'literal', value }));
