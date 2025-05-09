import { signal, computed, effect } from './signal.js';
import { component } from './component.js';

component("my-test", ({ func, prop2, html }) => {
    
    html`
        <p>${prop2}</p>
        <button onclick=${()=>{func(); console.log('asdf')}}>Change test</button>
        <button onclick=${()=>{prop2.v='20px'}}>Change test</button>`;
});