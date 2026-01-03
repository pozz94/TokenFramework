import { state, computed, effect } from '../src/signalNew5.js';

// Example: Comprehensive modifier chaining system

const searchQuery = state('');

console.log('=== Modifier Chaining System ===\n');
console.log('INPUT modifiers: debounceInput, throttleInput (go at START)');
console.log('OUTPUT modifiers: debounce, throttle (go at END)');
console.log('UNPACK modifier: unpack (goes at VERY END)\n');

// 1. Basic fetcher (no modifiers)
console.log('1. Basic fetcher:');
const basic = computed.fetcher(
    computed(() => `https://jsonplaceholder.typicode.com/users/${searchQuery.v || 1}`)
);
effect(async () => {
    try {
        const data = await basic.v;
        console.log('  Basic:', data.name);
    } catch (err) {
        console.log('  Basic error:', err.message);
    }
});

// 2. Input debounced (debounces URL changes)
console.log('\n2. Input debounced (300ms on URL changes):');
const inputDebounced = computed.debounceInput(300).fetcher(
    computed(() => `https://jsonplaceholder.typicode.com/users/${searchQuery.v || 2}`)
);
effect(async () => {
    try {
        const data = await inputDebounced.v;
        console.log('  Input debounced:', data.name);
    } catch (err) {
        console.log('  Input debounced error:', err.message);
    }
});

// 3. Output debounced (debounces result updates)
console.log('\n3. Output debounced (300ms on result):');
const outputDebounced = computed.fetcher(
    computed(() => `https://jsonplaceholder.typicode.com/users/${searchQuery.v || 3}`)
).debounce(300);
effect(async () => {
    try {
        const data = await outputDebounced.v;
        console.log('  Output debounced:', data.name);
    } catch (err) {
        console.log('  Output debounced error:', err.message);
    }
});

// 4. Input throttled (throttles URL changes)
console.log('\n4. Input throttled (500ms on URL changes):');
const inputThrottled = computed.throttleInput(500).fetcher(
    computed(() => `https://jsonplaceholder.typicode.com/users/${searchQuery.v || 4}`)
);
effect(async () => {
    try {
        const data = await inputThrottled.v;
        console.log('  Input throttled:', data.name);
    } catch (err) {
        console.log('  Input throttled error:', err.message);
    }
});

// 5. Output throttled (throttles result updates)
console.log('\n5. Output throttled (500ms on result):');
const outputThrottled = computed.fetcher(
    computed(() => `https://jsonplaceholder.typicode.com/users/${searchQuery.v || 5}`)
).throttle(500);
effect(async () => {
    try {
        const data = await outputThrottled.v;
        console.log('  Output throttled:', data.name);
    } catch (err) {
        console.log('  Output throttled error:', err.message);
    }
});

// 6. Unpacked (returns {loading, error, data})
console.log('\n6. Unpacked:');
const unpacked = computed.fetcher(
    computed(() => `https://jsonplaceholder.typicode.com/users/${searchQuery.v || 6}`)
).unpack();
effect(() => {
    const { loading, error, data } = unpacked.v;
    if (loading) console.log('  Unpacked: Loading...');
    else if (error) console.log('  Unpacked error:', error.message);
    else console.log('  Unpacked:', data.name);
});

// 7. Input debounced + Unpacked
console.log('\n7. Input debounced + Unpacked:');
const inputDebouncedUnpacked = computed.debounceInput(300).fetcher(
    computed(() => `https://jsonplaceholder.typicode.com/users/${searchQuery.v || 7}`)
).unpack();
effect(() => {
    const { loading, error, data } = inputDebouncedUnpacked.v;
    if (loading) console.log('  Input debounced + Unpacked: Loading...');
    else if (error) console.log('  Input debounced + Unpacked error:', error.message);
    else console.log('  Input debounced + Unpacked:', data.name);
});

// 8. Output debounced + Unpacked
console.log('\n8. Output debounced + Unpacked:');
const outputDebouncedUnpacked = computed.fetcher(
    computed(() => `https://jsonplaceholder.typicode.com/users/${searchQuery.v || 8}`)
).debounce(300).unpack();
effect(() => {
    const { loading, error, data } = outputDebouncedUnpacked.v;
    if (loading) console.log('  Output debounced + Unpacked: Loading...');
    else if (error) console.log('  Output debounced + Unpacked error:', error.message);
    else console.log('  Output debounced + Unpacked:', data.name);
});

// 9. Complex chain: Input throttled + Output debounced + Unpacked
console.log('\n9. Complex chain (throttle input 500ms + debounce output 300ms + unpack):');
const complex = computed.throttleInput(500).fetcher(
    computed(() => `https://jsonplaceholder.typicode.com/users/${searchQuery.v || 9}`)
).debounce(300).unpack();
effect(() => {
    const { loading, error, data } = complex.v;
    if (loading) console.log('  Complex: Loading...');
    else if (error) console.log('  Complex error:', error.message);
    else console.log('  Complex:', data.name);
});

// Test by changing search query
console.log('\n\n=== Changing search query after 2 seconds ===\n');
setTimeout(() => {
    searchQuery.v = '10';
}, 2000);

console.log('\n\n=== Changing again after 4 seconds ===\n');
setTimeout(() => {
    searchQuery.v = '1';
}, 4000);
