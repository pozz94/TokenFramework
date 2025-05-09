import token from './token.js';

token("my-test", ({ func, prop1, prop2 }) => html`
    <p>${prop2}</p>
    <input type="text" :value=${prop1}>
    <p>${prop1}</p>
    <button onclick=${() => { func(); console.log('asdf') }}>Change test</button>
    <button onclick=${() => { prop2.v = '20px' }}>Change test</button>`);