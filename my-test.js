import { signal, computed, effect } from './signal.js';
import { component } from './component.js';

component("my-test", ({ func, prop1, prop2, html }) => {
    
    html`
        <p>${prop2}</p>
        <input type="text" :value=${prop1}></input>
        <p>${prop1}</p>
        <button onclick=${()=>{func(); console.log('asdf')}}>Execute func prop</button>
        <button onclick=${()=>{prop2.v='20px'}}>Set width to 20px</button>`;
});