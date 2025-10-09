// Native Web Components for tables - no framework dependencies

class TTable extends HTMLElement {
    constructor() {
        super();
        const shadow = this.attachShadow({ mode: 'open' });
        shadow.innerHTML = `
            <style>
                :host {
                    display: table;
                    border-collapse: collapse;
                    border-spacing: 0;
                }
            </style>
            <slot></slot>
        `;
    }
}

class THead extends HTMLElement {
    constructor() {
        super();
        const shadow = this.attachShadow({ mode: 'open' });
        shadow.innerHTML = `
            <style>
                :host {
                    display: table-header-group;
                    vertical-align: middle;
                    border-color: inherit;
                }
            </style>
            <slot></slot>
        `;
    }
}

class TBody extends HTMLElement {
    constructor() {
        super();
        const shadow = this.attachShadow({ mode: 'open' });
        shadow.innerHTML = `
            <style>
                :host {
                    display: table-row-group;
                    vertical-align: middle;
                    border-color: inherit;
                }
            </style>
            <slot></slot>
        `;
    }
}

class TFoot extends HTMLElement {
    constructor() {
        super();
        const shadow = this.attachShadow({ mode: 'open' });
        shadow.innerHTML = `
            <style>
                :host {
                    display: table-footer-group;
                    vertical-align: middle;
                    border-color: inherit;
                }
            </style>
            <slot></slot>
        `;
    }
}

class TRow extends HTMLElement {
    constructor() {
        super();
        const shadow = this.attachShadow({ mode: 'open' });
        shadow.innerHTML = `
            <style>
                :host {
                    display: table-row;
                    vertical-align: inherit;
                    border-color: inherit;
                }
            </style>
            <slot></slot>
        `;
    }
}

class TCell extends HTMLElement {
    constructor() {
        super();
        const shadow = this.attachShadow({ mode: 'open' });
        shadow.innerHTML = `
            <style>
                :host {
                    display: table-cell;
                    padding: 0.5rem;
                    vertical-align: inherit;
                    border: inherit;
                    text-align: inherit;
                }
            </style>
            <slot></slot>
        `;
    }
    
    connectedCallback() {
        this.#updateAttributes();
    }
    
    attributeChangedCallback(name, oldValue, newValue) {
        this.#updateAttributes();
    }
    
    static get observedAttributes() {
        return ['colspan', 'rowspan', 'align', 'valign', 'style', 'class'];
    }
    
    #updateAttributes() {
        // Apply CSS-based attributes
        if (this.hasAttribute('align')) {
            this.style.textAlign = this.getAttribute('align');
        }
        if (this.hasAttribute('valign')) {
            this.style.verticalAlign = this.getAttribute('valign');
        }
        
        // Note: colspan/rowspan cannot be implemented in pure CSS
        // They require actual table structure with <td> elements
        // For spanning, consider using CSS Grid instead of table layout
    }
}

class THeader extends HTMLElement {
    constructor() {
        super();
        const shadow = this.attachShadow({ mode: 'open' });
        shadow.innerHTML = `
            <style>
                :host {
                    display: table-cell;
                    padding: 0.5rem;
                    font-weight: bold;
                    text-align: left;
                    vertical-align: inherit;
                    border: inherit;
                }
            </style>
            <slot></slot>
        `;
    }
    
    connectedCallback() {
        this.#updateAttributes();
    }
    
    attributeChangedCallback(name, oldValue, newValue) {
        this.#updateAttributes();
    }
    
    static get observedAttributes() {
        return ['colspan', 'rowspan', 'align', 'valign', 'scope', 'style', 'class'];
    }
    
    #updateAttributes() {
        // Apply CSS-based attributes
        if (this.hasAttribute('align')) {
            this.style.textAlign = this.getAttribute('align');
        }
        if (this.hasAttribute('valign')) {
            this.style.verticalAlign = this.getAttribute('valign');
        }
        
        // Note: colspan/rowspan cannot be implemented in pure CSS
        // They require actual table structure with <td>/<th> elements
        // For spanning, consider using CSS Grid instead of table layout
    }
}

// CSS Grid-based table components with real spanning support and proper ARIA roles

class GTable extends HTMLElement {
    constructor() {
        super();
        this.setAttribute('role', 'table');
        const shadow = this.attachShadow({ mode: 'open' });
        shadow.innerHTML = `
            <style>
                :host {
                    display: grid;
                    border-collapse: collapse;
                    gap: 0;
                    border: 1px solid #ccc;
                }
            </style>
            <slot></slot>
        `;
    }
    
    connectedCallback() {
        this.#setupGrid();
    }
    
