# Simplified Signal Modifiers API (signalNew6.js)

## Overview

A clean, composable API for timing control and data transformation in reactive signals.

## Core Concepts

1. **Signal Methods** - `.debounce()` and `.throttle()` available on ALL signals
2. **Standalone Functions** - `debounce()` and `throttle()` for single or multiple signals
3. **Unpack Modifier** - `.unpack()` converts promise signals to `{loading, error, data}`

## API

### Signal Methods

Every signal has `.debounce()` and `.throttle()` methods:

```javascript
const query = state('');
const debouncedQuery = query.debounce(300);
const throttledQuery = query.throttle(500);

// Use anywhere
effect(() => {
    console.log(debouncedQuery.v);
});
```

### Standalone Functions

For more control or synchronizing multiple signals:

```javascript
import { debounce, throttle } from './signalNew6.js';

// Single signal
const debounced = debounce(mySignal, 300);
const throttled = throttle(mySignal, 500);

// Multiple signals (synchronized)
const [url, options] = debounce([urlSignal, optionsSignal], 300);
const [x, y] = throttle([xSignal, ySignal], 100);
```

### Unpack Modifier

Convert promise signals to `{loading, error, data}`:

```javascript
const userData = computed(async (signal) => {
    const response = await fetch(url, { signal });
    return await response.json();
});

// Unpack for UI
const unpackedData = computed.unpack(userData);

effect(() => {
    const { loading, error, data } = unpackedData.v;

    if (loading) return 'Loading...';
    if (error) return `Error: ${error.message}`;
    return `Name: ${data.name}`;
});
```

## Usage Patterns

### Pattern 1: Search with Debounced Input

```javascript
const searchQuery = state('');
const debouncedQuery = searchQuery.debounce(300);

const results = computed.fetcher(
    computed(() => `/api/search?q=${debouncedQuery.v}`)
).unpack();

effect(() => {
    const { loading, data } = results.v;
    // Render results
});
```

### Pattern 2: Scroll with Throttled Position

```javascript
const scrollPos = state(0);
const throttledPos = scrollPos.throttle(100);

const pageData = computed.fetcher(
    computed(() => `/api/page/${Math.floor(throttledPos.v / 1000)}`)
);
```

### Pattern 3: Synchronized Parameters

```javascript
const url = state('/api/users');
const options = state({ method: 'GET' });

// Debounce both together
const [debouncedUrl, debouncedOptions] = debounce([url, options], 300);

const data = computed.fetcher(debouncedUrl, debouncedOptions);
```

### Pattern 4: Output Throttling

```javascript
// Fetch immediately on input change
const fastData = computed.fetcher(searchUrl);

// But throttle how often UI updates
const throttledData = fastData.throttle(500);

effect(async () => {
    const data = await throttledData.v;
    updateUI(data); // Updates max once per 500ms
});
```

### Pattern 5: Complete Chain

```javascript
const query = state('');

// Input debouncing
const debouncedQuery = query.debounce(300);

// Fetch
const results = computed.fetcher(
    computed(() => `/api/search?q=${debouncedQuery.v}`)
);

// Output throttling + unpack
const display = results.throttle(500).unpack();

effect(() => {
    const { loading, error, data } = display.v;
    // Render with loading/error states
});
```

## Key Differences from signalNew5.js

**signalNew5.js** (Complex):
```javascript
// Input modifiers as builders
computed.debounceInput(300).fetcher(url)
computed.throttleInput(500).fetcher(url)

// Output modifiers as methods
computed.fetcher(url).debounce(300)
computed.fetcher(url).throttle(500)
```

**signalNew6.js** (Simplified):
```javascript
// Just debounce/throttle the signals themselves!
const debouncedUrl = url.debounce(300);
computed.fetcher(debouncedUrl)

// Or debounce/throttle the output
computed.fetcher(url).debounce(300)
```

## Benefits

1. **Simpler mental model** - Timing modifiers work on signals, not builders
2. **More composable** - Use debounced/throttled signals anywhere
3. **Less API surface** - No `debounceInput`, `throttleInput`, `addOutputModifiers`, etc.
4. **More flexible** - Synchronize multiple signals easily
5. **Cleaner code** - Natural signal composition

## Migration from signalNew5.js

```javascript
// OLD (signalNew5)
computed.debounceInput(300).fetcher(url, options)
computed.throttleInput(500).fetcher(url, options).unpack()

// NEW (signalNew6)
const [dUrl, dOpts] = debounce([url, options], 300);
computed.fetcher(dUrl, dOpts)

const [tUrl, tOpts] = throttle([url, options], 500);
computed.fetcher(tUrl, tOpts).unpack()

// Or if only url needs timing control
computed.fetcher(url.debounce(300), options)
computed.fetcher(url.throttle(500), options).unpack()
```

## Examples

See `examples/simplified-modifiers.js` for complete working examples.
