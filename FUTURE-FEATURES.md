# Future Features for TokenJS

This document tracks potential future enhancements and features for the TokenJS reactive framework.

## 1. Combined Directives (if/await + each)

**Status**: Proposed
**Priority**: Medium
**Complexity**: Medium-High

### Description
Allow combining conditional/async directives with list directives on the same element for more powerful templating.

### Use Cases

#### Conditional Lists
```html
<div if=${showList} each:item=${items}>
    <div>${item.name}</div>
</div>
```

#### Async Lists with Loading States
```html
<tbody await=${users} each:user=${users.data}>
    <tr><td>${user.name}</td></tr>
<:loading>
    <tr><td>Loading users...</td></tr>
<:error>
    <tr><td>Error loading users</td></tr>
</tbody>
```

### Implementation Considerations
- Determine precedence order (which directive wraps which)
- Suggested order: `await` → `if` → `each`
- Need to handle nested component creation properly
- Ensure context variables are passed correctly through the chain

---

## 2. Automatic Signal Props

**Status**: Proposed
**Priority**: Medium
**Complexity**: Medium

### Description
Simplify prop definitions by automatically converting props to signals and making bindable props explicit.

### Current API
```javascript
token("my-counter", ({ width = signal("150px"), prop2 = signal("Hello") }) => {
    html`<p class="w-${width}">${prop2}</p>`;
});
```

### Proposed API
```javascript
token("my-counter", {
    props: {
        width: "150px",        // Auto-converted to RW signal (bindable)
        prop2: "Hello",        // Auto-converted to RW signal (bindable)
        staticProp: readonly("static")  // Explicitly read-only
    },
    render() {
        // Props available as globals via context
        html`<p class="w-${width}">${prop2}</p>`;
    }
});
```

### Benefits
- No need to write `signal()` everywhere
- Props automatically available in render scope
- Clear distinction between bindable and read-only props
- Better validation/warnings for incorrect prop usage

### Implementation Considerations
- Parse `props` object in component definition
- Create signals for each prop with default values
- Add props to component context so they're available as "globals"
- Track which props are marked with `bindable()` or `readonly()`
- Warn when parent tries to two-way bind non-bindable props

---

## 3. Enhanced Class Attribute Handling with Scope Classes

**Status**: Partially Implemented
**Priority**: High (Bug Fix)
**Complexity**: Low

### Description
Ensure scoped CSS classes are preserved when dynamic class attributes change.

### Current Issue
When a component has scoped styles and uses signals in class attributes, the scope class gets overwritten.

### Solution
Create computed signals that combine scope class with dynamic classes:
```javascript
const classSignal = computed(() => `${scopeClassName} ${dynamicClass.v}`);
```

### Status
- ✅ `attrInterpolate` handler updated to preserve scope classes
- ✅ `attrBind` handler updated to preserve scope classes
- ✅ `BindingContext` passes `scopeClassName`
- ⚠️ Only works for components with scoped styles

---

## 4. Template Parsing Order Fix

**Status**: Completed ✅
**Priority**: Critical (Bug Fix)
**Complexity**: Low

### Description
Fix the order of placeholder pattern matching to ensure partial replacements are checked before full replacements.

### Issue
`FULL_PLACEHOLDER` (`/\{\{--(\d+)--\}\}/`) was being checked before `PARTIAL_PLACEHOLDER` (`/'\{\{--(\d+)--\}\}'/`), causing class attributes like `class="w-${width} p-2"` to be incorrectly parsed as full replacements.

### Solution
✅ Check `PARTIAL_PLACEHOLDER` first in `_handleAttributes` method (line 286-292)

---

## 5. Directive + Attribute Combination

**Status**: Completed ✅
**Priority**: High (Bug Fix)
**Complexity**: Low

### Description
Allow elements with directives (`if`, `await`, `each:*`) to also have regular reactive attributes.

### Example
```html
<select :value=${storage} each:option=${storageOptions}>
    <option value=${()=>option.value}>${()=>option.key}</option>
</select>
```

### Solution
✅ Process attributes before checking directives
✅ Skip directive attributes in `_handleAttributes`
✅ Don't return early until after attributes are processed

---

## Ideas for Future Consideration

### Component Lifecycle Hooks
- `onBeforeMount` / `onAfterMount`
- `onBeforeUpdate` / `onAfterUpdate`
- `onBeforeUnmount` / `onAfterUnmount`

### Prop Validation
- Type checking for props
- Required props
- Custom validators

### Teleport/Portal
- Render content in a different part of the DOM
```html
<teleport to="body">
    <div class="modal">...</div>
</teleport>
```

### Keyed Lists
- Optimize list rendering with keys for better performance
```html
<div each:item=${items} key=${()=>item.id}>
    ${item.name}
</div>
```

### CSS Modules
- Scoped CSS with explicit class name imports
- Better tree-shaking for unused styles

### DevTools Integration
- Browser extension for debugging components
- Inspect component tree
- View reactive dependencies
- Time-travel debugging