    #setupGrid() {
        // Auto-detect columns based on first row
        requestAnimationFrame(() => {
            const firstRow = this.querySelector('g-row, g-head g-row, g-body g-row');
            if (firstRow) {
                const cells = firstRow.querySelectorAll('g-cell, g-header');
                const columns = Array.from(cells).reduce((total, cell) => {
                    const colspan = parseInt(cell.getAttribute('colspan') || '1');
                    return total + colspan;
                }, 0);
                this.style.gridTemplateColumns = `repeat(${columns}, 1fr)`;
            }
        });
    }
}

class GHead extends HTMLElement {
    constructor() {
        super();
        this.setAttribute('role', 'rowgroup');
        const shadow = this.attachShadow({ mode: 'open' });
        shadow.innerHTML = `
            <style>
                :host {
                    display: contents; /* Makes children participate in parent grid */
                }
            </style>
            <slot></slot>
        `;
    }
}

class GBody extends HTMLElement {
    constructor() {
        super();
        this.setAttribute('role', 'rowgroup');
        const shadow = this.attachShadow({ mode: 'open' });
        shadow.innerHTML = `
            <style>
                :host {
                    display: contents; /* Makes children participate in parent grid */
                }
            </style>
            <slot></slot>
        `;
    }
}

class GFoot extends HTMLElement {
    constructor() {
        super();
        this.setAttribute('role', 'rowgroup');
        const shadow = this.attachShadow({ mode: 'open' });
        shadow.innerHTML = `
            <style>
                :host {
                    display: contents; /* Makes children participate in parent grid */
                }
            </style>
            <slot></slot>
        `;
    }
}

class GRow extends HTMLElement {
    constructor() {
        super();
        this.setAttribute('role', 'row');
        const shadow = this.attachShadow({ mode: 'open' });
        shadow.innerHTML = `
            <style>
                :host {
                    display: contents; /* Makes children participate in parent grid */
                }
            </style>
            <slot></slot>
        `;
    }
}

class GCell extends HTMLElement {
    constructor() {
        super();
        this.setAttribute('role', 'cell');
        const shadow = this.attachShadow({ mode: 'open' });
        shadow.innerHTML = `
            <style>
                :host {
                    padding: 0.5rem;
                    border: 1px solid #ccc;
                    background: white;
                    display: flex;
                    align-items: center;
                    min-height: 2rem;
                }
            </style>
            <slot></slot>
        `;
    }
    
    connectedCallback() {
        this.#updateSpanning();
    }
    
    attributeChangedCallback(name, oldValue, newValue) {
        this.#updateSpanning();
    }
    
    static get observedAttributes() {
        return ['colspan', 'rowspan', 'align', 'valign'];
    }
    
    #updateSpanning() {
        const colspan = parseInt(this.getAttribute('colspan') || '1');
        const rowspan = parseInt(this.getAttribute('rowspan') || '1');
        
        // CSS Grid spanning - this actually works!
        if (colspan > 1) {
            this.style.gridColumnEnd = `span ${colspan}`;
        }
        if (rowspan > 1) {
            this.style.gridRowEnd = `span ${rowspan}`;
        }
        
        // Alignment
        if (this.hasAttribute('align')) {
            this.style.justifyContent = this.#getJustifyContent(this.getAttribute('align'));
        }
        if (this.hasAttribute('valign')) {
            this.style.alignItems = this.#getAlignItems(this.getAttribute('valign'));
        }
    }
    
    #getJustifyContent(align) {
        switch (align) {
            case 'left': return 'flex-start';
            case 'center': return 'center';
            case 'right': return 'flex-end';
            default: return 'flex-start';
        }
    }
    
    #getAlignItems(valign) {
        switch (valign) {
            case 'top': return 'flex-start';
            case 'middle': return 'center';
            case 'bottom': return 'flex-end';
            default: return 'center';
        }
    }
}

class GHeader extends GCell {
    constructor() {
        super();
        // Override role for header cells
        this.setAttribute('role', 'columnheader');
        
        // Override styles for header
        const shadow = this.shadowRoot;
        const style = shadow.querySelector('style');
        style.textContent += `
            :host {
                font-weight: bold;
                background: #f5f5f5;
            }
        `;
    }
}

// Register all components
customElements.define('t-table', TTable);
customElements.define('t-head', THead);
customElements.define('t-body', TBody);
customElements.define('t-foot', TFoot);
customElements.define('t-row', TRow);
customElements.define('t-cell', TCell);
customElements.define('t-header', THeader);

// Register grid-based components
customElements.define('g-table', GTable);
customElements.define('g-head', GHead);
customElements.define('g-body', GBody);
customElements.define('g-foot', GFoot);
customElements.define('g-row', GRow);
customElements.define('g-cell', GCell);
customElements.define('g-header', GHeader);

export { 
    TTable, THead, TBody, TFoot, TRow, TCell, THeader,
    GTable, GHead, GBody, GFoot, GRow, GCell, GHeader
};
