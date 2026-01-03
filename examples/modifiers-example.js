import { state, computed, effect } from '../src/signalNew5.js';

// Example: All modifiers working together

const searchQuery = state('');

console.log('=== Modifier Examples ===\n');

// 1. Basic promise-based fetcher
console.log('1. Basic fetcher (returns promise):');
const basicData = computed.fetcher(
    computed(() => `https://jsonplaceholder.typicode.com/users/${searchQuery.v || 1}`)
);

effect(async () => {
    try {
        const data = await basicData.v;
        console.log('  Basic:', data.name);
    } catch (err) {
        console.log('  Basic error:', err.message);
    }
});

// 2. Unpacked fetcher (returns {loading, error, data})
console.log('\n2. Unpacked fetcher:');
const unpackedData = computed.unpack().fetcher(
    computed(() => `https://jsonplaceholder.typicode.com/users/${searchQuery.v || 2}`)
);

effect(() => {
    const { loading, error, data } = unpackedData.v;
    if (loading) console.log('  Unpacked: Loading...');
    else if (error) console.log('  Unpacked error:', error.message);
    else console.log('  Unpacked:', data.name);
});

// 3. Debounced fetcher (returns promise, fetches are debounced)
console.log('\n3. Debounced fetcher (300ms):');
const debouncedData = computed.debounced(300).fetcher(
    computed(() => `https://jsonplaceholder.typicode.com/users/${searchQuery.v || 3}`)
);

effect(async () => {
    try {
        const data = await debouncedData.v;
        console.log('  Debounced:', data.name);
    } catch (err) {
        console.log('  Debounced error:', err.message);
    }
});

// 4. Debounced + Unpacked (returns {loading, error, data}, fetches are debounced)
console.log('\n4. Debounced + Unpacked:');
const debouncedUnpacked = computed.debounced(300).unpack().fetcher(
    computed(() => `https://jsonplaceholder.typicode.com/users/${searchQuery.v || 4}`)
);

effect(() => {
    const { loading, error, data } = debouncedUnpacked.v;
    if (loading) console.log('  Debounced+Unpacked: Loading...');
    else if (error) console.log('  Debounced+Unpacked error:', error.message);
    else console.log('  Debounced+Unpacked:', data.name);
});

// 5. Throttled fetcher
console.log('\n5. Throttled fetcher (500ms):');
const throttledData = computed.throttled(500).fetcher(
    computed(() => `https://jsonplaceholder.typicode.com/users/${searchQuery.v || 5}`)
);

effect(async () => {
    try {
        const data = await throttledData.v;
        console.log('  Throttled:', data.name);
    } catch (err) {
        console.log('  Throttled error:', err.message);
    }
});

// 6. Throttled + Unpacked
console.log('\n6. Throttled + Unpacked:');
const throttledUnpacked = computed.throttled(500).unpack().fetcher(
    computed(() => `https://jsonplaceholder.typicode.com/users/${searchQuery.v || 6}`)
);

effect(() => {
    const { loading, error, data } = throttledUnpacked.v;
    if (loading) console.log('  Throttled+Unpacked: Loading...');
    else if (error) console.log('  Throttled+Unpacked error:', error.message);
    else console.log('  Throttled+Unpacked:', data.name);
});

// 7. Manually unpacking any promise signal
console.log('\n7. Manual unpack:');
const promiseData = computed(async (signal) => {
    const query = searchQuery.v || 7;
    const response = await fetch(`https://jsonplaceholder.typicode.com/users/${query}`, { signal });
    return await response.json();
});

const manuallyUnpacked = computed.unpack(promiseData);

effect(() => {
    const { loading, error, data } = manuallyUnpacked.v;
    if (loading) console.log('  Manual unpack: Loading...');
    else if (error) console.log('  Manual unpack error:', error.message);
    else console.log('  Manual unpack:', data.name);
});

// Test by changing search query
console.log('\n\n=== Changing search query after 2 seconds ===\n');
setTimeout(() => {
    searchQuery.v = '8';
}, 2000);

console.log('\n\n=== Changing again after 4 seconds ===\n');
setTimeout(() => {
    searchQuery.v = '9';
}, 4000);
