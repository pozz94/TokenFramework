import token from './framework/token.js';

token('test-infinite-loop', function() {
	const counter = signal(0);
	effect(()=>counter.v++);
});