# Modifier System for Async Computed Signals

## Overview

The modifier system provides a flexible way to control timing and data structure of async computed signals.

## Modifier Types

### 1. INPUT Modifiers (Go at START)
Control when the fetch is triggered based on input changes.

- **`debounceInput(delay)`** - Waits for `delay` ms of no input changes before fetching
- **`throttleInput(delay)`** - Limits fetch frequency to once per `delay` ms

### 2. OUTPUT Modifiers (Go at END, before unpack)
Control when the result signal updates.

- **`.debounce(delay)`** - Waits for `delay` ms of no result changes before updating
- **`.throttle(delay)`** - Limits result update frequency to once per `delay` ms

### 3. UNPACK Modifier (Goes at VERY END)
Transforms the promise signal structure.

- **`.unpack()`** - Converts `Promise<T>` to `{loading: boolean, error: any, data: T}`

## Usage Examples

### Basic Fetcher
```javascript
// Returns: Promise<Data>
const data = computed.fetcher(url);

// Use in effects
effect(async () => {
    const result = await data.v;
    console.log(result);
});
```

### Input Modifiers
```javascript
// Debounce URL changes (e.g., search input)
const searchResults = computed.debounceInput(300).fetcher(
    computed(() => `/api/search?q=${query.v}`)
);

// Throttle URL changes (e.g., scroll pagination)
const pagedData = computed.throttleInput(1000).fetcher(
    computed(() => `/api/items?page=${page.v}`)
);
```

### Output Modifiers
```javascript
// Debounce result updates
const data = computed.fetcher(url).debounce(300);

// Throttle result updates
const data = computed.fetcher(url).throttle(500);
```

### Unpack Modifier
```javascript
// Convert to {loading, error, data}
const userData = computed.fetcher(url).unpack();

effect(() => {
    const { loading, error, data } = userData.v;

    if (loading) return 'Loading...';
    if (error) return `Error: ${error.message}`;
    return `Name: ${data.name}`;
});
```

### Complex Chains
```javascript
// Input debounced + Unpacked
// Perfect for search with loading states
const searchResults = computed
    .debounceInput(300)
    .fetcher(computed(() => `/api/search?q=${query.v}`))
    .unpack();

// Input throttled + Output debounced + Unpacked
// Complex timing control with UI states
const complexData = computed
    .throttleInput(1000)
    .fetcher(url)
    .debounce(300)
    .unpack();
```

## All Possible Combinations

### Promise-based (for chaining)
```javascript
computed.fetcher(url)
computed.debounceInput(ms).fetcher(url)
computed.throttleInput(ms).fetcher(url)
computed.fetcher(url).debounce(ms)
computed.fetcher(url).throttle(ms)
computed.debounceInput(ms).fetcher(url).debounce(ms)
computed.debounceInput(ms).fetcher(url).throttle(ms)
computed.throttleInput(ms).fetcher(url).debounce(ms)
computed.throttleInput(ms).fetcher(url).throttle(ms)
```

### Unpacked (for UI)
```javascript
computed.fetcher(url).unpack()
computed.debounceInput(ms).fetcher(url).unpack()
computed.throttleInput(ms).fetcher(url).unpack()
computed.fetcher(url).debounce(ms).unpack()
computed.fetcher(url).throttle(ms).unpack()
computed.debounceInput(ms).fetcher(url).debounce(ms).unpack()
computed.debounceInput(ms).fetcher(url).throttle(ms).unpack()
computed.throttleInput(ms).fetcher(url).debounce(ms).unpack()
computed.throttleInput(ms).fetcher(url).throttle(ms).unpack()
```

## When to Use What

### `debounceInput` vs `debounce`

**Use `debounceInput`** when:
- User is typing in a search box
- Form fields are changing rapidly
- You want to reduce API calls based on input changes

**Use `debounce`** when:
- The fetched data changes frequently
- You want to stabilize the UI by reducing render updates
- Multiple fetches might complete in quick succession

### `throttleInput` vs `throttle`

**Use `throttleInput`** when:
- Scroll position is changing continuously
- Monitoring real-time values that update frequently
- You want to limit fetch frequency

**Use `throttle`** when:
- Real-time data is updating too fast
- You want to limit how often the UI updates
- Smooth out rapid data changes

## Aliases

For backward compatibility:
- `computed.debounced` → `computed.debounceInput`
- `computed.throttled` → `computed.throttleInput`

## Advanced: Manual Unpack

You can also manually unpack any promise signal:

```javascript
const myAsyncComputed = computed(async (signal) => {
    const response = await fetch(url, { signal });
    return await response.json();
});

const unpacked = computed.unpack(myAsyncComputed);

effect(() => {
    const { loading, error, data } = unpacked.v;
    // ...
});
```
