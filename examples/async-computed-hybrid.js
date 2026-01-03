import { state, computed, effect } from '../src/signalNew5.js';

// Example: Hybrid approach with promise-based async computed signals

// Create a reactive user ID
const userId = state(1);

// Method 1: Using async computed directly
const userData = computed(async (signal) => {
    const id = userId.v;
    console.log(`Fetching user ${id}...`);

    const response = await fetch(`https://jsonplaceholder.typicode.com/users/${id}`, { signal });
    return await response.json();
});

// Method 2: Using computed.fetcher (also returns promise)
const userDataAlt = computed.fetcher(url`https://jsonplaceholder.typicode.com/users/${userId}`);

// Approach 1: Use the promise directly for chaining async operations
const userPosts = computed(async (signal) => {
    const user = await userData.v;  // Clean async/await
    console.log(`Fetching posts for ${user.name}...`);

    const response = await fetch(`https://jsonplaceholder.typicode.com/posts?userId=${user.id}`, { signal });
    return await response.json();
});

// Approach 2: Unpack for UI with {loading, error, data}
const userDataUnpacked = computed.unpack(userData);
const userPostsUnpacked = computed.unpack(userPosts);

// Effect for UI rendering - uses unpacked version
effect(() => {
    const { loading, error, data } = userDataUnpacked.v;

    if (loading) {
        console.log('UI: Loading user...');
    } else if (error) {
        console.log('UI: Error:', error.message);
    } else {
        console.log('UI: User loaded:', data.name, data.email);
    }
});

// Effect for posts - also uses unpacked version
effect(() => {
    const { loading, error, data } = userPostsUnpacked.v;

    if (loading) {
        console.log('UI: Loading posts...');
    } else if (error) {
        console.log('UI: Error loading posts:', error.message);
    } else {
        console.log('UI: Posts loaded:', data.length, 'posts');
    }
});

// Advanced: Use promise directly in an async effect
effect(async (signal) => {
    try {
        const user = await userData.v;
        console.log('Direct effect: Got user', user.name);

        // Can do more async work here
        const posts = await userPosts.v;
        console.log('Direct effect: Got', posts.length, 'posts');
    } catch (error) {
        if (error.name !== 'AbortError') {
            console.error('Direct effect error:', error);
        }
    }
});

// Change user ID after 2 seconds
setTimeout(() => {
    console.log('\n--- Changing user ID to 2 ---\n');
    userId.v = 2;
}, 2000);

// Change again after 4 seconds
setTimeout(() => {
    console.log('\n--- Changing user ID to 3 ---\n');
    userId.v = 3;
}, 4000);
