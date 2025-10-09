/**
 * Token Framework CSS Scoping Module
 * Provides automatic CSS scoping for web components
 */

// Helper: Simple hash function
function simpleHash(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash).toString(36);
}

// Main export: CSS scoping
export function scopeCSS(cssString) {
  // Generate scope class from CSS content
  const hash = simpleHash((cssString).trim());
  const scopeClass = `token-${hash}`;
  
  // Parse CSS synchronously using a temporary style element
  const tempStyle = document.createElement('style');
  tempStyle.textContent = cssString;
  document.head.appendChild(tempStyle);
  
  const sheet = tempStyle.sheet;
  const scopedRules = [];
  const animationNames = new Set(); // Collect animation names
  
  // First pass: collect all keyframes names
  if (sheet && sheet.cssRules) {
    Array.from(sheet.cssRules).forEach(rule => {
      if (rule.constructor.name === 'CSSKeyframesRule') {
        animationNames.add(rule.name);
      } else if (rule.constructor.name === 'CSSMediaRule' || rule.constructor.name === 'CSSSupportsRule') {
        Array.from(rule.cssRules).forEach(nestedRule => {
          if (nestedRule.constructor.name === 'CSSKeyframesRule') {
            animationNames.add(nestedRule.name);
          }
        });
      }
    });
    
    // Second pass: scope all rules
    Array.from(sheet.cssRules).forEach(rule => {
      if (rule.constructor.name === 'CSSStyleRule') {
        scopedRules.push(scopeStyleRule(rule, scopeClass, animationNames));
      } else if (rule.constructor.name === 'CSSMediaRule') {
        scopedRules.push(scopeMediaRule(rule, scopeClass, animationNames));
      } else if (rule.constructor.name === 'CSSSupportsRule') {
        scopedRules.push(scopeSupportsRule(rule, scopeClass, animationNames));
      } else if (rule.constructor.name === 'CSSKeyframesRule') {
        scopedRules.push(scopeKeyframesRule(rule, scopeClass));
      } else {
        // Pass through other rules
        scopedRules.push(rule.cssText);
      }
    });
  }
  
  // Clean up temporary style element
  document.head.removeChild(tempStyle);
  
  const combinedStylesScoped = scopedRules.join('\n');
  return { combinedStylesScoped, scopeClass };
}

// Scope individual style rules
function scopeStyleRule(rule, scopeClass, animationNames) {
  const selectors = rule.selectorText.split(',').map(sel => sel.trim());
  const scopedSelectors = selectors.map(selector => scopeSelector(selector, scopeClass));
  const scopedCssText = updateAnimationReferences(rule.style.cssText, scopeClass, animationNames);
  return `${scopedSelectors.join(', ')} { ${scopedCssText} }`;
}

// Scope media query rules
function scopeMediaRule(mediaRule, scopeClass, animationNames) {
  const scopedRules = [];
  Array.from(mediaRule.cssRules).forEach(rule => {
    if (rule.constructor.name === 'CSSStyleRule') {
      scopedRules.push(scopeStyleRule(rule, scopeClass, animationNames));
    } else if (rule.constructor.name === 'CSSKeyframesRule') {
      scopedRules.push(scopeKeyframesRule(rule, scopeClass));
    } else {
      scopedRules.push(rule.cssText);
    }
  });
  return `@media ${mediaRule.media.mediaText} {\n${scopedRules.join('\n')}\n}`;
}

// Scope supports query rules
function scopeSupportsRule(supportsRule, scopeClass, animationNames) {
  const scopedRules = [];
  Array.from(supportsRule.cssRules).forEach(rule => {
    if (rule.constructor.name === 'CSSStyleRule') {
      scopedRules.push(scopeStyleRule(rule, scopeClass, animationNames));
    } else if (rule.constructor.name === 'CSSKeyframesRule') {
      scopedRules.push(scopeKeyframesRule(rule, scopeClass));
    } else {
      scopedRules.push(rule.cssText);
    }
  });
  return `@supports ${supportsRule.conditionText} {\n${scopedRules.join('\n')}\n}`;
}

