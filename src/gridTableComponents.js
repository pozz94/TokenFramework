// CSS Grid-based table components with real spanning support and proper ARIA roles
// Use these instead of table components when you need colspan/rowspan

class GridTable extends HTMLElement {
    constructor() {
        super();
        this.setAttribute('role', 'table');
        const shadow = this.attachShadow({ mode: 'open' });
        shadow.innerHTML = `
            <style>
                :host {
                    display: grid;
                    border: 1px solid #ccc;
                    gap: 0;
                }
            </style>
            <slot name="caption"></slot>
            <slot></slot>
        `;
    }
    
    connectedCallback() {
        this.#setupGrid();
    }
    
    #setupGrid() {
        // Auto-detect columns based on first row
        requestAnimationFrame(() => {
            const firstRow = this.querySelector('grid-row, grid-head grid-row, grid-body grid-row');
            if (firstRow) {
                const cells = firstRow.querySelectorAll('grid-cell, grid-header, grid-data-cell, grid-row-header');
                const columns = Array.from(cells).reduce((total, cell) => {
                    const colspan = parseInt(cell.getAttribute('colspan') || '1');
                    return total + colspan;
                }, 0);
                
                // Apply grid columns to the host element
                this.style.gridTemplateColumns = `repeat(${columns}, 1fr)`;
            }
        });
    }
}

class GridHead extends HTMLElement {
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

class GridBody extends HTMLElement {
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

class GridFoot extends HTMLElement {
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

class GridRow extends HTMLElement {
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

class GridCell extends HTMLElement {
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

class GridHeader extends GridCell {
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

class GridCaption extends HTMLElement {
    constructor() {
        super();
        this.setAttribute('slot', 'caption');
        const shadow = this.attachShadow({ mode: 'open' });
        shadow.innerHTML = `
            <style>
                :host {
                    grid-column: 1 / -1;
                    display: block;
                    font-weight: bold;
                    text-align: center;
                    padding: 0.5rem;
                    background: #f9f9f9;
                    border-bottom: 1px solid #ccc;
                    box-sizing: border-box;
                }
            </style>
            <slot></slot>
        `;
    }
}



// Enhanced cell with data type support
class GridDataCell extends GridCell {
    constructor() {
        super();
    }
    
    static get observedAttributes() {
        return [...super.observedAttributes, 'data-type', 'data-value'];
    }
    
    connectedCallback() {
        super.connectedCallback();
        this.#applyDataType();
    }
    
    attributeChangedCallback(name, oldValue, newValue) {
        super.attributeChangedCallback(name, oldValue, newValue);
        if (name === 'data-type' || name === 'data-value') {
            this.#applyDataType();
        }
    }
    
    #applyDataType() {
        const dataType = this.getAttribute('data-type');
        
        switch (dataType) {
            case 'number':
                this.style.textAlign = 'right';
                this.style.fontVariantNumeric = 'tabular-nums';
                break;
            case 'currency':
                this.style.textAlign = 'right';
                this.style.fontVariantNumeric = 'tabular-nums';
                break;
            case 'date':
                this.style.fontVariantNumeric = 'tabular-nums';
                break;
            case 'boolean':
                this.style.textAlign = 'center';
                break;
        }
    }
}

// Row header cell (for row labels)
class GridRowHeader extends GridCell {
    constructor() {
        super();
        this.setAttribute('role', 'rowheader');
        
        const shadow = this.shadowRoot;
        const style = shadow.querySelector('style');
        style.textContent += `
            :host {
                font-weight: bold;
                background: #f9f9f9;
            }
        `;
    }
}

// Register grid-based components
customElements.define('grid-table', GridTable);
customElements.define('grid-caption', GridCaption);
customElements.define('grid-head', GridHead);
customElements.define('grid-body', GridBody);
customElements.define('grid-foot', GridFoot);
customElements.define('grid-row', GridRow);
customElements.define('grid-cell', GridCell);
customElements.define('grid-data-cell', GridDataCell);
customElements.define('grid-header', GridHeader);
customElements.define('grid-row-header', GridRowHeader);

export { 
    GridTable, GridCaption, 
    GridHead, GridBody, GridFoot, GridRow, 
    GridCell, GridDataCell, GridHeader, GridRowHeader 
};