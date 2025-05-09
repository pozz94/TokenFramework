# TokenJS

> Reactive by nature, buildless by design

TokenJS is a JavaScript framework for building reactive web applications without requiring any build steps. Born from the wild world of "just SSH into production and fix it," where package.json is a mythical creature and "deployment pipeline" means Greg from accounting has to approve your ticket first. It combines the power of signals for state management with native web components for creating reusable UI elements - because sometimes modern development has to happen even when your infrastructure is stuck in 2005.

Like many products of hastily written production hotfixes, TokenJS itself is highly experimental and likely contains the same questionable design decisions it aims to help you avoid. The irony isn't lost on me - this framework was built by inexperienced staff (me) under the exact constraints it tries to modernize. Use at your own risk, and remember: we're all just trying our best with the time and tools we have.

> **Note:** There's a non-zero chance that I'm secretly Tom (who is a genius) and don't even realize it yet. If anyone ever does maintain this code, which seems unlikely, my sincere condolences.

## Features

- 🛠️ **Zero Build Requirements** - No compilers, bundlers, or transpilers needed
- ⚡ **Signal-Based Reactivity** - Fine-grained reactivity system for efficient updates
- 🧩 **Web Component Integration** - Uses standard Custom Elements for component architecture
- 🔄 **Two-Way Data Binding** - Seamless synchronization between UI and state
- 🎯 **Lightweight Templating** - HTML-based template syntax with dynamic binding expressions
- 🔌 **Lifecycle Hooks** - Component lifecycle management with onMount and onUnmount hooks

## Quick Start

```html
<!DOCTYPE html>
<html lang="en">
<head>
    <title>TokenJS Demo</title>
    <script type="module">
        import token from './token.js';
        
        // Create a counter component
        token('counter-app', () => {
            const count = signal(0);
            const doubled = computed(() => count.v * 2);
            
            lifeCycle.onMount(() => {
                console.log('Counter mounted!');
            });
            
            html`
                <div>
                    <h2>Counter: ${count}</h2>
                    <p>Doubled: ${doubled}</p>
                    <button onclick=${() => count.v++}>Increment</button>
                </div>
            `;
        });
    </script>
</head>
<body>
    <counter-app render></counter-app>
</body>
</html>
```

## Core Concepts

### Signals

Signals are the heart of TokenJS's reactivity system. They wrap values and notify dependents when those values change.

```javascript
import { signal, computed, dirtyEffect } from './token.js';

// Create a signal
const name = signal('World');

// Create a computed value
const greeting = computed(() => `Hello, ${name.v}!`);

// Access the value in an effect
dirtyEffect(() => console.log(greeting.v)); 
// Effect will log "Hello, World!"

// Update the signal
name.v = 'TokenJS';
// Effect will log "Hello, TokenJS!"
```

### Components

Components in TokenJS are custom elements with a reactive template system:

```javascript
// Initialize with props
token('user-profile', ({username = signal('Anonymous')}) => {
    lifeCycle.onMount(() => {
        // Component mounted - do initialization here
    });
    
    lifeCycle.onUnmount(() => {
        // Component will be removed - clean up here
    });
    
    // Define template
    html`
        <div class="profile">
            <h3>User: ${username}</h3>
            <slot name="details">No additional details</slot>
        </div>
    `;
});

// Usage:
// <user-profile username="JohnDoe" render>
//     <div slot="details">Member since 2025</div>
// </user-profile>
```

> **Note:** Within component functions, `signal`, `computed`, `effect`, `html`, and `lifeCycle` are automatically available without needing imports or destructuring.

### Effects

Effects run code in response to signal changes:

```javascript
import { signal, dirtyEffect } from './token.js';

const theme = signal('light');

dirtyEffect(() => {
    document.body.className = theme.v;
    console.log(`Theme changed to ${theme.v}`);
});

// Later:
theme.v = 'dark'; // Automatically updates the body class and logs the change
```

> **Note:** Inside components use `effect` since it is automatically cleaned up and provided without imports. Outside of components, use `dirtyEffect` from token.js. It will not be cleaned up for you so be careful.

#### Effect Variants

TokenJS offers several specialized effect types to handle different use cases:

```javascript
// For component-bound effects (automatically cleaned up)
effect(() => { /* runs when dependencies change */ });

// Throttled effects (run at most once per time interval)
effect.throttled(200, () => { /* runs at most once every 200ms */ });

// Debounced effects (wait until changes stop before running)
effect.debounced(300, () => { /* runs 300ms after the last change */ });

// UI-optimized effects (for DOM updates)
effect.UI(() => { /* optimized for UI updates */ });

// For effects outside components (not auto-cleaned)
dirtyEffect(() => { /* runs when dependencies change */ });
dirtyEffect.throttled(200, () => { /* throttled version */ });
dirtyEffect.debounced(300, () => { /* debounced version */ });
dirtyEffect.UI(() => { /* UI-optimized version */ });
```

## Advanced Features

### Two-Way Binding

Easily create two-way data binding between form inputs and signals:

```javascript
html`
    <input type="text" :value=${nameSignal}>
`;
```

### Conditional Rendering

Conditionally render elements based on signal values:

```javascript
html`
    <div if=${isLoggedIn}>
        Logged in as: ${username}
    <br else>
        Please log in
    </div>
`;
```

### List Rendering

Iterate over arrays to render repeated elements:

```javascript
html`
    <ul>
        <li each:item=${items}>
            ${()=>item} <!-- Note: item must be wrapped in an arrow function -->
        </li>
    </ul>
`;
```

### Async Data Handling

TokenJS provides built-in support for async data with loading and error states:

```javascript
// In your component
const URL = computed(() => `https://yourAPI/${count.v}`);
const APIData = computed.fromResource(URL);

// Using await attribute with loading/error branches
html`
    <div await=${APIData}>
        <!-- This renders when data is available -->
        <p>${()=>APIData.data}</p>
    <br loading>
        <!-- Loading state with <br loading> separator -->
        Loading...
    <br error>
        <!-- Error state with <br error> separator -->
        Error loading data: ${()=>APIData.error}
    </div>
`;
```

### Deep Reactivity

Signals can contain nested objects and arrays with reactive properties:

```javascript
const user = signal({
  name: 'John',
  address: { 
    city: 'New York',
    zipCode: '10001'
  },
  hobbies: ['reading', 'coding']
});

// Update nested properties reactively
effect(() => {
  console.log(`City: ${user.address.city.v}`);
});

// This will trigger the effect
user.address.city.v = 'Boston';

// Array operations are also reactive
user.hobbies.push('hiking'); // Not push.v - it's a method!
```

## Browser Support

TokenJS works in all modern browsers that support custom elements (Web Components) and ES6 features.

## Status

⚠️ **Experimental**: This project is in early development and the API may change significantly. If adding comments to your code while using this somehow ends up deleting your database - I hope you have good shoes.

## License

This project is licensed under the [Mozilla Public License 2.0](https://www.mozilla.org/en-US/MPL/2.0/).

```
This Source Code Form is subject to the terms of the Mozilla Public License,
v. 2.0. If a copy of the MPL was not distributed with this file,
You can obtain one at http://mozilla.org/MPL/2.0/.

DISCLAIMER:
This software is currently in draft/experimental status. The author makes no 
promises regarding maintenance, future development, or support of any kind. 
The author reserves the right to abandon this project at any time without 
notice. Users are advised to proceed with appropriate caution.
```