// Scope keyframes rules
function scopeKeyframesRule(keyframesRule, scopeClass) {
  const originalName = keyframesRule.name;
  const scopedName = `${originalName}-${scopeClass}`;
  
  const keyframeText = Array.from(keyframesRule.cssRules).map(keyframe => {
    return `${keyframe.keyText} { ${keyframe.style.cssText} }`;
  }).join('\n  ');
  
  return `@keyframes ${scopedName} {\n  ${keyframeText}\n}`;
}

// Scope individual selectors
function scopeSelector(selector, scopeClass) {
  // Throw error for global selectors in component styles
  if (selector.startsWith(':root') || 
      selector.startsWith('html') ||
      selector.startsWith('body')) {
    throw new Error(`Global selector "${selector}" not allowed in component styles. Use it in <style global> instead.`);
  }

  // Handle :host - replace with scoping class
  if (selector.includes(':host')) {
    return selector.replace(':host', `.${scopeClass}`);
  }

  // Handle pseudo-elements
  if (selector.includes('::')) {
    return scopePseudoElementSelector(selector, scopeClass);
  }

  // Handle complex selectors with combinators
  if (selector.match(/\s*[>+~]\s*/)) {
    return scopeComplexSelector(selector, scopeClass);
  }

  // Simple selector scoping (including universal selector *)
  if (selector.startsWith('.')) {
    return `${selector}.${scopeClass}`;
  } else {
    return `${selector}.${scopeClass}`;
  }
}

// Handle pseudo-element selectors
function scopePseudoElementSelector(selector, scopeClass) {
  const parts = selector.split('::');
  if (parts.length === 2) {
    const [base, pseudoElement] = parts;
    const scopedBase = base.trim() ? scopeSelector(base.trim(), scopeClass) : `.${scopeClass}`;
    return `${scopedBase}::${pseudoElement.trim()}`;
  }
  return selector;
}

// Handle complex selectors with combinators
function scopeComplexSelector(selector, scopeClass) {
  const parts = selector.split(/(\s*[>+~]\s*)/);
  
  return parts.map((part, index) => {
    if (part.match(/\s*[>+~]\s*/)) {
      return part; // Keep combinators as-is
    } else if (part.trim()) {
      const trimmed = part.trim();
      if (trimmed.startsWith('.')) {
        return `${trimmed}.${scopeClass}`;
      } else {
        return `${trimmed}.${scopeClass}`;
      }
    }
    return part;
  }).join('');
}

// Update animation references in CSS declarations
function updateAnimationReferences(cssText, scopeClass, animationNames) {
  // Handle animation shorthand property
  cssText = cssText.replace(/animation:\s*([^;]+);/g, (match, animationValue) => {
    const scopedValue = scopeAnimationValue(animationValue, scopeClass, animationNames);
    return `animation: ${scopedValue};`;
  });
  
  // Handle animation-name property
  cssText = cssText.replace(/animation-name:\s*([^;]+);/g, (match, nameValue) => {
    const scopedValue = scopeAnimationNames(nameValue, scopeClass, animationNames);
    return `animation-name: ${scopedValue};`;
  });
  
  return cssText;
}

// Helper to escape regex special characters
function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Scope animation names in animation shorthand (simple approach)
function scopeAnimationValue(animationValue, scopeClass, animationNames) {
  return animationValue.split(',').map(animation => {
    let scopedAnimation = animation.trim();
    
    // Replace each known animation name with its scoped version
    animationNames.forEach(animationName => {
      const regex = new RegExp(`\\b${escapeRegExp(animationName)}\\b`, 'g');
      scopedAnimation = scopedAnimation.replace(regex, `${animationName}-${scopeClass}`);
    });
    
    return scopedAnimation;
  }).join(', ');
}

// Scope animation names in animation-name property
function scopeAnimationNames(nameValue, scopeClass, animationNames) {
  return nameValue.split(',').map(name => {
    const trimmedName = name.trim();
    if (trimmedName === 'none') return trimmedName;
    
    // Only scope if it's a known animation name
    return animationNames.has(trimmedName) ? `${trimmedName}-${scopeClass}` : trimmedName;
  }).join(', ');
}