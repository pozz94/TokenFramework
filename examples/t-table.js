import { token, signal } from '../dist/token.js';

token('t-table', ({class: Class = signal('')}, {html})=>{
	html`
		<div role="table" class="t-table ${Class}">
			<slot></slot>
		</div>
		<style>
			.t-table {
				display: table;
			}
		</style>
	`
})

token('t-head', ({class: Class = signal('')}, {html}) => {
	html`
		<div role="rowgroup" class="t-head ${Class}">
			<slot></slot>
		</div>
		<style>
			.t-head {
				display: table-header-group;
			}
		</style>
	`
})

token('t-body', ({class: Class = signal('')}, {html})=>{
	html`
		<div role="rowgroup" class="t-body ${Class}">
			<slot></slot>
		</div>
		<style>
			.t-body {
				display: table-row-group;
			}
		</style>
	`
})

token('t-r', ({class: Class = signal('')}, {html})=>{
	html`
		<div role="row" class="t-r ${Class}">
			<slot></slot>
		</div>
		<style>
			.t-r {
				display: table-row;
			}
		</style>
	`
})
token('t-h', ({class: Class = signal('')}, {html})=>{
	html`
		<div role="columnheader" class="t-h ${Class}">
			<slot></slot>
		</div>
		<style>
			.t-h {
				display: table-cell;
				font-weight: bold;
			}
		</style>
	`
})
token('t-d', ({class: Class = signal('')}, {html})=>{
	html`
		<div role="cell" class="t-d ${Class}">
			<slot></slot>
		</div>
		<style>
			.t-d {
				display: table-cell;
			}
		</style>
	`
})	