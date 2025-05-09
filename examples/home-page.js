import token from '../src/token.js';

import './my-counter.js';
import './effect-test.js';
import './test-infinite-loop.js';

token("home-page", () => html`
    <effect-test></effect-test>
    <test-infinite-loop></test-infinite-loop>
    <my-counter width="150px" prop2="test"></my-counter>
`);