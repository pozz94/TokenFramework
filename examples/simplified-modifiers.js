import { state, computed, effect, debounce, throttle } from '../src/signalNew6.js';

// Example: Simplified modifier system

console.log('=== Simplified Modifier System ===\n');

const searchQuery = state('');
const scrollPos = state(0);
const url = state('https://api.example.com');
const options = state({ method: 'GET' });

// 1. Signal method: .debounce() / .throttle()
console.log('1. Using signal methods:');
const debouncedQuery = searchQuery.debounce(300);
const throttledScroll = scrollPos.throttle(100);

effect(() => {
    console.log(`  Debounced query: ${debouncedQuery.v}`);
});

effect(() => {
    console.log(`  Throttled scroll: ${throttledScroll.v}`);
});

// 2. Standalone functions for single signals
console.log('\n2. Using standalone functions (single signal):');
const debouncedUrl = debounce(url, 500);

effect(() => {
    console.log(`  Debounced URL: ${debouncedUrl.v}`);
});

// 3. Standalone functions for multiple signals (synchronized)
console.log('\n3. Using standalone functions (multiple signals):');
const [syncedUrl, syncedOptions] = debounce([url, options], 300);

effect(() => {
    console.log(`  Synced URL: ${syncedUrl.v}`);
    console.log(`  Synced options: ${JSON.stringify(syncedOptions.v)}`);
});

// 4. With fetcher - debounce the input
console.log('\n4. Fetcher with debounced input:');
const debouncedSearchUrl = searchQuery.debounce(300);
const searchResults = computed.fetcher(
    computed(() => `https://jsonplaceholder.typicode.com/users?q=${debouncedSearchUrl.v}`)
);

effect(async () => {
    try {
        const data = await searchResults.v;
        console.log(`  Search results: ${data.length} items`);
    } catch (err) {
        console.log(`  Search error: ${err.message}`);
    }
});

// 5. With fetcher - throttle the output
console.log('\n5. Fetcher with throttled output:');
const userData = computed.fetcher(
    computed(() => `https://jsonplaceholder.typicode.com/users/${searchQuery.v || 1}`)
);
const throttledUserData = userData.throttle(500);

effect(async () => {
    try {
        const data = await throttledUserData.v;
        console.log(`  Throttled user data: ${data.name}`);
    } catch (err) {
        console.log(`  Throttled error: ${err.message}`);
    }
});

// 6. With unpack for UI
console.log('\n6. Fetcher with unpack:');
const userDataUnpacked = computed.fetcher(
    computed(() => `https://jsonplaceholder.typicode.com/users/${searchQuery.v || 2}`)
).unpack();

effect(() => {
    const { loading, error, data } = userDataUnpacked.v;
    if (loading) console.log('  Unpacked: Loading...');
    else if (error) console.log(`  Unpacked error: ${error.message}`);
    else console.log(`  Unpacked: ${data.name}`);
});

// 7. Complete chain: debounce input + throttle output + unpack
console.log('\n7. Complete chain:');
const complexQuery = searchQuery.debounce(300);
const complexData = computed.fetcher(
    computed(() => `https://jsonplaceholder.typicode.com/users/${complexQuery.v || 3}`)
).throttle(500).unpack();

effect(() => {
    const { loading, error, data } = complexData.v;
    if (loading) console.log('  Complex: Loading...');
    else if (error) console.log(`  Complex error: ${error.message}`);
    else console.log(`  Complex: ${data.name}`);
});

// Test changes
console.log('\n\n=== Testing changes ===\n');
setTimeout(() => {
    console.log('Changing searchQuery to "test"...');
    searchQuery.v = 'test';
}, 1000);

setTimeout(() => {
    console.log('Changing scrollPos to 100...');
    scrollPos.v = 100;
}, 1500);

setTimeout(() => {
    console.log('Changing url...');
    url.v = 'https://api.example.com/v2';
}, 2000);
